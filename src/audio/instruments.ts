import type { GainLike, NodeLike } from './backend';
import type { AudioBackend } from './backend';
import { midiToHz, NodeScope, pluckEnv, swellEnv, type NoiseBank } from './synth';
import type { InstId } from './musicThemes';

export interface InstCtx { b: AudioBackend; noise: NoiseBank; /** Where voices connect (a theme / gate gain). */ dest: GainLike; /** Shared convolution reverb input (null if unsupported). */ reverb: NodeLike | null }
export interface InstVoice { scope: NodeScope; start: number; end: number }

type Build = (s: NodeScope, hz: number, vel: number, dur: number, t: number) => void;
interface Def { build: Build; /** Seconds the voice sounds after `dur` (release / decay). */ tail: number; /** Reverb send 0..1. */ wet: number; /** Minimum voice length (percussive decay). */ min: number }

const link = (a: NodeLike, ...rest: NodeLike[]): void => { let p = a; for (const n of rest) { p.connect(n); p = n; } };

const DEFS: Record<InstId, Def> = {
  // Inharmonic FM bell (ratio 3.5) + a stretched partial.
  bell: { tail: 0, min: 2.6, wet: 0.7, build: (s, hz, v, _d, t) => { const c = s.fm(hz, 3.5, hz * 0.9), p = s.osc('sine', hz * 2.76), pg = s.gain(0.25); link(c, s.out); link(p, pg, s.out); pluckEnv(s.out.gain, t, 0.12 * v, 0.003, 2.4); } },
  glock: { tail: 0, min: 1.6, wet: 0.7, build: (s, hz, v, _d, t) => { const a = s.osc('sine', hz * 2), b = s.osc('sine', hz * 5.4), bg = s.gain(0.18); link(a, s.out); link(b, bg, s.out); pluckEnv(s.out.gain, t, 0.09 * v, 0.002, 1.4); } },
  // Detuned saws through a low-pass, slow attack.
  pad: { tail: 1.2, min: 0, wet: 0.6, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', Math.min(2200, hz * 3), 0.5);
    for (const k of [0.994, 1, 1.006]) { const o = s.osc('sawtooth', hz * k); const g = s.gain(0.34); link(o, g, lp); }
    lp.connect(s.out); swellEnv(s.out.gain, t, 0.045 * v, Math.min(1.4, d * 0.4), d + 1.2, 1.2); } },
  // Light pluck: saw through a closing low-pass + a tiny noise click.
  pluck: { tail: 0, min: 0.9, wet: 0.4, build: (s, hz, v, _d, t) => {
    const o = s.osc('sawtooth', hz), lp = s.filter('lowpass', hz * 7, 1);
    lp.frequency.setValueAtTime(hz * 7, t); lp.frequency.exponentialRampToValueAtTime(hz * 1.6, t + 0.3);
    link(o, lp, s.out);
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', hz * 3, 2), ng = s.gain(0.0001); pluckEnv(ng.gain, t, 0.5 * v, 0.001, 0.03); link(n, bp, ng, s.out);
    pluckEnv(s.out.gain, t, 0.06 * v, 0.003, 0.85); } },
  // Guitar-ish (approximates Karplus-Strong: bright burst -> mellow, two slightly detuned strings, noisy pick).
  guitar: { tail: 0, min: 1.5, wet: 0.35, build: (s, hz, v, _d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('triangle', hz * 1.003), lp = s.filter('lowpass', hz * 9, 0.8), bg = s.gain(0.8);
    lp.frequency.setValueAtTime(hz * 9, t); lp.frequency.exponentialRampToValueAtTime(hz * 1.3, t + 0.5);
    link(a, lp); link(b, bg, lp); lp.connect(s.out);
    const n = s.noiseSrc('white'), bp = s.filter('bandpass', Math.min(5000, hz * 4), 3), ng = s.gain(0.0001); pluckEnv(ng.gain, t, 0.35 * v, 0.001, 0.02); link(n, bp, ng, s.out);
    pluckEnv(s.out.gain, t, 0.07 * v, 0.002, 1.35); } },
  marimba: { tail: 0, min: 0.7, wet: 0.3, build: (s, hz, v, _d, t) => { const a = s.osc('sine', hz), b = s.osc('sine', hz * 4), c = s.osc('sine', hz * 10), bg = s.gain(0.25), cg = s.gain(0.04); link(a, s.out); link(b, bg, s.out); link(c, cg, s.out); pluckEnv(s.out.gain, t, 0.13 * v, 0.002, 0.6); } },
  handpan: { tail: 0, min: 1.6, wet: 0.55, build: (s, hz, v, _d, t) => { const a = s.osc('sine', hz), b = s.osc('sine', hz * 2), c = s.osc('sine', hz * 3), bg = s.gain(0.4), cg = s.gain(0.15); link(a, s.out); link(b, bg, s.out); link(c, cg, s.out); pluckEnv(s.out.gain, t, 0.12 * v, 0.006, 1.5); } },
  bass: { tail: 0.3, min: 0, wet: 0.1, build: (s, hz, v, d, t) => { const a = s.osc('sine', hz), b = s.osc('triangle', hz * 2), bg = s.gain(0.3), lp = s.filter('lowpass', 420, 0.7); link(a, lp); link(b, bg, lp); lp.connect(s.out); swellEnv(s.out.gain, t, 0.14 * v, 0.02, d + 0.3, 0.3); } },
  // Flute-ish: sine + octave, vibrato, breath noise.
  flute: { tail: 0.2, min: 0, wet: 0.5, build: (s, hz, v, d, t) => {
    const a = s.osc('sine', hz), b = s.osc('sine', hz * 2), bg = s.gain(0.1), lfo = s.osc('sine', 5), lg = s.gain(hz * 0.006);
    lfo.connect(lg); lg.connect(a.frequency as unknown as NodeLike); link(a, s.out); link(b, bg, s.out);
    const n = s.noiseSrc('white'), bp = s.filter('bandpass', hz * 2, 1), ng = s.gain(0.04 * v); link(n, bp, ng, s.out);
    swellEnv(s.out.gain, t, 0.1 * v, 0.08, d + 0.2, 0.2); } },
  shaker: { tail: 0, min: 0.12, wet: 0.2, build: (s, _hz, v, _d, t) => { const n = s.noiseSrc('white'), hp = s.filter('highpass', 6000, 0.7); link(n, hp, s.out); pluckEnv(s.out.gain, t, 0.035 * v, 0.003, 0.07); } },
  drone: { tail: 1.5, min: 0, wet: 0.5, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', 180, 0.5);
    for (const [ty, f] of [['sawtooth', 1], ['sawtooth', 1.005], ['sine', 0.5]] as const) { const o = s.osc(ty, hz * f), g = s.gain(0.3); link(o, g, lp); }
    lp.connect(s.out); swellEnv(s.out.gain, t, 0.06 * v, 1.5, d + 1.5, 1.5); } },
};

/** Seconds a note of musical length `dur` sounds in total (start to disposable). */
export function voiceLength(inst: InstId, dur: number): number { const d = DEFS[inst]; return Math.max(d.min, dur + d.tail) + 0.08; }

/** Builds one note: nodes are tracked in the returned scope (caller disposes it after `end`). Never throws (returns null). */
export function playNote(c: InstCtx, inst: InstId, midi: number, t: number, dur: number, vel: number): InstVoice | null {
  const def = DEFS[inst], life = voiceLength(inst, dur);
  const out = c.b.createGain();
  out.gain.value = 0;
  out.connect(c.dest);
  const scope = new NodeScope(c.b, c.noise, t, life - 0.05, out);
  try {
    def.build(scope, midiToHz(midi), Math.max(0.05, Math.min(1.2, vel)), dur, t);
    if (c.reverb && def.wet > 0) { const send = scope.gain(def.wet * 0.5); out.connect(send); send.connect(c.reverb); }
  } catch { scope.dispose(); return null; }
  return { scope, start: t, end: t + life };
}
