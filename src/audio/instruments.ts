import type { GainLike, NodeLike } from './backend';
import type { AudioBackend } from './backend';
import { midiToHz, NodeScope, pluckEnv, swellEnv, type NoiseBank } from './synth';
import type { InstId } from './musicThemes';

export interface InstCtx { b: AudioBackend; noise: NoiseBank; /** Where voices connect (a theme / gate gain). */ dest: GainLike; /** Shared reverb input (null if unsupported). */ reverb: NodeLike | null }
export interface InstVoice { scope: NodeScope; start: number; end: number }

type Build = (s: NodeScope, hz: number, vel: number, dur: number, t: number) => void;
interface Def { build: Build; /** Seconds the voice sounds after `dur` (release / decay). */ tail: number; /** Reverb send 0..1. */ wet: number; /** Minimum voice length (percussive decay). */ min: number }

const link = (a: NodeLike, ...rest: NodeLike[]): void => { let p = a; for (const n of rest) { p.connect(n); p = n; } };
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Soft, warm instruments only: harmonic partials, slow-ish attacks, every voice low-passed. Peaks are deliberately low (the music bed sits under the game). */
const DEFS: Record<InstId, Def> = {
  // Warm pad: three detuned saws through a low-pass that opens slowly.
  pad: { tail: 1.8, min: 0, wet: 0.55, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 3, 500, 1500), 0), att = Math.min(2.2, d * 0.45);
    lp.frequency.setValueAtTime(clamp(hz * 1.5, 300, 900), t); lp.frequency.linearRampToValueAtTime(clamp(hz * 3.4, 600, 1700), t + att + 0.6);
    for (const k of [0.9965, 1, 1.0035]) { const o = s.osc('sawtooth', hz * k), g = s.gain(0.2); link(o, g, lp); }
    link(lp, s.out); swellEnv(s.out.gain, t, 0.075 * v, att, d + 1.8, 1.8); } },
  // Gentle string ensemble: detuned saw choir with a slow vibrato, band-limited both ends.
  strings: { tail: 1.8, min: 0, wet: 0.6, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 2.6, 500, 1700), 0), hp = s.filter('highpass', 110, 0), att = Math.min(1.6, d * 0.4);
    const lfo = s.osc('sine', 4.6), lg = s.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz * 0.0035, t + att + 0.8); lfo.connect(lg);
    for (const k of [0.997, 1.003, 1.0006]) { const o = s.osc('sawtooth', hz * k), g = s.gain(0.17); lg.connect(o.frequency as unknown as NodeLike); link(o, g, hp); }
    link(hp, lp, s.out); swellEnv(s.out.gain, t, 0.085 * v, att, d + 1.8, 1.8); } },
  // Felt electric piano: sine + 2nd partial that dies quickly + a trace of 3rd (all harmonic), soft attack.
  epiano: { tail: 0, min: 2.8, wet: 0.35, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 5, 900, 3200), 0), a = s.osc('sine', hz), b = s.osc('sine', hz * 2), c = s.osc('sine', hz * 3), bg = s.gain(0), cg = s.gain(0);
    pluckEnv(bg.gain, t, 0.32, 0.01, 0.7); pluckEnv(cg.gain, t, 0.07, 0.01, 0.25);
    link(a, lp); link(b, bg, lp); link(c, cg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.17 * v, 0.012, 2.4); } },
  // Soft pluck: saw + triangle through a closing low-pass.
  pluck: { tail: 0, min: 1.3, wet: 0.4, build: (s, hz, v, _d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('triangle', hz * 1.002), lp = s.filter('lowpass', hz * 4, 0), bg = s.gain(0.9), ag = s.gain(0.5);
    lp.frequency.setValueAtTime(clamp(hz * 4.5, 500, 2600), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 1.3, 220, 1000), t + 0.4);
    link(a, ag, lp); link(b, bg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.13 * v, 0.007, 1.0); } },
  // Acoustic-guitar-ish (filtered saw/triangle with a very soft pick); no bright burst.
  guitar: { tail: 0, min: 1.8, wet: 0.3, build: (s, hz, v, _d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('triangle', hz * 1.003), lp = s.filter('lowpass', hz * 5, 0), ag = s.gain(0.5);
    lp.frequency.setValueAtTime(clamp(hz * 5, 600, 2400), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 1.4, 240, 900), t + 0.55);
    link(a, ag, lp); link(b, lp); link(lp, s.out);
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', clamp(hz * 2.5, 300, 1800), 0.8), ng = s.gain(0.0001); pluckEnv(ng.gain, t, 0.2 * v, 0.004, 0.025); link(n, bp, ng, s.out);
    pluckEnv(s.out.gain, t, 0.13 * v, 0.006, 1.5); } },
  // Harp: sines, the 2nd partial dies fast. Soft attack, 3 kHz ceiling.
  harp: { tail: 0, min: 2.8, wet: 0.5, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', 3000, 0), a = s.osc('sine', hz), b = s.osc('sine', hz * 2), bg = s.gain(0);
    pluckEnv(bg.gain, t, 0.3, 0.008, 0.8); link(a, lp); link(b, bg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.2 * v, 0.01, 2.6); } },
  // Flute: triangle + sine, delayed vibrato, a whisper of breath.
  flute: { tail: 0.3, min: 0, wet: 0.45, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 4, 1200, 3200), 0), a = s.osc('triangle', hz), b = s.osc('sine', hz), c = s.osc('sine', hz * 2), ag = s.gain(0.5), cg = s.gain(0.05);
    const lfo = s.osc('sine', 4.8), lg = s.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz * 0.004, t + 0.5); lfo.connect(lg);
    lg.connect(a.frequency as unknown as NodeLike); lg.connect(b.frequency as unknown as NodeLike);
    link(a, ag, lp); link(b, lp); link(c, cg, lp); link(lp, s.out);
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', hz * 2, 0.8), ng = s.gain(0.012 * v); link(n, bp, ng, s.out);
    swellEnv(s.out.gain, t, 0.17 * v, 0.09, d + 0.3, 0.3); } },
  // Warm sub bass: sine + a touch of triangle, low-passed.
  sub: { tail: 0.4, min: 0, wet: 0.08, build: (s, hz, v, d, t) => {
    const a = s.osc('sine', hz), b = s.osc('triangle', hz), bg = s.gain(0.5), lp = s.filter('lowpass', 300, 0);
    link(a, lp); link(b, bg, lp); link(lp, s.out); swellEnv(s.out.gain, t, 0.03 * v, 0.05, d + 0.4, 0.4); } },
  // Brush stroke: a soft band of noise, 15 ms swell.
  brush: { tail: 0, min: 0.25, wet: 0.2, build: (s, _hz, v, _d, t) => {
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', 2600, 0.5), lp = s.filter('lowpass', 5000, 0);
    link(n, bp, lp, s.out); s.out.gain.cancelScheduledValues(t); s.out.gain.setValueAtTime(0.0001, t); s.out.gain.linearRampToValueAtTime(0.05 * v, t + 0.014); s.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); } },
  shaker: { tail: 0, min: 0.2, wet: 0.2, build: (s, _hz, v, _d, t) => {
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', 4800, 0.5), lp = s.filter('lowpass', 6500, 0);
    link(n, bp, lp, s.out); s.out.gain.cancelScheduledValues(t); s.out.gain.setValueAtTime(0.0001, t); s.out.gain.linearRampToValueAtTime(0.035 * v, t + 0.012); s.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); } },
  drone: { tail: 2, min: 0, wet: 0.5, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', 150, 0);
    for (const [ty, f] of [['sawtooth', 1], ['sawtooth', 1.004], ['sine', 0.5]] as const) { const o = s.osc(ty, hz * f), g = s.gain(0.25); link(o, g, lp); }
    link(lp, s.out); swellEnv(s.out.gain, t, 0.07 * v, 1.8, d + 2, 2); } },
};

/** Seconds a note of musical length `dur` sounds in total (start to disposable). */
export function voiceLength(inst: InstId, dur: number): number { const d = DEFS[inst]; return Math.max(d.min, dur + d.tail) + 0.08; }

/** Builds one note: nodes are tracked in the returned scope (caller disposes it after `end`). Never throws (returns null). */
export function playNote(c: InstCtx, inst: InstId, midi: number, t: number, dur: number, vel: number, pan = 0): InstVoice | null {
  const def = DEFS[inst], life = voiceLength(inst, dur);
  const out = c.b.createGain();
  out.gain.value = 0;
  const scope = new NodeScope(c.b, c.noise, t, life - 0.05, out);
  try {
    if (Math.abs(pan) > 0.02) { const p = scope.pan(pan); out.connect(p); p.connect(c.dest); } else out.connect(c.dest);
    def.build(scope, midiToHz(midi), Math.max(0.05, Math.min(1.2, vel)), dur, t);
    if (c.reverb && def.wet > 0) { const send = scope.gain(def.wet * 0.5); out.connect(send); send.connect(c.reverb); }
  } catch { scope.dispose(); return null; }
  return { scope, start: t, end: t + life };
}
