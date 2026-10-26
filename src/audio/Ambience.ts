import { Rng } from '../core/Rng';
import type { AudioEngine } from './AudioEngine';
import type { SfxName, Sfx } from './Sfx';
import type { NodeLike, ParamLike } from './backend';
import type { NodeScope } from './synth';
import type { SeasonId, WeatherKind } from '../core/events';

export interface AmbienceState {
  season: SeasonId;
  weather: WeatherKind;
  /** Fractional hour of day 0..24. */
  hour: number;
  /** Today's sunrise / sunset hours (defaults 6.5 / 18.5, the equinox). */
  sunrise?: number;
  sunset?: number;
  /** Visible world height in tiles (camera.top - camera.bottom): small = zoomed in. */
  zoom: number;
  /** Camera target altitude, 0 (valley) .. 1 (summit). */
  altitude: number;
  /** Weather wind 0..1. */
  wind: number;
  /** Water tiles near the camera target, 0..1. */
  water: number;
  /** Guests within the listening radius. */
  crowd: number;
  /** Active-lift proximity 0..1 (1 = camera at a running lift). */
  lifts: number;
  /** Buildings (village) proximity 0..1. */
  buildings: number;
  /** Cows near the camera. */
  cows: number;
  /** Snowcat grooming proximity 0..1 (0 = none active). */
  snowcat: number;
  /** Rescue helicopter proximity 0..1 (0 = none airborne). */
  heli: number;
  /** Walk mode: forest wind shelter 0..1 (0 = open ground, 1 = >= SHELTER.fullTrunks tree trunks within SHELTER.radius tiles). Only the walker's near-field view sets it. */
  shelter?: number;
}

/** Forest wind shelter: standing among trunks takes the edge off the wind bed. */
export const SHELTER = {
  /** Trunks within `radius` tiles of the walker for the full effect. */
  fullTrunks: 10, radius: 6,
  /** Wind bed reduction at full shelter (30 %). */
  windCut: 0.3,
} as const;
/** Pure: shelter 0..1 from a trunk count (linear up to SHELTER.fullTrunks). */
export const shelterFromTrunks = (n: number): number => Math.min(1, Math.max(0, n / SHELTER.fullTrunks));

export const LAYER_IDS = ['wind', 'rain', 'leaves', 'crickets', 'insects', 'crowd', 'lift', 'water', 'snowcat', 'heli', 'muffled'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export const ONESHOT_IDS = ['birds', 'cowbells', 'bells', 'clanks', 'drips', 'creaks'] as const;
export type OneShotId = (typeof ONESHOT_IDS)[number];
export type AmbienceMix = Record<LayerId | OneShotId, number>;

/** Tunable constants (documented in docs/audio.md). */
export const AMB = {
  /** Zoom (visible tiles) at which a view counts as fully 'close' / fully 'far'. */
  closeZoom: 10, farZoom: 60,
  /** Walk mode (Task 12): the listener is the walker, which counts as a very close view (zoom proxy). Crowd / lift / birds / water are then at their near-field levels; the probe radius shrinks to ~8 tiles around the walker. */
  walkZoom: 6,
  /** Max one-shot rates per second at intensity 1. */
  rates: { birds: 2.2, cowbells: 0.4, clanks: 0.7, drips: 1.2, creaks: 0.15 } as const,
  /** Per-layer ceiling (linear gain on the ambience bus). */
  layerMax: { wind: 0.2, rain: 0.245, leaves: 0.25, crickets: 0.12, insects: 0.1, crowd: 0.3, lift: 0.28, water: 0.3, snowcat: 0.3, heli: 0.35, muffled: 0.175 } as Record<LayerId, number>,
  /** Layer crossfade time constant (s). */
  fadeTc: 0.9,
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** Smooth bump: 1 between (a,b), ramping over `ramp` hours either side (no wrap). */
const window = (h: number, a: number, b: number, ramp = 1): number => clamp01(Math.min((h - (a - ramp)) / ramp, ((b + ramp) - h) / ramp));

/** Pure: game + camera state -> target gains (0..1) for the loop layers and intensities for the one-shot generators. */
export function ambienceMix(s: AmbienceState): AmbienceMix {
  const close = clamp01((AMB.farZoom - s.zoom) / (AMB.farZoom - AMB.closeZoom)), far = 1 - close;
  const h = ((s.hour % 24) + 24) % 24;
  const sr = s.sunrise ?? 6.5, ss = s.sunset ?? 18.5; // windows follow the sun (defaults reproduce the original fixed hours)
  const day = window(h, sr + 1, ss), dawn = window(h, sr - 1, sr + 2), dusk = window(h, ss - 0.5, ss + 3.5), night = 1 - window(h, sr - 1, ss + 3, 1.5);
  const winter = s.season === 'winter', summer = s.season === 'summer', spring = s.season === 'spring', autumn = s.season === 'autumn';
  const storm = s.weather === 'storm', rain = s.weather === 'rain', snowy = s.weather === 'snow' || s.weather === 'heavySnow';
  const wet = storm ? 1 : rain ? 0.7 : 0;
  const quiet = snowy ? 0.6 : 1; // snowfall softens everything
  const alt = clamp01(s.altitude), wind01 = clamp01(s.wind);

  const wind = clamp01(0.16 + 0.38 * alt + 0.45 * wind01 + (storm ? 0.3 : 0) + far * 0.1 + (winter || autumn ? 0.08 : 0)) * (snowy && !storm ? 0.75 : 1) * (night > 0.5 ? 0.85 : 1) * (1 - SHELTER.windCut * clamp01(s.shelter ?? 0));
  const muffled = clamp01((winter ? 0.4 : 0) + (snowy ? 0.45 : 0)) * (0.6 + 0.4 * close);
  const birdSeason = summer ? 0.8 : spring ? 0.65 : autumn ? 0.15 : 0.02;
  const birds = clamp01(birdSeason * (0.45 * day + 0.55 * dawn)) * (1 - wet) * (0.4 + 0.6 * close) * quiet;
  const warm = summer ? 1 : spring || autumn ? 0.25 : 0;
  const crickets = clamp01(warm * clamp01(dusk * 0.9 + night * 0.7)) * (1 - wet) * (0.3 + 0.7 * close);
  const insects = summer ? day * close * (1 - wet) * 0.8 : 0;
  const rainL = wet * (0.7 + 0.3 * close);
  const leaves = autumn ? clamp01(0.25 + wind01) * (0.5 + 0.5 * close) * (1 - wet * 0.5) : 0;
  const crowdLevel = 1 - Math.exp(-Math.max(0, s.crowd) / 30);
  const crowd = crowdLevel * (0.5 + 0.5 * close) * (1 - 0.8 * night) * quiet;
  const lift = clamp01(s.lifts) * (0.2 + 0.8 * close) * (1 - 0.5 * night);
  const waterSeason = winter ? 0.3 : spring ? 1 : 0.8;
  const water = clamp01(s.water) * (0.3 + 0.7 * close) * waterSeason;
  const snowcat = clamp01(s.snowcat) * night * (0.4 + 0.6 * close);
  const heli = clamp01(s.heli) * (0.5 + 0.5 * close);
  const cowSeason = summer ? 1 : spring || autumn ? 0.4 : 0;
  const cowbells = cowSeason * (1 - Math.exp(-Math.max(0, s.cows) / 3)) * close * day * (1 - wet);
  const bells = clamp01(s.buildings) * day * close;
  const clanks = lift * 0.9;
  const drips = spring ? close * clamp01(0.3 + day) * (1 - wet * 0.5) * 0.6 : 0;
  const creaks = winter ? close * (0.3 + 0.5 * night) * quiet : 0;
  return { wind, rain: rainL, leaves, crickets, insects, crowd, lift, water, snowcat, heli, muffled, birds, cowbells, bells, clanks, drips, creaks };
}

type Builder = (s: NodeScope) => void;
const link = (...n: NodeLike[]): void => { for (let i = 0; i < n.length - 1; i++) n[i]!.connect(n[i + 1]!); };
/** Slow LFO modulating `param` by +-depth. */
function lfo(s: NodeScope, hz: number, depth: number, param: ParamLike, type = 'sine'): void {
  const o = s.osc(type, hz), g = s.gain(depth);
  o.connect(g); g.connect(param as unknown as NodeLike);
}

/** Layer recipes: built once, then only their out-gain moves. Node counts are tiny (see tests budget). */
const LAYER_BUILDERS: Record<LayerId, Builder> = {
  wind: (s) => { const n = s.noiseSrc('pink'), f = s.filter('bandpass', 420, 0.6), gust = s.gain(0.5); lfo(s, 0.06, 140, f.frequency); lfo(s, 0.11, 0.25, gust.gain); link(n, f, gust, s.out); },
  rain: (s) => { const n = s.noiseSrc('white'), hp = s.filter('highpass', 1400, 0.7), lp = s.filter('lowpass', 9000, 0.7); link(n, hp, lp, s.out); },
  leaves: (s) => { const n = s.noiseSrc('white'), f = s.filter('bandpass', 4500, 1), gust = s.gain(0.5); lfo(s, 0.3, 0.4, gust.gain); link(n, f, gust, s.out); },
  crickets: (s) => { const o = s.osc('sine', 4300), amp = s.gain(0.25), gate = s.gain(0.5); lfo(s, 26, 0.25, amp.gain, 'square'); lfo(s, 2.5, 0.5, gate.gain, 'square'); link(o, amp, gate, s.out); },
  insects: (s) => { const n = s.noiseSrc('white'), f = s.filter('bandpass', 6200, 9), amp = s.gain(0.5); lfo(s, 38, 0.5, amp.gain); link(n, f, amp, s.out); },
  crowd: (s) => {
    const n = s.noiseSrc('pink'), a = s.filter('bandpass', 520, 1.1), b = s.filter('bandpass', 1250, 1.3), sum = s.gain(0.8);
    lfo(s, 0.17, 0.25, sum.gain); n.connect(a); n.connect(b); link(a, sum); link(b, sum, s.out);
  },
  lift: (s) => { const o = s.osc('sawtooth', 48), o2 = s.osc('sine', 96), f = s.filter('lowpass', 380, 0.7), n = s.noiseSrc('brown'), nf = s.filter('lowpass', 300, 0.7); const og = s.gain(0.5); o.connect(f); o2.connect(f); link(f, og, s.out); link(n, nf, s.out); },
  water: (s) => { const n = s.noiseSrc('white'), f = s.filter('bandpass', 1800, 0.8), gust = s.gain(0.7); lfo(s, 0.5, 0.2, gust.gain); lfo(s, 1.37, 0.12, gust.gain); link(n, f, gust, s.out); },
  snowcat: (s) => { const o = s.osc('sawtooth', 38), o2 = s.osc('square', 76), f = s.filter('lowpass', 240, 0.8), n = s.noiseSrc('brown'); lfo(s, 9, 0.05, s.out.gain); o.connect(f); o2.connect(f); n.connect(f); link(f, s.out); },
  heli: (s) => { const n = s.noiseSrc('pink'), lp = s.filter('lowpass', 900, 0.7), chop = s.gain(0.5), o = s.osc('sine', 90), og = s.gain(0.3); lfo(s, 11, 0.5, chop.gain); link(n, lp, chop, s.out); link(o, og, s.out); },
  muffled: (s) => { const n = s.noiseSrc('brown'), f = s.filter('lowpass', 250, 0.7); link(n, f, s.out); },
};

/** Hour-chime strikes for the village church. */
export function churchStrikes(hour: number, sunrise = 7, sunset = 19): number { return hour < sunrise + 1 || hour > sunset + 1 ? 0 : Math.min(3, ((hour + 11) % 12) + 1); }

/** Cosmetic-only randomness (never feeds the simulation), seeded from the clock so sessions differ. */
function defaultRng(): () => number { const r = new Rng((Date.now() ^ 0x5bd1e995) >>> 0); return () => r.next(); }

export class Ambience {
  private layers: Partial<Record<LayerId, NodeScope>> = {};
  private built = false;
  mix: AmbienceMix | null = null;
  lastState: AmbienceState | null = null;
  /** liftPan for clanks (-1..1). */
  liftPan = 0;

  constructor(private engine: AudioEngine, private sfx: Sfx, private rng: () => number = defaultRng()) {}

  get layerCount(): number { return Object.keys(this.layers).length; }

  private ensureBuilt(): void {
    if (this.built || !this.engine.running) return;
    this.built = true;
    for (const id of LAYER_IDS) { const l = this.engine.createLayer('ambience', LAYER_BUILDERS[id]); if (l) this.layers[id] = l; }
  }

  /** Throttled (≈10 Hz) update. `dt` = seconds since the previous call. Allocation-light: no nodes are created here. */
  update(s: AmbienceState, dt: number): AmbienceMix {
    const mix = ambienceMix(s);
    this.mix = mix; this.lastState = s;
    if (!this.engine.running) return mix;
    this.ensureBuilt();
    const t = this.engine.now();
    for (const id of LAYER_IDS) this.layers[id]?.out.gain.setTargetAtTime(mix[id] * AMB.layerMax[id], t, AMB.fadeTc);
    const roll = (id: keyof typeof AMB.rates, sfx: SfxName, base: number): void => {
      const rate = mix[id] * AMB.rates[id];
      if (rate > 0.001 && this.rng() < rate * dt) this.sfx.play(sfx, { pitch: base * (0.85 + this.rng() * 0.4), pan: (this.rng() * 2 - 1) * 0.7, gain: 0.5 + 0.5 * mix[id] });
    };
    roll('birds', 'birdChirp', 1); roll('cowbells', 'cowbell', 1); roll('drips', 'drip', 1); roll('creaks', 'creak', 1);
    const cr = mix.clanks * AMB.rates.clanks;
    if (cr > 0.001 && this.rng() < cr * dt) this.sfx.play('clank', { pitch: 0.8 + this.rng() * 0.3, pan: this.liftPan, gain: 0.3 + 0.7 * mix.clanks });
    return mix;
  }

  /** Called on `time:hour`: the village church strikes during the day when near buildings. */
  onHour(hour: number): void {
    if (!this.mix || this.mix.bells < 0.15) return;
    const n = churchStrikes(hour, this.lastState?.sunrise, this.lastState?.sunset);
    for (let i = 0; i < n; i++) this.sfx.play('churchBell', { delay: i * 1.8, gain: 0.4 + 0.6 * this.mix.bells });
  }

  dispose(): void { for (const id of LAYER_IDS) this.layers[id]?.dispose(); this.layers = {}; this.built = false; }
}
