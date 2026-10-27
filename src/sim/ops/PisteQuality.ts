import { Layer } from '../../world/Networks';
import { hash01 } from '../Weather';

/** Per-tile piste surface quality. 0 = not a piste / uninitialised. */
export const Q = { None: 0, Powder: 1, Groomed: 2, Packed: 3, Icy: 4, Bumpy: 5, Slush: 6 } as const;
export type QualityId = (typeof Q)[keyof typeof Q];
export const QUALITY_NAMES = ['None', 'Powder', 'Groomed', 'Packed', 'Icy', 'Bumpy', 'Slush'] as const;

/** Tuning (wear = weighted guest passes since the last grooming / snowfall). */
export const PQ = {
  /** Below this snow depth (m) nothing changes (bare piste). */
  minDepth: 0.15,
  wearToPacked: 8,
  wearToBumpy: 40,
  wearToIcy: 130,
  slushStartTemp: 2,
  slushEndTemp: 0.2,
  icyColdTemp: -5,
  ticksPerHour: 10,
} as const;

/** Lightweight guest-pass counter: the ski movement step calls `PisteTraffic.record(tile)`; PisteQuality drains it hourly. */
export const PisteTraffic = {
  sink: null as Uint16Array | null,
  record(tile: number): void { const s = PisteTraffic.sink; if (s && s[tile]! < 65535) s[tile]!++; },
};

/** Subset of Networks the quality model reads. */
export interface PisteNetworkLike { readonly layers: Uint8Array; readonly kind: Uint8Array; readonly difficulty: Uint8Array }

/** Inputs for one in-game hour (identical for every row slice of that hour => slice-size independent). */
export interface HourCtx {
  /** Monotonic hour stamp (absDay*24+hour). */
  stamp: number;
  hour: number;
  clear: boolean;
  /** Temperature (°C) at altitude (world units) for this hour. */
  temp(alt: number): number;
  /** Is it snowing at altitude (world units) this hour? */
  snowing(alt: number): boolean;
}

/**
 * Per-tile piste quality state machine (deterministic, hash-based randomness only). State is stored in a dedicated Uint8 array
 * (`state`) plus a wear counter; `Networks.quality` is left untouched.
 */
export class PisteQuality {
  readonly state: Uint8Array;
  readonly wear: Uint16Array;
  readonly traffic: Uint16Array;
  /** Tile visits accumulated since the day started (reset daily by the ops system); the current hour's `traffic` is added on top for display. */
  readonly trafficDay: Uint16Array;
  /** Observer hook: called just before `trafficDay` is zeroed at the day boundary (weekly run traffic). */
  onDayRollover: (() => void) | null = null;
  /** Bumped when any state flips (overlay refresh). */
  version = 0;
  changedLast = 0;

  constructor(readonly size: number, private net: PisteNetworkLike, private snowDepth: Float32Array, private altOf: (x: number, y: number) => number) {
    const n = size * size;
    this.state = new Uint8Array(n); this.wear = new Uint16Array(n); this.traffic = new Uint16Array(n); this.trafficDay = new Uint16Array(n);
  }

  /** Make `PisteTraffic.record` feed this instance. */
  attachTraffic(): void { PisteTraffic.sink = this.traffic; }

  isPiste(i: number): boolean { return (this.net.layers[i]! & Layer.Ski) !== 0 && this.net.kind[i] === 0; }
  at(i: number): number { return this.state[i]!; }

  /** Observer hook (run bookkeeping): called with every groomed tile. */
  onGroom: ((i: number) => void) | null = null;
  /** Set a tile groomed (called by grooming vehicles). */
  groom(i: number): void {
    this.onGroom?.(i);
    if (this.state[i] !== Q.Groomed) { this.state[i] = Q.Groomed; this.version++; }
    this.wear[i] = 0;
  }

  /** Update rows [y0,y1) for one hour context. */
  updateRows(y0: number, y1: number, ctx: HourCtx): void {
    const N = this.size, st = this.state, wr = this.wear, tr = this.traffic, td = this.trafficDay, lay = this.net.layers, knd = this.net.kind, dif = this.net.difficulty;
    let changed = 0;
    for (let y = Math.max(0, y0); y < Math.min(N, y1); y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if ((lay[i]! & Layer.Ski) === 0 || knd[i] !== 0) { if (st[i]) { st[i] = 0; wr[i] = 0; changed++; } continue; }
        let s = st[i]!;
        const old = s;
        if (s === Q.None) s = Q.Packed;
        const diff = dif[i]!;
        let w = Math.min(65535, wr[i]! + tr[i]! * (1 + diff * 0.25));
        if (tr[i]) { td[i] = Math.min(65535, td[i]! + tr[i]!); tr[i] = 0; }
        if (this.snowDepth[i]! >= PQ.minDepth) {
          const alt = this.altOf(x, y);
          const T = ctx.temp(alt);
          if (ctx.snowing(alt)) { s = Q.Powder; w = 0; }
          else {
            const steep = 1 + diff * 0.5;
            if (s === Q.Groomed) { if (w >= PQ.wearToPacked) s = Q.Packed; }
            else if (s === Q.Powder) {
              if (diff >= 1 && w >= (PQ.wearToBumpy * 0.6) / steep) s = Q.Bumpy;
              else if (w >= PQ.wearToPacked) s = Q.Packed;
            } else if (s === Q.Packed) {
              if (diff >= 1 && w >= PQ.wearToBumpy / steep) s = Q.Bumpy;
              else if (w >= PQ.wearToIcy) s = Q.Icy;
            } else if (s === Q.Bumpy) { if (w >= PQ.wearToIcy * 1.5) s = Q.Icy; }
            // thermal (hysteresis: slush starts at +2 °C, ends below +0.2 °C and refreezes to ice)
            if (s === Q.Slush) { if (T <= PQ.slushEndTemp) s = Q.Icy; }
            else if (ctx.hour >= 11 && ctx.hour < 18 && T >= PQ.slushStartTemp && (s === Q.Powder || s === Q.Groomed || s === Q.Packed)) s = Q.Slush;
            else if (s === Q.Packed || s === Q.Bumpy) {
              if (ctx.hour < 8 && ctx.clear && T <= PQ.icyColdTemp && hash01(i, ctx.stamp) < 0.25) s = Q.Icy;
              else if (s === Q.Packed && this.snowDepth[i]! < 0.4 && hash01(i, ctx.stamp) < 0.08) s = Q.Icy;
            }
          }
        }
        wr[i] = w;
        if (s !== old) { st[i] = s; changed++; }
      }
    }
    this.changedLast = changed;
    if (changed) this.version++;
  }

  /** Average preference (-1..1) of a skill over all piste tiles (cheap cache-able summary for run choice). */
  averagePreference(skill: number): number {
    let sum = 0, n = 0;
    for (let i = 0; i < this.state.length; i++) { const q = this.state[i]!; if (q) { sum += qualityPreference(skill, q); n++; } }
    return n ? sum / n : 0;
  }

  /** FNV-1a over state + wear (determinism tests / stateHash). */
  hash(): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.state.length; i++) { h ^= this.state[i]!; h = Math.imul(h, 0x01000193) >>> 0; h ^= this.wear[i]! & 255; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  counts(): number[] {
    const c = new Array<number>(7).fill(0);
    for (const q of this.state) c[q]!++;
    return c;
  }
}

/** Skill 0..3 (beginner..expert) x quality (Powder, Groomed, Packed, Icy, Bumpy, Slush) -> liking -1..1. */
const PREF: number[][] = [
  [0.3, 1.0, 0.5, -1.0, -0.7, -0.4], // beginner: wants groomed
  [0.5, 0.9, 0.7, -0.8, -0.1, -0.2], // intermediate: groomed/packed
  [0.9, 0.7, 0.4, -0.6, 0.5, 0.0], // advanced
  [1.0, 0.5, 0.2, -0.5, 0.9, 0.1], // expert: powder and moguls
];
/** How much a guest of `skill` likes a surface (-1..1). Icy hurts everyone, beginners most. */
export function qualityPreference(skill: number, quality: number): number {
  if (quality < 1 || quality > 6) return 0;
  return PREF[Math.max(0, Math.min(3, skill | 0))]![quality - 1]!;
}
/** Skiing speed multiplier by surface. */
export function qualitySpeedFactor(quality: number): number {
  switch (quality) {
    case Q.Groomed: return 1.1; case Q.Powder: return 0.9; case Q.Packed: return 1.0;
    case Q.Icy: return 1.05; case Q.Bumpy: return 0.8; case Q.Slush: return 0.75; default: return 1;
  }
}
/** Maps preference to the 0..1 `quality` argument of injuryRisk() (0.5 neutral; lower = riskier). */
export function qualityInjuryScale(skill: number, quality: number): number {
  const p = qualityPreference(skill, quality);
  return Math.max(0, Math.min(1, 0.5 + 0.25 * p + (quality === Q.Icy ? -0.15 : 0)));
}
