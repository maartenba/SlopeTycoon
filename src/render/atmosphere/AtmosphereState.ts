import * as THREE from 'three';
import { ATMOS, type LevelFeatures } from '../../config/atmosphere';
import type { SeasonId, WeatherKind } from '../../core/events';
import type { Grid } from '../../world/Grid';
import { fogUniforms } from '../Fog';
import { type LightingParams } from '../Lighting';
import { fogAt, fogDay, type DayContext } from './FogState';
import { frostAmount, mistAmount, rainbowAmount } from './Flavour';
import { clamp01, smoothstep } from './hash';
import { MistLayer } from './Mist';
import { cloudDrift, cloudShadowAmount, moonPhase, moonPhaseName, starAlpha } from './Sky';
import { NO_DECOR, SkyOverlay, type SkyDecor } from './SkyOverlay';
import { alpenglowWeight, gradeLighting, specialSky } from './SunFx';
import { atmosTerrainUniforms } from './uniforms';

/** What the controller needs from the game each frame (all render-side reads; nothing here is ever written back to the sim). */
export interface AtmosInput {
  seed: number; dayKey: number; season: SeasonId; weather: WeatherKind; wind: number; valleyT: number; hour: number; sunrise: number; sunset: number;
  /** Lighting.night 0..1 (1 = dark). */
  night: number; prevWet: boolean;
}
/** Debug / photo-mode overrides. Undefined = follow the day. All render-only. */
export interface AtmosForce { fog?: number; special?: number; frost?: number; rainbow?: number; mist?: number; stars?: number; moonPhase?: number; cloudShadow?: number; inversion?: boolean }

/** The values written this frame (for debug, HUD and tests). */
export interface AtmosSnapshot {
  level: string; animate: boolean; fog: number; fogLineWorld: number; glow: number; alpenglow: number; frost: number; mist: number; rainbow: number; stars: number; moon: { phase: number; name: string; alpha: number }; cloudShadow: number; special: { dawn: number; dusk: number }; fogDay: boolean; inversion: boolean;
}
export interface PhotoSuggestion { id: 'golden' | 'foggy' | 'starry' | 'frost'; label: string; hour: number; note: string }

export interface AtmosDeps {
  features: () => LevelFeatures; level: () => string; reducedMotion: () => boolean;
  /** Where the sky overlay mounts (the canvas parent) or null (tests / headless). */
  skyParent: HTMLElement | null;
  /** Height range of the terrain in world units (top). */
  maxWorld: () => number;
  grid: Grid | null;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Atmosphere controller (M7.0). Pure functions (FogState / SunFx / Sky / Flavour) decide what the day looks like from (seed, day, weather, season, hour);
 * this class smooths the result and writes shared uniforms (valley fog, alpenglow, cloud shadows, frost), the CSS sky decor and the mist layer.
 * Off = every uniform neutral and no overlay (the exact pre-M7.0 look). Reduced motion = the same picture, but time is frozen (no drift / twinkle / mist motion).
 */
export class AtmosphereController {
  readonly mist = new MistLayer();
  private sky: SkyOverlay | null;
  private clock = 0;
  private snap = 3; // frames that jump straight to the target (the hour override lands one frame later than a force / setting change)
  private cur = { fog: 0, line: 0.3, glow: 0, alp: 0, frost: 0, mist: 0, rainbow: 0, stars: 0, moonA: 0, cloud: 0 };
  private forced: AtmosForce = {};
  private lastIn: AtmosInput | null = null;
  last: AtmosSnapshot | null = null;
  private fogColor: [number, number, number] = [0.8, 0.85, 0.92];

  constructor(private d: AtmosDeps) { this.sky = d.skyParent ? new SkyOverlay(d.skyParent) : null; }

  force(f: AtmosForce | null): void { this.forced = f ? { ...this.forced, ...f } : {}; this.snap = 3; }
  get forcing(): boolean { return Object.keys(this.forced).length > 0; }
  /** The setting changed (or a state was forced): the next update jumps instead of easing. */
  jump(): void { this.snap = 3; }

  private ctx(i: AtmosInput): DayContext { return { seed: i.seed, dayKey: i.dayKey, season: i.season, weather: i.weather, prevWet: i.prevWet, valleyT: i.valleyT }; }

  /** The lighting grade hook (Lighting.gradeHook): warms the sky / sun on special sunrise / sunset days. Identity when off or plain. */
  grade = (p: LightingParams, hour: number): LightingParams => {
    const i = this.lastIn, F = this.d.features();
    if (!i || !F.grade) return p;
    const sp = this.forced.special !== undefined ? { dawn: this.forced.special, dusk: this.forced.special } : specialSky(this.ctx(i));
    return gradeLighting(p, alpenglowWeight(hour, i.sunrise, i.sunset, sp));
  };
  /** Tell the controller the day (before Lighting.apply) so the grade hook knows it. */
  setDay(i: AtmosInput): void { this.lastIn = i; }

  /** Photo mode: quick presets that jump the hour to a good moment of THIS day (only offered when the day delivers). Pure of state. */
  suggestions(i: AtmosInput): PhotoSuggestion[] {
    const out: PhotoSuggestion[] = [];
    const c = this.ctx(i), sp = specialSky(c), fd = fogDay(c);
    if (sp.dusk > 0) out.push({ id: 'golden', label: 'Golden hour', hour: i.sunset - 0.15, note: 'A colourful sunset today' });
    else if (sp.dawn > 0) out.push({ id: 'golden', label: 'Golden hour', hour: i.sunrise + 0.15, note: 'A colourful sunrise today' });
    if (fd.strength > 0) out.push({ id: 'foggy', label: 'Foggy valley', hour: Math.max(i.sunrise + 0.4, 7), note: fd.inversion ? 'Valley fog under clear summits today' : 'Valley fog this morning' });
    if (frostAmount(c, i.sunrise + 1, i.sunrise) > 0.2) out.push({ id: 'frost', label: 'Frosty morning', hour: i.sunrise + 1, note: 'Frost sparkle on the snow' });
    if (i.weather === 'clear') out.push({ id: 'starry', label: 'Starry night', hour: 23, note: moonPhaseName(moonPhase(i.dayKey)) });
    return out;
  }

  update(dt: number, i: AtmosInput, focus: { x: number; z: number }, viewHeight: number, lp: LightingParams | null, horizonAt: number): void {
    this.lastIn = i;
    const F = this.d.features(), reduced = this.d.reducedMotion(), fo = this.forced;
    const c = this.ctx(i);
    const maxW = Math.max(1, this.d.maxWorld());
    // ---- targets
    const fog = fo.fog !== undefined ? { amount: clamp01(fo.fog) * Math.max(F.fog, fo.fog > 0 && F.fog > 0 ? 1 : 0), lineFrac: fo.inversion ? ATMOS.fog.inversionLineFrac : ATMOS.fog.lineFrac } : fogAt(c, i.hour, i.sunrise, F.fog);
    const sp = fo.special !== undefined ? { dawn: fo.special, dusk: fo.special } : specialSky(c);
    const glow = F.grade || F.alpenglow ? alpenglowWeight(i.hour, i.sunrise, i.sunset, sp) : 0;
    const frost = F.frost ? (fo.frost ?? frostAmount(c, i.hour, i.sunrise)) : 0;
    const mist = F.mist ? (fo.mist ?? mistAmount(c, i.hour, i.sunrise, i.wind)) : 0;
    const bow = F.rainbow ? (fo.rainbow ?? rainbowAmount(c, i.hour, i.sunrise, i.sunset)) : 0;
    const stars = F.stars ? (fo.stars ?? starAlpha(i.night, i.weather)) : 0;
    const moonAlpha = F.moon ? clamp01(smoothstep(0.45, 0.9, i.night) * (i.weather === 'clear' || i.weather === 'cloudy' ? 1 : 0.2) * (fo.stars !== undefined ? 1 : 1)) : 0;
    const cloud = F.cloudShadows ? (fo.cloudShadow ?? cloudShadowAmount(i.seed, i.dayKey, i.weather, i.night)) : 0;
    const k = this.snap > 0 ? 1 : Math.min(1, dt * 0.9);
    const T = { fog: fog.amount, line: fog.lineFrac, glow: F.alpenglow ? glow : 0, alp: F.alpenglow ? glow : 0, frost, mist, rainbow: bow, stars, moonA: moonAlpha, cloud };
    const cu = this.cur as Record<string, number>;
    for (const key of Object.keys(T) as (keyof typeof T)[]) cu[key] = lerp(cu[key]!, T[key], k);
    if (this.snap > 0) this.snap--;
    if (!reduced) this.clock += dt;
    // ---- uniforms
    const soft = Math.min(8, Math.max(3, maxW * 0.12));
    fogUniforms.uValleyFog.value.set(this.cur.fog * ATMOS.fog.maxOpacity, this.cur.line * maxW, soft);
    fogUniforms.uValleyFogT.value = this.clock;
    if (lp) {
      const day = 1 - lp.night, bg = lp.background;
      const m = (v: number): number => (v * 0.62 + 0.38) * (0.28 + 0.72 * day);
      this.fogColor = [m(bg[0]), m(bg[1]), m(bg[2])];
      fogUniforms.uValleyFogColor.value.setRGB(this.fogColor[0], this.fogColor[1], this.fogColor[2], THREE.SRGBColorSpace);
    }
    const A = atmosTerrainUniforms;
    A.uAtmA.value.set(this.cur.alp * ATMOS.alpenglow.strength, ATMOS.alpenglow.heightFrac * maxW, this.cur.frost, this.cur.cloud);
    const dr = cloudDrift(i.wind) * 0.022;
    A.uAtmB.value.set(this.clock, this.clock * dr, this.clock * dr * 0.4, reduced ? 0 : 1);
    A.uAlpColor.value.setRGB(...ATMOS.alpenglow.colour, THREE.SRGBColorSpace);
    // ---- sky decor + mist
    const phase = fo.moonPhase ?? moonPhase(i.dayKey);
    const decor: SkyDecor = F.stars || F.moon || F.rainbow ? { stars: this.cur.stars, moonPhase: phase, moonAlpha: this.cur.moonA, rainbow: this.cur.rainbow, horizonAt } : NO_DECOR;
    if (this.sky && lp) { const s = lp.background; this.sky.update(decor, `rgb(${[0, 1, 2].map((q) => Math.round(clamp01(s[q]! * 0.55) * 255)).join(',')})`); }
    this.lastDecor = decor;
    if (this.d.grid) this.mist.update(dt, this.clock, this.cur.mist, this.d.grid, i.seed, focus, viewHeight, i.wind, this.fogColor.map((v) => clamp01(v * 0.9 + 0.1)) as [number, number, number]);
    else this.mist.mesh.visible = false;
    this.last = {
      level: this.d.level(), animate: !reduced, fog: this.cur.fog, fogLineWorld: this.cur.line * maxW, glow: this.cur.glow, alpenglow: this.cur.alp, frost: this.cur.frost, mist: this.cur.mist, rainbow: this.cur.rainbow, stars: this.cur.stars,
      moon: { phase, name: moonPhaseName(phase), alpha: this.cur.moonA }, cloudShadow: this.cur.cloud, special: sp, fogDay: fogDay(c).strength > 0, inversion: fo.inversion ?? fogDay(c).inversion,
    };
  }
  lastDecor: SkyDecor = NO_DECOR;
  /** Whether the fog is thick enough for a HUD "fog" suffix. */
  get foggy(): boolean { return this.cur.fog > 0.4; }
  dispose(): void { this.sky?.dispose(); this.mist.dispose(); }
}
