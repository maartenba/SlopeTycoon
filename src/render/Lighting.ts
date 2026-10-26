import * as THREE from 'three';

type V3 = [number, number, number];

export interface LightingParams {
  /** Unit vector from the scene towards the sun (or the moon at night). */
  sunDir: V3;
  sunColor: V3;
  sunIntensity: number;
  hemiSky: V3;
  hemiGround: V3;
  hemiIntensity: number;
  background: V3;
  /** Uniform values for the custom terrain/water/prop shaders (they do their own lighting). */
  shaderSun: V3;
  shaderSky: V3;
  shaderGround: V3;
  /** 0 = full day, 1 = full night (for emissive windows etc.). */
  night: number;
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const DAY_SUN: V3 = [1.0, 0.94, 0.82], WARM_SUN: V3 = [1.0, 0.55, 0.3], MOON: V3 = [0.35, 0.45, 0.85];
const DAY_SKY: V3 = [0.84, 0.9, 1.0], NIGHT_SKY: V3 = [0.09, 0.13, 0.3];
const DAY_GROUND: V3 = [0.43, 0.36, 0.38], NIGHT_GROUND: V3 = [0.03, 0.03, 0.07];
const DAY_BG: V3 = [0.663, 0.831, 0.961], NIGHT_BG: V3 = [0.05, 0.08, 0.19], DUSK_BG: V3 = [0.93, 0.5, 0.38];
// Baselines of the custom shaders (daytime values).
const SH_SUN: V3 = [0.82, 0.73, 0.55], SH_SKY: V3 = [0.50, 0.57, 0.69], SH_GROUND: V3 = [0.35, 0.30, 0.27];
const SH_SUN_WARM: V3 = [0.95, 0.6, 0.38], SH_MOON: V3 = [0.09, 0.13, 0.28], SH_SKY_NIGHT: V3 = [0.08, 0.11, 0.22], SH_GROUND_NIGHT: V3 = [0.03, 0.03, 0.06];

/** Sunrise / sunset hours of the day being lit (see sim/Daylight.ts). Default (omitted) = the legacy fixed 6:00 / 18:00 day. */
export interface SunTimesArg { sunrise: number; sunset: number }
const LEGACY_SUN: SunTimesArg = { sunrise: 6, sunset: 18 };

/**
 * Pure day/night model. hour in [0,24); `sun` = today's sunrise/sunset (default 6/18). Continuous in `hour` (wraps at 24) and at the horizon crossings.
 * The sun/moon ride a true arc between the horizon times (long summer days, long winter nights); the glow / day factor use hours-from-horizon so the
 * dawn & dusk transition lasts the same wall-clock time all year (the original 12 h shape: sin(pi * dt / 12)).
 */
export function lightingAt(hourIn: number, sun?: SunTimesArg): LightingParams {
  const hour = ((hourIn % 24) + 24) % 24;
  const { sunrise, sunset } = sun ?? LEGACY_SUN;
  const D = sunset - sunrise, N = 24 - D;
  let a: number, dt: number;
  if (hour >= sunrise && hour <= sunset) { a = (Math.PI * (hour - sunrise)) / D; dt = Math.min(hour - sunrise, sunset - hour); }
  else {
    const since = hour > sunset ? hour - sunset : hour + 24 - sunset; // hours since sunset, 0..N
    a = Math.PI + (Math.PI * since) / N; dt = -Math.min(since, N - since);
  }
  const s = Math.sin((Math.PI * Math.max(-6, Math.min(6, dt))) / 12); // glow shape in wall-clock hours from the nearest horizon crossing
  const c = Math.cos(a);
  const day = smooth(-0.4, 0.3, s); // 0 at night, 1 by mid-morning; low edge -0.4 = long dusk/dawn, short true-dark window (visual night compression)
  const warm = Math.exp(-Math.pow(s / 0.4, 2)); // sunrise/sunset glow (wide golden hours)
  // The moon rides the sun's arc mirrored below the horizon; elevation floor keeps it continuous at the horizon. Summer sun climbs higher.
  const peak = sun && s > 0 ? 0.8 + 0.2 * Math.min(1, Math.max(0, (D - 9) / 6.5)) : 1;
  const el = 0.15 + 0.85 * Math.abs(Math.sin(a)) * peak;
  const dir = new THREE.Vector3(-c, el, 0.5).normalize();
  const sunDay = mix(DAY_SUN, WARM_SUN, warm);
  const sunColor = mix(MOON, sunDay, smooth(-0.3, 0.0, s)); // colour flips faster than intensity so the horizon sun is warm, not moon-blue
  const shSunDay = mix(SH_SUN, SH_SUN_WARM, warm);
  return {
    sunDir: [dir.x, dir.y, dir.z],
    sunColor,
    sunIntensity: 0.34 + 1.2 * day,
    hemiSky: mix(NIGHT_SKY, DAY_SKY, day),
    hemiGround: mix(NIGHT_GROUND, DAY_GROUND, day),
    hemiIntensity: 0.35 + 0.65 * day,
    background: mix(mix(NIGHT_BG, DAY_BG, day), DUSK_BG, warm * 0.45),
    shaderSun: mix(SH_MOON, shSunDay, day),
    shaderSky: mix(SH_SKY_NIGHT, SH_SKY, day),
    shaderGround: mix(SH_GROUND_NIGHT, SH_GROUND, day),
    night: 1 - day,
  };
}

/**
 * Single night/day model: the three lights used by standard (Lambert) materials are DERIVED from the shader values.
 * three r155+ (no legacy lights) shades Lambert as albedo/PI * irradiance, while the custom shaders (terrain, water, props) use
 * albedo * (ambient + sun * n.l) with no 1/PI. So lights get intensity PI and the shader colours (linear), which makes both paths
 * produce identical radiance for the same albedo. (Before: lights were sRGB colours x 0.35..1.5 => ~3x darker by day and >30x darker at night.)
 */
export interface StandardLights { sunColor: V3; sunIntensity: number; hemiSky: V3; hemiGround: V3; hemiIntensity: number }
export function standardLights(p: LightingParams): StandardLights {
  return { sunColor: p.shaderSun, sunIntensity: Math.PI, hemiSky: p.shaderSky, hemiGround: p.shaderGround, hemiIntensity: Math.PI };
}
/** Pure: sky gradient (top, horizon) in sRGB for the page background behind the canvas: deeper blue overhead by day, warm band at dusk. */
export function skyGradient(p: LightingParams): { top: V3; horizon: V3 } {
  const day = 1 - p.night;
  const deep: V3 = mix([0.04, 0.07, 0.2], [0.30, 0.55, 0.90], day);
  const top = mix(deep, [0.55, 0.32, 0.48], Math.max(0, p.night * (1 - p.night) * 2.2));
  const horizon = mix(p.background, [0.97, 0.95, 0.90], 0.35 * day);
  return { top, horizon };
}
/** CSS gradient for the sky element; `horizonAt` = where (0..1 of the screen height) the horizon colour is reached (iso: 0.7; ride views follow the camera pitch). */
export function skyCss(g: { top: V3; horizon: V3 }, horizonAt = 0.7): string {
  const pct = Math.round(Math.min(1, Math.max(0.05, horizonAt)) * 1000) / 10;
  return `linear-gradient(180deg, ${css(g.top)} 0%, ${css(g.horizon)} ${pct}%, ${css(g.horizon)} 100%)`;
}
const css = (c: V3): string => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

/** Rec.709 luminance of a linear colour. */
export const luminance = (c: V3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

interface Uniforms { uSunDir?: { value: THREE.Vector3 }; uSunColor?: { value: THREE.Color }; uSkyColor?: { value: THREE.Color }; uGroundColor?: { value: THREE.Color }; uHazeColor?: { value: THREE.Color } }

/** Light/background colours are authored in sRGB (like the original hex values); shader uniform colours are raw linear values, as before. */
/** Applies lightingAt() to the scene lights, background and shader uniforms. Shadow toggle (Renderer.setShadows) is untouched. */
export class Lighting {
  private sinks: Uniforms[] = [];
  /** Shared 0..1 night factor; building window materials can read/bind this (not wired yet). */
  readonly nightUniform = { value: 0 };

  constructor(private sun: THREE.DirectionalLight, private hemi: THREE.HemisphereLight, private scene: THREE.Scene, private sunDistance: number) {}

  /** Register shader uniform sets (e.g. terrain.material.uniforms, water.uniforms, prop uniforms). Their Vector3/Color objects are mutated in place. */
  addUniforms(u: Uniforms): void { this.sinks.push(u); }

  /** Debug: render daytime lighting regardless of the clock. */
  disableNight = false;
  last: LightingParams | null = null;
  /** When set, the sky is a CSS gradient on this element behind a transparent canvas (scene.background stays null). */
  skyElement: HTMLElement | null = null;
  /** Ride views: where the horizon sits on screen (fraction of the height from the top); null = iso (0.7). Re-applied on the next `apply` / `refreshSky`. */
  horizonAt: number | null = null;
  /** Called with the sRGB horizon colour whenever the sky is applied (fog tint). */
  onHorizon: ((c: V3) => void) | null = null;

  apply(hourIn: number, sun?: SunTimesArg): LightingParams {
    const hour = this.disableNight ? 12 : hourIn;
    const p = lightingAt(hour, sun);
    this.last = p;
    const L = standardLights(p);
    this.sun.position.set(p.sunDir[0] * this.sunDistance, p.sunDir[1] * this.sunDistance, p.sunDir[2] * this.sunDistance);
    this.sun.color.setRGB(...L.sunColor, THREE.LinearSRGBColorSpace);
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.setRGB(...L.hemiSky, THREE.LinearSRGBColorSpace);
    this.hemi.groundColor.setRGB(...L.hemiGround, THREE.LinearSRGBColorSpace);
    this.hemi.intensity = L.hemiIntensity;
    if (this.skyElement) {
      const g = skyGradient(p);
      this.skyElement.style.background = skyCss(g, this.horizonAt ?? 0.7);
      this.scene.background = null;
      this.onHorizon?.(g.horizon);
    } else if (this.scene.background instanceof THREE.Color) this.scene.background.setRGB(...p.background, THREE.SRGBColorSpace);
    else this.scene.background = new THREE.Color().setRGB(...p.background, THREE.SRGBColorSpace);
    for (const u of this.sinks) {
      u.uSunDir?.value.set(...p.sunDir);
      u.uSunColor?.value.setRGB(...p.shaderSun);
      u.uSkyColor?.value.setRGB(...p.shaderSky);
      u.uGroundColor?.value.setRGB(...p.shaderGround);
      u.uHazeColor?.value.setRGB(...p.background, THREE.SRGBColorSpace);
    }
    this.nightUniform.value = p.night;
    return p;
  }

  /** Re-applies only the sky gradient (cheap): used every frame in ride views while the horizon line moves with the camera pitch. */
  refreshSky(): void {
    if (!this.skyElement || !this.last) return;
    const g = skyGradient(this.last);
    this.skyElement.style.background = skyCss(g, this.horizonAt ?? 0.7);
    this.onHorizon?.(g.horizon);
  }
}
