import { AudioEngine, PRIORITY, type BusId } from './AudioEngine';
import { midiToHz, pluckEnv, swellEnv, type NodeScope } from './synth';
import type { GainLike, NodeLike } from './backend';

export const SFX_NAMES = [
  'click', 'hover', 'tick', 'blip', 'thud', 'crunch', 'scrape', 'kaching', 'clank', 'bell', 'grind', 'alarm',
  'chimeInfo', 'chimeImportant', 'chimeCritical', 'rescue', 'avalanche', 'bankruptcy', 'ratingUp', 'ratingDown', 'season',
  'birdChirp', 'cowbell', 'churchBell', 'drip', 'creak', 'shutter',
  'stepSnow', 'stepGravel', 'stepGrass', 'stepWood', 'stepRoad', 'crossingBell',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export interface PlayOpts { pitch?: number; pan?: number; gain?: number; /** kaching: extra coins coalesced into the arpeggio. */ count?: number; delay?: number }

interface Recipe {
  priority: number;
  bus: BusId;
  dur: number;
  /** Rate limit: at most `maxPerSec` starts per second, at least `minGap` seconds between starts. */
  maxPerSec: number;
  minGap: number;
  /** Shared limiter group (alerts never stack). */
  group?: string;
  /** Scaled by engine.loudScale ('reduce loud sounds'). */
  loud?: boolean;
  build(s: NodeScope, o: Required<Pick<PlayOpts, 'pitch' | 'gain'>> & PlayOpts): void;
}

const connectChain = (...n: NodeLike[]): void => { for (let i = 0; i < n.length - 1; i++) n[i]!.connect(n[i + 1]!); };
/** Routes `src` through an optional panner into scope.out. */
function toOut(s: NodeScope, src: NodeLike, pan: number | undefined, gain: number): GainLike {
  const g = s.gain(gain);
  if (pan) connectChain(src, g, s.pan(pan), s.out); else connectChain(src, g, s.out);
  return g;
}
/** Percussive tone: osc through its own envelope gain. */
function tone(s: NodeScope, type: string, hz: number, at: number, peak: number, decay: number, pan?: number, attack = 0.004): void {
  const o = s.osc(type, hz), e = s.gain(0);
  pluckEnv(e.gain, s.t0 + at, peak, attack, decay);
  connectChain(o, e);
  toOut(s, e, pan, 1);
}
/** Bell: inharmonic partials with decays ~ 1/partial index. */
function bell(s: NodeScope, hz: number, at: number, peak: number, decay: number, pan?: number): void {
  const parts: Array<[number, number]> = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]];
  for (const [r, a] of parts) tone(s, 'sine', hz * r, at, peak * a, decay / (0.6 + r * 0.4), pan, 0.002);
}
function noiseHit(s: NodeScope, kind: 'white' | 'pink' | 'brown', ftype: string, f: number, q: number, at: number, peak: number, decay: number, pan?: number, fEnd?: number): void {
  const n = s.noiseSrc(kind), flt = s.filter(ftype, f, q), e = s.gain(0);
  if (fEnd) { flt.frequency.setValueAtTime(f, s.t0 + at); flt.frequency.exponentialRampToValueAtTime(fEnd, s.t0 + at + decay); }
  pluckEnv(e.gain, s.t0 + at, peak, 0.003, decay);
  connectChain(n, flt, e);
  toOut(s, e, pan, 1);
}
const arp = (s: NodeScope, notes: number[], step: number, type: string, peak: number, decay: number, pan?: number): void => notes.forEach((m, i) => tone(s, type, midiToHz(m), i * step, peak, decay, pan));

export const RECIPES: Record<SfxName, Recipe> = {
  click: { priority: PRIORITY.action, bus: 'sfx', dur: 0.08, maxPerSec: 12, minGap: 0.04, build: (s, o) => { tone(s, 'triangle', 1500 * o.pitch, 0, 0.18 * o.gain, 0.03, o.pan); noiseHit(s, 'white', 'highpass', 4000, 1, 0, 0.05 * o.gain, 0.012, o.pan); } },
  /** Photo mode: a very soft double click (mechanical shutter), well under the click level; one per photo. */
  shutter: { priority: PRIORITY.action, bus: 'sfx', dur: 0.2, maxPerSec: 2, minGap: 0.4, build: (s, o) => { noiseHit(s, 'white', 'bandpass', 2600 * o.pitch, 1.2, 0, 0.05 * o.gain, 0.014, o.pan); tone(s, 'triangle', 900 * o.pitch, 0, 0.05 * o.gain, 0.02, o.pan); noiseHit(s, 'white', 'bandpass', 1900 * o.pitch, 1.2, 0.07, 0.04 * o.gain, 0.02, o.pan); tone(s, 'triangle', 620 * o.pitch, 0.07, 0.04 * o.gain, 0.025, o.pan); } },
  hover: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.05, maxPerSec: 8, minGap: 0.06, build: (s, o) => tone(s, 'sine', 2200 * o.pitch, 0, 0.05 * o.gain, 0.02, o.pan) },
  tick: { priority: PRIORITY.action, bus: 'sfx', dur: 0.06, maxPerSec: 8, minGap: 0.08, build: (s, o) => tone(s, 'triangle', 1100 * o.pitch, 0, 0.1 * o.gain, 0.025, o.pan) },
  blip: { priority: PRIORITY.action, bus: 'sfx', dur: 0.18, maxPerSec: 6, minGap: 0.08, build: (s, o) => { tone(s, 'square', 660 * o.pitch, 0, 0.06 * o.gain, 0.05, o.pan); tone(s, 'square', 880 * o.pitch, 0.05, 0.06 * o.gain, 0.07, o.pan); } },
  thud: { priority: PRIORITY.action, bus: 'sfx', dur: 0.5, maxPerSec: 5, minGap: 0.1, build: (s, o) => {
    const t = s.osc('sine', 120 * o.pitch), e = s.gain(0);
    t.frequency.setValueAtTime(120 * o.pitch, s.t0); t.frequency.exponentialRampToValueAtTime(42, s.t0 + 0.25);
    pluckEnv(e.gain, s.t0, 0.7 * o.gain, 0.004, 0.3); connectChain(t, e); toOut(s, e, o.pan, 1);
    noiseHit(s, 'brown', 'lowpass', 900, 0.7, 0, 0.35 * o.gain, 0.12, o.pan);
  } },
  crunch: { priority: PRIORITY.action, bus: 'sfx', dur: 0.4, maxPerSec: 6, minGap: 0.08, build: (s, o) => {
    for (let i = 0; i < 4; i++) noiseHit(s, 'white', 'bandpass', (1800 + i * 420) * o.pitch, 1.4, i * 0.045, 0.22 * o.gain, 0.07, o.pan);
    noiseHit(s, 'brown', 'lowpass', 500, 0.7, 0, 0.3 * o.gain, 0.2, o.pan);
  } },
  scrape: { priority: PRIORITY.action, bus: 'sfx', dur: 0.3, maxPerSec: 4, minGap: 0.15, build: (s, o) => noiseHit(s, 'pink', 'bandpass', 700 * o.pitch, 2, 0, 0.16 * o.gain, 0.22, o.pan, 380 * o.pitch) },
  kaching: { priority: PRIORITY.action, bus: 'sfx', dur: 0.9, maxPerSec: 3, minGap: 0.2, build: (s, o) => {
    const n = Math.min(4, 1 + (o.count ?? 0));
    const notes = [88, 91, 95, 100].slice(0, Math.max(2, n));
    arp(s, notes, 0.055, 'triangle', 0.12 * o.gain, 0.35, o.pan);
    bell(s, midiToHz(96) * o.pitch, 0.02, 0.08 * o.gain, 0.5, o.pan);
    noiseHit(s, 'white', 'highpass', 6000, 1, 0, 0.05 * o.gain, 0.02, o.pan);
  } },
  clank: { priority: PRIORITY.ambience, bus: 'ambience', dur: 0.35, maxPerSec: 3, minGap: 0.2, build: (s, o) => {
    tone(s, 'triangle', 150 * o.pitch, 0, 0.1 * o.gain, 0.08, o.pan, 0.004);
    tone(s, 'sine', 360 * o.pitch, 0, 0.04 * o.gain, 0.15, o.pan, 0.004);
    noiseHit(s, 'pink', 'bandpass', 1400, 0.8, 0, 0.05 * o.gain, 0.05, o.pan);
  } },
  bell: { priority: PRIORITY.action, bus: 'sfx', dur: 1.6, maxPerSec: 2, minGap: 0.3, build: (s, o) => bell(s, 660 * o.pitch, 0, 0.18 * o.gain, 1.2, o.pan) },
  grind: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.1, maxPerSec: 2, minGap: 0.5, loud: true, build: (s, o) => {
    const n = s.noiseSrc('brown'), f = s.filter('lowpass', 900, 2), e = s.gain(0), lfo = s.osc('sawtooth', 28), lg = s.gain(0.4);
    f.frequency.setValueAtTime(900, s.t0); f.frequency.exponentialRampToValueAtTime(120, s.t0 + 1);
    swellEnv(e.gain, s.t0, 0.5 * o.gain, 0.05, 1, 0.5);
    lfo.connect(lg); lg.connect(e.gain as unknown as NodeLike);
    connectChain(n, f, e); toOut(s, e, o.pan, 1);
  } },
  alarm: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.2, maxPerSec: 1, minGap: 1, loud: true, build: (s, o) => { for (let i = 0; i < 4; i++) tone(s, 'square', (i % 2 ? 740 : 988) * o.pitch, i * 0.28, 0.09 * o.gain, 0.2, o.pan); } },
  chimeInfo: { priority: PRIORITY.action, bus: 'sfx', dur: 0.8, maxPerSec: 2, minGap: 0.5, build: (s, o) => arp(s, [79, 84], 0.09, 'sine', 0.13 * o.gain, 0.4, o.pan) },
  chimeImportant: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.1, maxPerSec: 2, minGap: 0.9, group: 'alert', build: (s, o) => arp(s, [76, 83, 88], 0.11, 'sine', 0.16 * o.gain, 0.5, o.pan) },
  chimeCritical: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.3, maxPerSec: 2, minGap: 0.9, group: 'alert', loud: true, build: (s, o) => { arp(s, [72, 79, 72, 79], 0.16, 'triangle', 0.18 * o.gain, 0.35, o.pan); bell(s, 523 * o.pitch, 0, 0.1 * o.gain, 0.9, o.pan); } },
  rescue: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.2, maxPerSec: 2, minGap: 0.9, group: 'alert', build: (s, o) => arp(s, [72, 76, 79, 84], 0.1, 'sine', 0.16 * o.gain, 0.45, o.pan) },
  avalanche: { priority: PRIORITY.alert, bus: 'sfx', dur: 3.2, maxPerSec: 1, minGap: 2, group: 'alert', loud: true, build: (s, o) => {
    const n = s.noiseSrc('brown'), f = s.filter('lowpass', 260, 0.8), e = s.gain(0);
    f.frequency.setValueAtTime(260, s.t0); f.frequency.exponentialRampToValueAtTime(70, s.t0 + 3);
    swellEnv(e.gain, s.t0, 0.9 * o.gain, 0.35, 3.1, 2); connectChain(n, f, e); toOut(s, e, o.pan, 1);
    noiseHit(s, 'pink', 'lowpass', 600, 0.7, 0.05, 0.3 * o.gain, 0.6, o.pan);
  } },
  bankruptcy: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.6, maxPerSec: 1, minGap: 1.5, group: 'alert', loud: true, build: (s, o) => arp(s, [67, 63, 58, 51], 0.22, 'sawtooth', 0.1 * o.gain, 0.5, o.pan) },
  ratingUp: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.2, maxPerSec: 2, minGap: 0.8, build: (s, o) => arp(s, [72, 76, 79, 84, 88], 0.075, 'triangle', 0.14 * o.gain, 0.45, o.pan) },
  ratingDown: { priority: PRIORITY.alert, bus: 'sfx', dur: 1.0, maxPerSec: 2, minGap: 0.8, build: (s, o) => arp(s, [76, 72, 67], 0.12, 'triangle', 0.12 * o.gain, 0.4, o.pan) },
  season: { priority: PRIORITY.action, bus: 'sfx', dur: 2.2, maxPerSec: 1, minGap: 2, build: (s, o) => {
    for (const [i, m] of [60, 67, 72].entries()) {
      const osc = s.osc('sine', midiToHz(m) * o.pitch), e = s.gain(0);
      swellEnv(e.gain, s.t0 + i * 0.12, 0.07 * o.gain, 0.5, 2, 1.1); connectChain(osc, e); toOut(s, e, o.pan, 1);
    }
  } },
  // Soft natural-ish chirps: a pure sine with a short up-then-down pitch glide (and a faint 2nd harmonic), smooth attack, 2-4 syllables. No FM (the old 1.6:600 FM read as metallic beeps).
  birdChirp: { priority: PRIORITY.ambience, bus: 'ambience', dur: 0.7, maxPerSec: 3, minGap: 0.2, build: (s, o) => {
    const n = 2 + Math.floor(o.pitch * 1.7) % 3; // 2-4 syllables
    for (let i = 0; i < n; i++) {
      const at = s.t0 + i * (0.12 + 0.02 * (i % 2)), base = (2500 + ((i * 37 + Math.floor(o.pitch * 100)) % 5) * 150) * o.pitch, c = s.osc('sine', base), h = s.osc('sine', base * 2), hg = s.gain(0.12), e = s.gain(0);
      c.frequency.setValueAtTime(base, at); c.frequency.exponentialRampToValueAtTime(base * 1.22, at + 0.04); c.frequency.exponentialRampToValueAtTime(base * 0.92, at + 0.09);
      h.frequency.setValueAtTime(base * 2, at); h.frequency.exponentialRampToValueAtTime(base * 2.44, at + 0.04); h.frequency.exponentialRampToValueAtTime(base * 1.84, at + 0.09);
      swellEnv(e.gain, at, 0.035 * o.gain, 0.02, 0.1, 0.06);
      connectChain(c, e); connectChain(h, hg, e); toOut(s, e, o.pan, 1);
    }
  } },
  // Rail level crossing bell (docs/crossings.md): a quiet high double "ding-ding" (two pure partials, short), repeated by the view while the barriers are down; the caller scales gain by camera distance. Lowest priority, ambience bus.
  crossingBell: { priority: PRIORITY.ambience, bus: 'ambience', dur: 0.55, maxPerSec: 3, minGap: 0.3, build: (s, o) => {
    for (const at of [0, 0.16]) { tone(s, 'sine', 1568 * o.pitch, at, 0.05 * o.gain, 0.22, o.pan, 0.003); tone(s, 'sine', 3136 * o.pitch, at, 0.012 * o.gain, 0.1, o.pan, 0.003); }
  } },
  // Distant, soft cowbell: two harmonic-ish low sines (3:2), gentle attack. Rare.
  cowbell: { priority: PRIORITY.ambience, bus: 'ambience', dur: 1.2, maxPerSec: 2, minGap: 0.4, build: (s, o) => {
    tone(s, 'sine', 400 * o.pitch, 0, 0.03 * o.gain, 0.5, o.pan, 0.012); tone(s, 'sine', 600 * o.pitch, 0, 0.018 * o.gain, 0.35, o.pan, 0.012);
  } },
  // Distant church hour: harmonic partials only (1, 2, 3), soft attack, low level. (The UI 'bell' keeps its inharmonic ring; this is a background sound.)
  churchBell: { priority: PRIORITY.action, bus: 'ambience', dur: 3, maxPerSec: 4, minGap: 0, build: (s, o) => {
    for (const [r, a] of [[1, 1], [2, 0.4], [3, 0.15]] as const) tone(s, 'sine', 196 * r * o.pitch, 0, 0.07 * a * o.gain, 2.2 / (0.6 + r * 0.4), o.pan, 0.02);
  } },
  drip: { priority: PRIORITY.ambience, bus: 'ambience', dur: 0.2, maxPerSec: 4, minGap: 0.1, build: (s, o) => {
    const t = s.osc('sine', 900 * o.pitch), e = s.gain(0);
    t.frequency.setValueAtTime(900 * o.pitch, s.t0); t.frequency.exponentialRampToValueAtTime(1800 * o.pitch, s.t0 + 0.05);
    pluckEnv(e.gain, s.t0, 0.03 * o.gain, 0.006, 0.08); connectChain(t, e); toOut(s, e, o.pan, 1);
  } },
  creak: { priority: PRIORITY.ambience, bus: 'ambience', dur: 0.8, maxPerSec: 1, minGap: 1, build: (s, o) => {
    const t = s.osc('triangle', 150 * o.pitch), f = s.filter('bandpass', 400, 1.5), e = s.gain(0);
    t.frequency.setValueAtTime(150 * o.pitch, s.t0); t.frequency.linearRampToValueAtTime(110 * o.pitch, s.t0 + 0.7);
    swellEnv(e.gain, s.t0, 0.03 * o.gain, 0.25, 0.7, 0.3); connectChain(t, f, e); toOut(s, e, o.pan, 1);
  } },
  /**
   * Walk mode footsteps (Task 12): one short filtered-noise burst per step, peak ~0.05-0.07 (click = 0.18, so ~ -9 to -11 dB under the quietest UI sfx:
   * a texture, not an event). Lowest priority (never steals a voice from an action or alert), scaled by 'reduce loud sounds' (loud). Pitch varies per step.
   */
  stepSnow: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.2, maxPerSec: 4, minGap: 0.12, loud: true, build: (s, o) => {
    noiseHit(s, 'white', 'bandpass', 2600 * o.pitch, 1.1, 0, 0.06 * o.gain, 0.05, o.pan); noiseHit(s, 'white', 'bandpass', 3400 * o.pitch, 1.2, 0.035, 0.04 * o.gain, 0.04, o.pan); noiseHit(s, 'brown', 'lowpass', 400, 0.7, 0, 0.07 * o.gain, 0.09, o.pan);
  } },
  stepGravel: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.2, maxPerSec: 4, minGap: 0.12, loud: true, build: (s, o) => {
    for (let i = 0; i < 3; i++) noiseHit(s, 'white', 'bandpass', (1500 + i * 700) * o.pitch, 1.6, i * 0.022, 0.05 * o.gain, 0.03, o.pan);
    noiseHit(s, 'brown', 'lowpass', 600, 0.7, 0, 0.05 * o.gain, 0.06, o.pan);
  } },
  stepGrass: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.18, maxPerSec: 4, minGap: 0.12, loud: true, build: (s, o) => {
    noiseHit(s, 'pink', 'lowpass', 1100 * o.pitch, 0.8, 0, 0.05 * o.gain, 0.08, o.pan); noiseHit(s, 'brown', 'lowpass', 350, 0.7, 0, 0.05 * o.gain, 0.07, o.pan);
  } },
  stepWood: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.2, maxPerSec: 4, minGap: 0.12, loud: true, build: (s, o) => {
    tone(s, 'triangle', 190 * o.pitch, 0, 0.07 * o.gain, 0.06, o.pan, 0.002); tone(s, 'sine', 420 * o.pitch, 0, 0.035 * o.gain, 0.05, o.pan, 0.002); noiseHit(s, 'brown', 'lowpass', 700, 0.8, 0, 0.04 * o.gain, 0.05, o.pan);
  } },
  stepRoad: { priority: PRIORITY.ambience, bus: 'sfx', dur: 0.15, maxPerSec: 4, minGap: 0.12, loud: true, build: (s, o) => {
    noiseHit(s, 'white', 'bandpass', 2200 * o.pitch, 0.9, 0, 0.04 * o.gain, 0.025, o.pan); noiseHit(s, 'brown', 'lowpass', 500, 0.8, 0, 0.06 * o.gain, 0.05, o.pan);
  } },
};

/** Sliding-window per-name + per-group rate limiter. Pure given the clock. */
export class RateLimiter {
  private hist = new Map<string, number[]>();
  /** Would a start at `now` be allowed? (Does not record.) */
  allows(key: string, now: number, maxPerSec: number, minGap: number): boolean {
    const h = this.hist.get(key);
    if (!h) return true;
    while (h.length && now - h[0]! >= 1) h.shift();
    if (h.length >= maxPerSec) return false;
    return !(h.length && now - h[h.length - 1]! < minGap);
  }
  record(key: string, now: number): void { const h = this.hist.get(key); if (h) h.push(now); else this.hist.set(key, [now]); }
}

export class Sfx {
  private lim = new RateLimiter();
  /** Coins waiting to be merged into the next ka-ching arpeggio. */
  private pendingCoins = 0;
  private pendingGain = 0;
  /** Name -> count of successful plays (tests/debug). */
  readonly played: Partial<Record<SfxName, number>> = {};

  constructor(private engine: AudioEngine) {}

  /** Play a recipe. Returns true if a voice started. Safe to call at any time (no-ops when audio is off / limited). */
  play(name: SfxName, o: PlayOpts = {}): boolean {
    const r = RECIPES[name];
    if (!r || !this.engine.running) return false;
    const now = this.engine.now();
    const ok = this.lim.allows(name, now, r.maxPerSec, r.minGap) && (!r.group || this.lim.allows('g:' + r.group, now, 1, r.minGap));
    if (!ok) {
      if (name === 'kaching') { this.pendingCoins++; this.pendingGain = Math.max(this.pendingGain, o.gain ?? 1); }
      return false;
    }
    const merged = name === 'kaching' ? this.pendingCoins : 0;
    const opts = { ...o, pitch: o.pitch ?? 1, gain: (o.gain ?? 1) * (r.loud ? this.engine.loudScale : 1) * (name === 'kaching' && merged ? Math.max(1, this.pendingGain) : 1), count: (o.count ?? 0) + merged };
    const v = this.engine.startVoice(name, r.priority, r.dur, r.bus, (s) => r.build(s, opts), o.delay ?? 0);
    if (!v) return false;
    this.lim.record(name, now);
    if (r.group) this.lim.record('g:' + r.group, now);
    if (name === 'kaching') { this.pendingCoins = 0; this.pendingGain = 0; }
    this.played[name] = (this.played[name] ?? 0) + 1;
    return true;
  }

  /** Throttled-tick hook: flushes coalesced coins once the limiter allows. */
  update(): void {
    this.engine.reap(this.engine.now());
    if (this.pendingCoins > 0 && this.canPlay('kaching')) this.play('kaching', { gain: this.pendingGain || 1 });
  }
  /** Would the rate limiter currently let `name` start? */
  canPlay(name: SfxName): boolean {
    const r = RECIPES[name], now = this.engine.now();
    return this.engine.running && this.lim.allows(name, now, r.maxPerSec, r.minGap) && (!r.group || this.lim.allows('g:' + r.group, now, 1, r.minGap));
  }
  get pending(): number { return this.pendingCoins; }
}
