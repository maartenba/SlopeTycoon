import type { GainLike, NodeLike } from './backend';
import type { AudioBackend } from './backend';
import { midiToHz, NodeScope, pluckEnv, swellEnv, type NoiseBank } from './synth';
import type { InstId } from './musicThemes';

export interface InstCtx { b: AudioBackend; noise: NoiseBank; /** Where voices connect (a theme / gate gain). */ dest: GainLike; /** Shared reverb input (null if unsupported). */ reverb: NodeLike | null; /** Shared ping-pong delay input (null = none). */ delay?: NodeLike | null }
export interface InstVoice { scope: NodeScope; start: number; end: number }

type Build = (s: NodeScope, hz: number, vel: number, dur: number, t: number) => void;
interface Def { build: Build; /** Delay send 0..1 (default 0). */ dly?: number; /** Seconds the voice sounds after `dur` (release / decay). */ tail: number; /** Reverb send 0..1. */ wet: number; /** Minimum voice length (percussive decay). */ min: number }

const link = (a: NodeLike, ...rest: NodeLike[]): void => { let p = a; for (const n of rest) { p.connect(n); p = n; } };
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Reed chord voice factory (Apres.ts): detuned saw pairs on the given semitone offsets through one band-limited chain with a bellows tremolo. */
function chordReed(iv: readonly number[]): Build {
  return (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 5, 1500, 3400), 0), hp = s.filter('highpass', 150, 0), trem = s.gain(0.86), lfo = s.osc('sine', 5.4), lg = s.gain(0.1), mix = s.gain(0.1);
    lfo.connect(lg); lg.connect(trem.gain as unknown as NodeLike);
    for (const k of iv) for (const dt of [0.9965, 1.0045]) { const o = s.osc('sawtooth', hz * Math.pow(2, k / 12) * dt); o.connect(mix); }
    link(mix, hp, lp, trem, s.out); swellEnv(s.out.gain, t, 0.13 * v, 0.02, d + 0.08, 0.07);
  };
}

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
  epiano: { tail: 0, min: 2.8, wet: 0.35, dly: 0.2, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 5, 900, 3200), 0), a = s.osc('sine', hz), b = s.osc('sine', hz * 2), c = s.osc('sine', hz * 3), bg = s.gain(0), cg = s.gain(0);
    pluckEnv(bg.gain, t, 0.32, 0.01, 0.7); pluckEnv(cg.gain, t, 0.07, 0.01, 0.25);
    link(a, lp); link(b, bg, lp); link(c, cg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.17 * v, 0.012, 2.4); } },
  // Soft pluck: saw + triangle through a closing low-pass.
  pluck: { tail: 0, min: 1.3, wet: 0.4, dly: 0.3, build: (s, hz, v, _d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('triangle', hz * 1.002), lp = s.filter('lowpass', hz * 4, 0), bg = s.gain(0.9), ag = s.gain(0.5);
    lp.frequency.setValueAtTime(clamp(hz * 4.5, 500, 2600), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 1.3, 220, 1000), t + 0.4);
    link(a, ag, lp); link(b, bg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.13 * v, 0.007, 1.0); } },
  // Acoustic-guitar-ish (filtered saw/triangle with a very soft pick); no bright burst.
  guitar: { tail: 0, min: 1.8, wet: 0.3, dly: 0.15, build: (s, hz, v, _d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('triangle', hz * 1.003), lp = s.filter('lowpass', hz * 5, 0), ag = s.gain(0.5);
    lp.frequency.setValueAtTime(clamp(hz * 5, 600, 2400), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 1.4, 240, 900), t + 0.55);
    link(a, ag, lp); link(b, lp); link(lp, s.out);
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', clamp(hz * 2.5, 300, 1800), 0.8), ng = s.gain(0.0001); pluckEnv(ng.gain, t, 0.2 * v, 0.004, 0.025); link(n, bp, ng, s.out);
    pluckEnv(s.out.gain, t, 0.13 * v, 0.006, 1.5); } },
  // Harp: sines, the 2nd partial dies fast. Soft attack, 3 kHz ceiling.
  harp: { tail: 0, min: 2.8, wet: 0.5, dly: 0.3, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', 3000, 0), a = s.osc('sine', hz), b = s.osc('sine', hz * 2), bg = s.gain(0);
    pluckEnv(bg.gain, t, 0.3, 0.008, 0.8); link(a, lp); link(b, bg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.2 * v, 0.01, 2.6); } },
  // Flute: triangle + sine, delayed vibrato, a whisper of breath.
  flute: { tail: 0.3, min: 0, wet: 0.45, dly: 0.2, build: (s, hz, v, d, t) => {
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

  // Felt piano: 1st + decaying 2nd / 3rd partials, a slightly detuned twin for warmth (harmonic: within the 1.5 % tolerance of the harmonicity test), soft hammer.
  piano: { tail: 0, min: 3.4, wet: 0.4, dly: 0.25, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 6, 900, 3600), 0), a = s.osc('sine', hz), a2 = s.osc('sine', hz * 1.0015), b = s.osc('sine', hz * 2), c = s.osc('sine', hz * 3), d4 = s.osc('sine', hz * 4);
    const ag = s.gain(0.55), bg = s.gain(0), cg = s.gain(0), dg = s.gain(0);
    pluckEnv(bg.gain, t, 0.38, 0.006, 1.1); pluckEnv(cg.gain, t, 0.16, 0.006, 0.45); pluckEnv(dg.gain, t, 0.07, 0.004, 0.2);
    link(a, ag, lp); link(a2, ag); link(b, bg, lp); link(c, cg, lp); link(d4, dg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.15 * v, 0.008, 3.1); } },
  // Mallet (kalimba / vibraphone-ish): sine + a 4th partial that dies at once (harmonic, unlike the old inharmonic bells), warm and short.
  mallet: { tail: 0, min: 1.6, wet: 0.45, dly: 0.35, build: (s, hz, v, _d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 5, 900, 3400), 0), a = s.osc('sine', hz), b = s.osc('sine', hz * 4), bg = s.gain(0);
    pluckEnv(bg.gain, t, 0.22, 0.003, 0.14); link(a, lp); link(b, bg, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.17 * v, 0.004, 1.35); } },
  // Warm synth lead: saw + triangle one octave down through a slowly opening low-pass, delayed vibrato.
  warmLead: { tail: 0.35, min: 0, wet: 0.45, dly: 0.4, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 3, 700, 2200), 0), a = s.osc('sawtooth', hz), b = s.osc('sawtooth', hz * 1.004), c = s.osc('triangle', hz / 2), ag = s.gain(0.28), cg = s.gain(0.3);
    lp.frequency.setValueAtTime(clamp(hz * 1.6, 400, 1000), t); lp.frequency.linearRampToValueAtTime(clamp(hz * 3.6, 800, 2400), t + 0.3);
    const lfo = s.osc('sine', 5.1), lg = s.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz * 0.003, t + 0.6); lfo.connect(lg); lg.connect(a.frequency as unknown as NodeLike); lg.connect(b.frequency as unknown as NodeLike);
    link(a, ag, lp); link(b, ag); link(c, cg, lp); link(lp, s.out); swellEnv(s.out.gain, t, 0.1 * v, 0.03, d + 0.35, 0.3); } },
  // Plucked electric-bass-ish: triangle + sine, closing low-pass (rhythmic grooves).
  bassPluck: { tail: 0.1, min: 0.3, wet: 0.05, build: (s, hz, v, d, t) => {
    const a = s.osc('triangle', hz), b = s.osc('sine', hz), lp = s.filter('lowpass', clamp(hz * 7, 200, 700), 0);
    lp.frequency.setValueAtTime(clamp(hz * 7, 250, 800), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 2.2, 100, 300), t + 0.22);
    link(a, lp); link(b, lp); link(lp, s.out); pluckEnv(s.out.gain, t, 0.11 * v, 0.008, Math.max(0.2, d + 0.1)); } },
  // ---- drums (soft kit for the game music; all noise / sine, no tonal ring) ----
  kickSoft: { tail: 0, min: 0.45, wet: 0.05, build: (s, _h, v, _d, t) => {
    const o = s.osc('sine', 110), lp = s.filter('lowpass', 260, 0); o.frequency.setValueAtTime(112, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    link(o, lp, s.out); pluckEnv(s.out.gain, t, 0.2 * v, 0.004, 0.32); } },
  snareSoft: { tail: 0, min: 0.3, wet: 0.35, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', 1900, 0.6), lp = s.filter('lowpass', 4600, 0), o = s.osc('sine', 185), og = s.gain(0.5);
    pluckEnv(og.gain, t, 0.5, 0.002, 0.07); link(n, bp, lp, s.out); link(o, og, s.out); pluckEnv(s.out.gain, t, 0.085 * v, 0.003, 0.17); } },
  rim: { tail: 0, min: 0.15, wet: 0.2, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', 2300, 0.8), o = s.osc('sine', 880), og = s.gain(0.4);
    pluckEnv(og.gain, t, 0.5, 0.001, 0.025); link(n, bp, s.out); link(o, og, s.out); pluckEnv(s.out.gain, t, 0.06 * v, 0.002, 0.05); } },
  hatSoft: { tail: 0, min: 0.15, wet: 0.15, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('pink'), bp = s.filter('bandpass', 5200, 0.5), lp = s.filter('lowpass', 6800, 0);
    link(n, bp, lp, s.out); pluckEnv(s.out.gain, t, 0.04 * v, 0.003, 0.055); } },
  // ---- bar-music kit and voices (Apres.ts): clearer, harder, hotter ----
  kick: { tail: 0, min: 0.4, wet: 0, build: (s, _h, v, _d, t) => {
    const o = s.osc('sine', 120), lp = s.filter('lowpass', 420, 0), ck = s.noiseSrc('white'), ckg = s.gain(0), ckf = s.filter('bandpass', 2200, 0.8);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(47, t + 0.13); pluckEnv(ckg.gain, t, 0.12, 0.001, 0.012);
    link(o, lp, s.out); link(ck, ckf, ckg, s.out); pluckEnv(s.out.gain, t, 0.6 * v, 0.003, 0.3); } },
  snare: { tail: 0, min: 0.3, wet: 0, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('white'), bp = s.filter('bandpass', 2200, 0.5), o = s.osc('triangle', 195), og = s.gain(0.6);
    pluckEnv(og.gain, t, 0.5, 0.002, 0.08); link(n, bp, s.out); link(o, og, s.out); pluckEnv(s.out.gain, t, 0.3 * v, 0.002, 0.17); } },
  clap: { tail: 0, min: 0.3, wet: 0, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('white'), bp = s.filter('bandpass', 1400, 1), pk = 0.3 * v, g = s.out.gain;
    link(n, bp, s.out); g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(pk, t + 0.002); g.exponentialRampToValueAtTime(pk * 0.35, t + 0.011);
    g.linearRampToValueAtTime(pk, t + 0.013); g.exponentialRampToValueAtTime(pk * 0.35, t + 0.022); g.linearRampToValueAtTime(pk * 0.9, t + 0.024); g.exponentialRampToValueAtTime(0.0001, t + 0.2); } },
  hat: { tail: 0, min: 0.1, wet: 0, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('white'), hp = s.filter('highpass', 6500, 0), lp = s.filter('lowpass', 12000, 0); link(n, hp, lp, s.out); pluckEnv(s.out.gain, t, 0.1 * v, 0.001, 0.04); } },
  hatO: { tail: 0, min: 0.3, wet: 0, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('white'), hp = s.filter('highpass', 6000, 0), lp = s.filter('lowpass', 11000, 0); link(n, hp, lp, s.out); pluckEnv(s.out.gain, t, 0.09 * v, 0.003, 0.2); } },
  crash: { tail: 0, min: 1.4, wet: 0, build: (s, _h, v, _d, t) => {
    const n = s.noiseSrc('white'), hp = s.filter('highpass', 4500, 0); link(n, hp, s.out); pluckEnv(s.out.gain, t, 0.13 * v, 0.004, 1.2); } },
  // Build-up riser: noise through a band-pass sweeping up over the note, swelling to the drop.
  riser: { tail: 0.05, min: 0, wet: 0, build: (s, _h, v, d, t) => {
    const n = s.noiseSrc('white'), bp = s.filter('bandpass', 400, 1.2); bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(7000, t + d);
    link(n, bp, s.out); s.out.gain.cancelScheduledValues(t); s.out.gain.setValueAtTime(0.0001, t); s.out.gain.linearRampToValueAtTime(0.1 * v, t + d); s.out.gain.linearRampToValueAtTime(0.0001, t + d + 0.05); } },
  // Accordion (reed): three detuned saws + a square, bellows tremolo, band-limited 180 Hz to 3 kHz, quick swell.
  accordion: { tail: 0.08, min: 0, wet: 0, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 5, 1400, 3200), 0), hp = s.filter('highpass', 170, 0), trem = s.gain(0.86), lfo = s.osc('sine', 5.4), lg = s.gain(0.1);
    lfo.connect(lg); lg.connect(trem.gain as unknown as NodeLike);
    for (const k of [0.9965, 1, 1.0045]) { const o = s.osc('sawtooth', hz * k), g = s.gain(0.17); link(o, g, hp); }
    { const o = s.osc('square', hz * 0.5), g = s.gain(0.12); link(o, g, hp); }
    link(hp, lp, trem, s.out); swellEnv(s.out.gain, t, 0.12 * v, 0.018, d + 0.08, 0.07); } },
  // Brass section stab: two detuned saws, a low-pass that blats open, firm attack.
  brass: { tail: 0.1, min: 0, wet: 0, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 4, 900, 3000), 0), a = s.osc('sawtooth', hz), b = s.osc('sawtooth', hz * 1.006), ag = s.gain(0.25);
    lp.frequency.setValueAtTime(clamp(hz * 1.3, 300, 900), t); lp.frequency.linearRampToValueAtTime(clamp(hz * 4.5, 900, 3200), t + 0.06);
    link(a, ag, lp); link(b, ag); link(lp, s.out); swellEnv(s.out.gain, t, 0.13 * v, 0.02, d + 0.1, 0.09); } },
  // Driving synth bass: saw + sine through a closing low-pass (punchy, sits under the kick offbeat).
  bassSaw: { tail: 0.04, min: 0.2, wet: 0, build: (s, hz, v, d, t) => {
    const a = s.osc('sawtooth', hz), b = s.osc('sine', hz), lp = s.filter('lowpass', 600, 0), ag = s.gain(0.5);
    lp.frequency.setValueAtTime(clamp(hz * 8, 300, 1100), t); lp.frequency.exponentialRampToValueAtTime(clamp(hz * 2.5, 120, 400), t + 0.14);
    link(a, ag, lp); link(b, lp); link(lp, s.out); swellEnv(s.out.gain, t, 0.28 * v, 0.006, Math.max(0.12, d) + 0.04, 0.05); } },
  // One accordion CHORD in a single voice (shared filter chain): detuned saw pairs on the chord tones, bellows tremolo. Keyed by chord quality (root = the note played).
  accM: { tail: 0.08, min: 0, wet: 0, build: chordReed([0, 4, 7]) },
  accm: { tail: 0.08, min: 0, wet: 0, build: chordReed([0, 3, 7]) },
  acc7: { tail: 0.08, min: 0, wet: 0, build: chordReed([0, 4, 7, 10]) },
  // Brass section hit: root + fifth + octave saws, blatty low-pass, short.
  brassStab: { tail: 0.08, min: 0, wet: 0, build: (s, hz, v, d, t) => {
    const lp = s.filter('lowpass', clamp(hz * 4, 900, 3000), 0), mix = s.gain(0.14);
    lp.frequency.setValueAtTime(clamp(hz * 1.4, 400, 1000), t); lp.frequency.linearRampToValueAtTime(clamp(hz * 4.5, 1000, 3400), t + 0.05);
    for (const k of [1, 1.0058, 1.4983, 2]) { const o = s.osc('sawtooth', hz * k); o.connect(mix); }
    link(mix, lp, s.out); swellEnv(s.out.gain, t, 0.13 * v, 0.014, d + 0.08, 0.07); } },
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
    if (c.delay && def.dly) { const dsend = scope.gain(def.dly); out.connect(dsend); dsend.connect(c.delay); }
  } catch { scope.dispose(); return null; }
  return { scope, start: t, end: t + life };
}
