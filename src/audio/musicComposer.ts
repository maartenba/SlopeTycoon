import { LAYERS, MUSIC, THEMES, TRACK_IDS, type InstId, type Layer, type Theme, type TrackId } from './musicThemes';
import { chordIdx, hashSeed, isChordTone, mulberry32, nearestChordTone, PENTATONIC_DEGREES, scaleNote, seventhIdx, snapToDegrees, voiceLead, N, type ModeName } from './theory';

export interface NoteEvent { /** Beat from the start of the piece (multiple of MUSIC.stepBeats). */ beat: number; dur: number; midi: number; vel: number; inst: InstId; layer: Layer; /** Stereo position -1..1. */ pan: number; /** 0..1: plays when rank < layer weight (low = essential). */ rank: number }
export interface Piece { seed: number; track: TrackId; root: number; mode: ModeName; bars: number; totalBeats: number; form: string; /** Chord (scale indices) per bar. */ chords: number[][]; events: NoteEvent[] }

/** Melody scale-index range (root+octave .. ~2 octaves up) and arp / bass / pad centres. */
export const RANGE = { melLo: 7, melHi: 16, arpLo: 3, arpHi: 11, padCenter: 4, bassOct: -7 };
const LAYER_ORDER: Record<Layer, number> = { pad: 0, bass: 1, arp: 2, melody: 3, perc: 4 };
const q = (b: number): number => Math.round(b / MUSIC.stepBeats) * MUSIC.stepBeats;

type Rhythm = ReadonlyArray<readonly [number, number]>;
const RHYTHMS: readonly Rhythm[] = [
  [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]], [[0, 2], [2, 1], [3, 1]],
  [[0.5, 1], [1.5, 0.5], [2, 1.5], [3.5, 0.5]], [[0, 3], [3, 1]], [[0, 1], [1.5, 0.5], [2, 1], [3, 1]],
];

function bassIdx(chordRoot: number): number { return chordRoot + RANGE.bassOct; }

/** Composes one piece. Pure and deterministic in (seed, track, root). All pitched notes are scale tones (melody: the pentatonic subset when the theme says so); the pad is voice-led. `root` is the untransposed key; the piece's root includes the theme's transposition. */
export function composePiece(seed: number, trackId: TrackId, keyRoot: number): Piece {
  const th: Theme = THEMES[trackId], rng = mulberry32(seed), root = keyRoot + th.transpose;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)]!;
  const mode = pick(th.modes);
  const bps = MUSIC.barsPerSection, form = th.form;
  const bars = form.length * bps, events: NoteEvent[] = [], chords: number[][] = [];
  const melSide = (seed >>> 5) & 1 ? 0.2 : -0.2;
  const allowed = th.pentatonic ? PENTATONIC_DEGREES[mode] : null;
  const add = (layer: Layer, beat: number, dur: number, idxOrMidi: number, vel: number, rank: number, inst: InstId, raw = false, panBias = 0): void => {
    const midi = raw ? idxOrMidi : scaleNote(root, mode, idxOrMidi);
    const pan = layer === 'bass' ? 0 : layer === 'melody' ? melSide : layer === 'perc' ? (Math.floor(beat * 2) % 2 ? 0.25 : -0.25) : layer === 'arp' ? (((midi * 5) % 7) - 3) * 0.13 : panBias;
    events.push({ beat: q(beat), dur, midi, vel, inst, layer, pan: Math.max(-0.8, Math.min(0.8, pan)), rank });
  };
  // Per-letter plans: A and B differ in progression and motif; repeats vary.
  const plans = new Map<string, { prog: readonly number[]; steps: number[]; rh: Rhythm[]; seen: number }>();
  for (const letter of new Set(form)) {
    const base = pick(th.progressions);
    const others = th.progressions.filter((p) => p !== plans.get('A')?.prog);
    const prog = letter === 'A' || !others.length ? base : pick(others);
    const steps = Array.from({ length: 4 }, () => pick([-2, -1, -1, 1, 1, 2, 0]));
    plans.set(letter, { prog, steps, rh: [pick(RHYTHMS), pick(RHYTHMS)], seen: 0 });
  }
  let padPrev: number[] | null = null, melCur = RANGE.melLo + 3;
  for (let s = 0; s < form.length; s++) {
    const plan = plans.get(form[s]!)!, variation = plan.seen++, lastSection = s === form.length - 1;
    // Varied repeats lift the melody a scale step and ornament more.
    const lift = variation > 0 ? 1 : 0;
    for (let b = 0; b < bps; b++) {
      const bar = s * bps + b, t0 = bar * MUSIC.barBeats, deg = plan.prog[Math.floor(b / th.barsPerChord) % plan.prog.length]!;
      const chord = chordIdx(deg), padChord = th.seventh ? seventhIdx(deg) : chord;
      chords.push(chord);
      // Pad: voice-led triad held for the bar (re-struck each bar).
      const voicing = voiceLead(padPrev, padChord, RANGE.padCenter); padPrev = voicing;
      // Sustained pads: one note per chord change (held across the chord's bars), others re-strike each bar.
      const sustain = th.inst.pad === 'pad' || th.inst.pad === 'strings';
      const first = b % th.barsPerChord === 0 || !sustain;
      if (first) voicing.forEach((i, k) => add('pad', t0, sustain ? MUSIC.barBeats * Math.min(th.barsPerChord, bps - b) : MUSIC.barBeats, i, (0.7 + k * 0.05) * th.padVel, 0.05, th.inst.pad, false, (k - (voicing.length - 1) / 2) * 0.35));
      // Bass.
      const br = bassIdx(deg), fifth = br + 4;
      if (th.bassStyle === 'whole') { if (b % th.barsPerChord === 0) add('bass', t0, MUSIC.barBeats * Math.min(th.barsPerChord, bps - b), br, 0.8, 0.1, th.inst.bass); } // one held note per chord
      else if (th.bassStyle === 'rootFifth') { add('bass', t0, 1.5, br, 0.85, 0.1, th.inst.bass); add('bass', t0 + 2, 1.5, fifth, 0.65, 0.4, th.inst.bass); }
      else for (let k = 0; k < 4; k++) add('bass', t0 + k, 0.75, k % 2 ? fifth : br, k === 0 ? 0.85 : 0.6, k === 0 ? 0.1 : 0.45, th.inst.bass);
      if (b % th.barsPerChord === th.barsPerChord - 1 && th.bassStyle !== 'whole' && rng() < 0.5) { // walking pickup toward the next chord's root
        const next = plan.prog[Math.floor((b + 1) / th.barsPerChord) % plan.prog.length]!;
        add('bass', t0 + 3.5, 0.5, bassIdx(next) + (rng() < 0.5 ? -1 : 1), 0.5, 0.6, th.inst.bass);
      }
      // Arp over chord tones (+ octave), with rests; a different pattern each couple of bars.
      const pat = th.arpPatterns[(Math.floor(bar / 2) + s) % th.arpPatterns.length]!;
      const arpBase = chord.map((c) => c + 7 * Math.round((RANGE.arpLo + 2 - c) / 7));
      arpBase.sort((a, b2) => a - b2);
      const cnt = Math.floor(MUSIC.barBeats / th.arpStep);
      for (let k = 0; k < cnt; k++) {
        if (rng() < th.arpRest) continue;
        const pos = pat[k % pat.length]!;
        let idx = arpBase[pos % 3]! + (pos >= 3 ? 7 : 0);
        idx = Math.min(RANGE.arpHi, Math.max(RANGE.arpLo, idx));
        add('arp', t0 + k * th.arpStep, th.arpStep * 1.5, idx, (k % 2 === 0 ? 0.8 : 0.55) + rng() * 0.1, k === 0 ? 0.2 : 0.3 + rng() * 0.55, th.inst.arp);
      }
      // Melody: motif-driven walk; breathing rests at phrase ends; final bar resolves to the chord root.
      const phraseEnd = b % 4 === 3, final = lastSection && b === bps - 1;
      if (final) { let fi = nearestChordTone(melCur, chord); if (allowed) fi = snapToDegrees(fi, allowed); while (fi < RANGE.melLo) fi += N; while (fi > RANGE.melHi) fi -= N; add('melody', t0, 4, fi, 0.8 * th.melodyVel, 0.1, th.inst.melody); }
      else if (!(rng() < th.melodyRest * (phraseEnd ? 1.8 : 1))) {
        const rh = plan.rh[b % 2]!;
        rh.forEach(([off, dur], i) => {
          let step = plan.steps[(i + (b % 2) * 2) % plan.steps.length]! + (rng() < 0.25 + 0.15 * lift ? (rng() < 0.5 ? -1 : 1) : 0);
          if (i === 0) step += lift;
          let nxt = melCur + step;
          const strong = off % 2 === 0;
          if (strong) nxt = nearestChordTone(nxt, chord);
          if (nxt > RANGE.melHi) nxt = RANGE.melHi - (isChordTone(RANGE.melHi, chord) ? 0 : 1);
          if (nxt < RANGE.melLo) nxt = RANGE.melLo + 1;
          if (strong) nxt = nearestChordTone(nxt, chord);
          if (allowed) nxt = snapToDegrees(nxt, allowed);
          if (nxt > RANGE.melHi) nxt -= N; if (nxt < RANGE.melLo) nxt += N;
          melCur = nxt;
          add('melody', t0 + off, Math.min(dur, MUSIC.barBeats - off), nxt, (0.6 + rng() * 0.25) * th.melodyVel, off === 0 ? 0.15 : 0.3 + rng() * 0.5, th.inst.melody);
        });
      }
      // Percussion (optional, light): brush backbeats on 2 and 4 + a rare ghost note; shaker = soft eighths.
      if (th.inst.perc === 'shaker') { for (let k = 0; k < 8; k++) if (k % 2 === 1 || rng() < 0.2) add('perc', t0 + k * 0.5, 0.1, 80, k % 2 ? 0.7 : 0.45, 0.5 + rng() * 0.4, 'shaker', true); }
      else if (th.inst.perc) { for (const k of [1, 3]) add('perc', t0 + k, 0.2, 80, 0.7, 0.3 + rng() * 0.2, th.inst.perc, true); if (rng() < 0.35) add('perc', t0 + 2.5, 0.2, 80, 0.4, 0.6 + rng() * 0.3, th.inst.perc, true); }
    }
  }
  // Stable order: by beat, then layer priority (pad/bass claim voices first).
  events.sort((a, b) => a.beat - b.beat || LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.midi - b.midi);
  return { seed, track: trackId, root, mode, bars, totalBeats: bars * MUSIC.barBeats, form, chords, events };
}

/** Next key: a musically close move (4th / 5th / whole tone / minor third up or down) that always differs from `prevRoot`; kept in a one-octave window. */
export function nextRoot(prevRoot: number | null, th: Theme, rng: () => number): number {
  if (prevRoot === null) return th.roots[Math.floor(rng() * th.roots.length)]!;
  const moves = [5, 7, 2, -2, 3, -3, 4];
  void th;
  const mv = moves[Math.floor(rng() * moves.length)]!;
  let r = prevRoot + mv;
  while (r > 59) r -= 12; while (r < 48) r += 12;
  return r === prevRoot ? r + 2 : r;
}

export const pieceSeed = (base: number, dayKey: number, index: number, track: TrackId): number => hashSeed(base, dayKey, index, TRACK_IDS.indexOf(track));
export { LAYERS };
