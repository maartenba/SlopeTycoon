import { PROX } from '../config/audioProximity';
import { busGains } from './AudioSettings';
import { PRIORITY, type AudioEngine } from './AudioEngine';
import { midiToHz, pluckEnv, swellEnv, type NodeScope } from './synth';

/**
 * Apres-ski bar music (owner feedback): a procedural 2/4 polka-schlager. Oompah bass (root / fifth) on the downbeats, accordion-ish chord stabs (detuned saws) on
 * the off-beats, stomp + handclap, a sparse reed melody on chord tones, occasional glass clinks. Everything is a pure function of (seed, beat index): the same
 * seed gives the same song on every machine (the composition never uses Math.random). Constants: src/config/audioProximity.ts (PROX.apres).
 */
const A = PROX.apres;
/** Chord progressions (4 bars, one chord per bar): [semitones above the key root, quality]. */
export const APRES_PROGRESSIONS: ReadonlyArray<ReadonlyArray<readonly [number, 'M' | 'm' | '7']>> = [
  [[0, 'M'], [7, '7'], [7, '7'], [0, 'M']],            // I V7 V7 I
  [[0, 'M'], [5, 'M'], [7, '7'], [0, 'M']],            // I IV V7 I
  [[0, 'M'], [9, 'm'], [2, '7'], [7, '7']],            // I vi II7 V7 (turnaround)
  [[0, 'M'], [0, 'M'], [5, 'M'], [7, '7']],            // I I IV V7
];
/** Key roots (MIDI, bass register): C, F, G. */
export const APRES_KEYS = [48, 53, 55] as const;

/** Deterministic hash -> [0, 1). */
export function hash01(seed: number, n: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export interface ApresBeat { /** MIDI bass note (downbeats). */ bass?: number; /** MIDI chord tones (off-beats). */ chord?: number[]; /** MIDI melody note. */ melody?: number; stomp: boolean; clap: boolean; clink: boolean; /** Variant (progression) index, for tests. */ variant: number; key: number }

/** Pure: the beat `index` (0 = first beat of bar 0; 4 beats per bar, beats 0 / 2 = oompah, 1 / 3 = pah). */
export function apresBeat(index: number, seed: number = A.seed): ApresBeat {
  const beat = index % 4, bar = Math.floor(index / 4), section = Math.floor(bar / 4);
  const variant = Math.floor(hash01(seed, section * 7 + 1) * APRES_PROGRESSIONS.length);
  const key = APRES_KEYS[Math.floor(hash01(seed, Math.floor(section / 4) * 13 + 3) * APRES_KEYS.length)]!;
  const [deg, q] = APRES_PROGRESSIONS[variant]![bar % 4]!;
  const root = key + deg, third = q === 'm' ? 3 : 4, fifth = 7;
  const tones = [root + 12, root + 12 + third, root + 12 + fifth, ...(q === '7' ? [root + 12 + 10] : [])];
  const down = beat % 2 === 0;
  const out: ApresBeat = { stomp: down, clap: !down, clink: hash01(seed, index * 3 + 5) < A.clinkChance, variant, key };
  if (down) out.bass = beat === 0 ? root : root + fifth;
  else out.chord = tones.slice(0, 3);
  if (down && hash01(seed, index * 5 + 11) > 0.35) { const t = tones[Math.floor(hash01(seed, index * 11 + 2) * 3)]!; out.melody = t + 12; }
  return out;
}

/** Cutoff (Hz) of the music low-pass for a level 0..1 (near = bright, far = muffled). */
export function apresCutoff(level: number): number { return A.cutoffFar + (A.cutoffNear - A.cutoffFar) * Math.pow(Math.min(1, Math.max(0, level)), 0.8); }

/** Schedules the bar music a beat at a time (one short voice per beat) while the level is above PROX.apres.minLevel. Update at ~10 Hz. */
export class ApresMusic {
  private next = 0;
  private idx = 0;
  private active = false;
  /** Beats scheduled since creation (tests). */
  scheduled = 0;
  constructor(private engine: AudioEngine) {}
  get isActive(): boolean { return this.active; }

  update(level: number): void {
    const e = this.engine;
    if (!e.running || level < A.minLevel) { this.active = false; return; }
    const g = busGains(e.settings.get());
    if (g.ambience * g.master < 1e-4) { this.active = false; return; } // muted / ambience slider at 0: schedule nothing
    const now = e.now(), beatDur = 60 / A.bpm;
    if (!this.active || this.next < now - 0.05) { this.active = true; this.next = now + 0.05; if (this.idx % 4) this.idx += 4 - (this.idx % 4); } // (re)start on a downbeat
    while (this.next < now + A.lookahead) {
      this.play(apresBeat(this.idx++), level, this.next - now);
      this.next += beatDur; this.scheduled++;
    }
  }

  private play(b: ApresBeat, level: number, delay: number): void {
    const peak = A.musicMax * level;
    this.engine.startVoice('apres', PRIORITY.ambience, 0.7, 'ambience', (s: NodeScope) => {
      const lp = s.filter('lowpass', apresCutoff(level), 0.5); lp.connect(s.out);
      const t = s.t0;
      if (b.bass !== undefined) { const o = s.osc('triangle', midiToHz(b.bass)), e = s.gain(0); pluckEnv(e.gain, t, peak * 0.9, 0.012, 0.3); o.connect(e); e.connect(lp); }
      if (b.chord) {
        const e = s.gain(0); swellEnv(e.gain, t, peak * 0.32, 0.02, 0.32, 0.1); e.connect(lp);
        b.chord.forEach((m, i) => { const o = s.osc('sawtooth', midiToHz(m)); o.connect(e); if (i === 2) { const d = s.osc('sawtooth', midiToHz(m) * 1.006); d.connect(e); } }); // the detuned top voice is the reed "beating"
      }
      if (b.melody !== undefined) { const o = s.osc('square', midiToHz(b.melody)), e = s.gain(0); swellEnv(e.gain, t, peak * 0.16, 0.03, 0.4, 0.15); o.connect(e); e.connect(lp); }
      if (b.stomp) { const o = s.osc('sine', 110), e = s.gain(0); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); pluckEnv(e.gain, t, peak * 0.8, 0.004, 0.14); o.connect(e); e.connect(lp); }
      if (b.clap) { const n = s.noiseSrc('white'), bp = s.filter('bandpass', 1500, 1.1), e = s.gain(0); pluckEnv(e.gain, t, peak * 0.5, 0.003, 0.07); n.connect(bp); bp.connect(e); e.connect(lp); }
      if (b.clink) { const e = s.gain(0), p = s.pan(((b.variant * 0.37 + b.key * 0.11) % 1) * 1.2 - 0.6); pluckEnv(e.gain, t + 0.12, A.clinkGain * Math.max(0.2, level), 0.002, 0.16); for (const f of [3100, 4650]) s.osc('sine', f).connect(e); e.connect(p); p.connect(s.out); } // glasses: bright, not through the music low-pass
    }, delay);
  }
}
