import { MUSIC_MIX } from '../config/audioMusic';
import { LAYERS, MUSIC, THEMES, TRACK_IDS, type InstId, type Layer, type Theme, type TrackId } from './musicThemes';
import { chordIdx, hashSeed, isChordTone, mulberry32, nearestChordTone, PENTATONIC_DEGREES, scaleNote, seventhIdx, snapToDegrees, voiceLead, N, type ModeName } from './theory';

export interface NoteEvent { /** Beat from the start of the piece (multiple of MUSIC.stepBeats). */ beat: number; dur: number; midi: number; vel: number; inst: InstId; layer: Layer; /** Stereo position -1..1. */ pan: number; /** 0..1: plays when rank < layer weight (low = essential). */ rank: number; /** Timing offset in beats added at scheduling time (swing / laid-back snare); |nudge| < one step. */ nudge?: number }
export type Role = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
export interface Section { letter: string; role: Role; startBar: number; bars: number }
export interface Piece { seed: number; track: TrackId; root: number; mode: ModeName; bars: number; totalBeats: number; form: string; barsPerChord: number; sections: Section[]; /** Chord (scale indices) per bar. */ chords: number[][]; events: NoteEvent[] }

/** Melody scale-index range (root+octave .. ~2 octaves up) and arp / bass / pad / counter centres. */
export const RANGE = { melLo: 7, melHi: 16, arpLo: 3, arpHi: 11, padCenter: 4, bassOct: -7, cntLo: 4, cntHi: 10 };
const LAYER_ORDER: Record<Layer, number> = { pad: 0, bass: 1, perc: 2, melody: 3, counter: 4, arp: 5 };
const q = (b: number): number => Math.round(b / MUSIC.stepBeats) * MUSIC.stepBeats;
const ROLE_OF: Record<string, Role> = { I: 'intro', A: 'verse', B: 'chorus', C: 'bridge', O: 'outro' };
/** Bars of a form letter: intro / outro are short, the rest are two 4-bar phrases. */
export const sectionBars = (letter: string): number => (letter === 'I' || letter === 'O' ? MUSIC.introBars : MUSIC.barsPerSection);

function bassIdx(chordRoot: number): number { return chordRoot + RANGE.bassOct; }

type Rhythm = ReadonlyArray<readonly [number, number]>;
const RHYTHMS: readonly Rhythm[] = [
  [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]], [[0, 2], [2, 1], [3, 1]],
  [[0.5, 1], [1.5, 0.5], [2, 1.5], [3.5, 0.5]], [[0, 3], [3, 1]], [[0, 1], [1.5, 0.5], [2, 1], [3, 1]],
  [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 2]], [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]],
];
const CADENCE: Rhythm = [[0, 1], [1, 1], [2, 2]];
/** Bass patterns for the groove style: [beat, dur, scale-index offset from the chord root (0 root, 4 fifth, 7 octave), velocity]. */
const GROOVES: ReadonlyArray<ReadonlyArray<readonly [number, number, number, number]>> = [
  [[0, 1, 0, 0.85], [1.5, 0.5, 0, 0.55], [2, 1, 4, 0.7], [3.5, 0.5, 5, 0.5]],
  [[0, 0.75, 0, 0.85], [0.75, 0.75, 0, 0.5], [2, 0.75, 4, 0.7], [2.75, 0.5, 0, 0.5]],
  [[0, 1.5, 0, 0.85], [1.5, 0.5, 4, 0.55], [2.5, 0.5, 7, 0.6], [3, 1, 4, 0.6]],
  [[0, 0.5, 0, 0.8], [0.5, 0.5, 0, 0.4], [1.5, 0.5, 4, 0.6], [2, 1, 0, 0.75], [3, 0.5, 2, 0.5], [3.5, 0.5, 4, 0.5]],
];
const COUNTER_RH: ReadonlyArray<readonly number[]> = [[0, 2], [0, 1.5, 2.5], [1, 3], [0.5, 2]];

export interface DrumHit { beat: number; dur: number; inst: InstId; vel: number; rank: number; nudge: number }
/**
 * One bar of drums (pure, deterministic in `rng`). `level` 2 = full (chorus), 1 = lighter (verse), 0 = no kick (bridge / intro lead-in). `fill` = the bar before a phrase ends
 * gets a short snare / rim run. Swing delays the off-beat eighths (and the 16th ghosts a little). Ranks decide what survives when the resort is quiet (kick and backbeat first).
 */
export function drumBar(kit: Theme['kit'], level: 0 | 1 | 2, fill: boolean, rng: () => number, swing: number, snare: InstId = 'snareSoft'): DrumHit[] {
  const out: DrumHit[] = [], sw = swing * 0.5; // beats of delay for an off-beat eighth at full swing 0.33 = ~0.17 beat
  const hit = (beat: number, inst: InstId, vel: number, rank: number, nudge = 0): void => { out.push({ beat, dur: 0.2, inst, vel, rank, nudge }); };
  if (kit === 'none') return out;
  if (kit === 'brush') {
    for (const k of [1, 3]) hit(k, 'brush', 0.7, 0.3 + rng() * 0.2);
    if (rng() < 0.35) hit(2.5, 'brush', 0.4, 0.6 + rng() * 0.3, sw);
    if (fill && rng() < 0.6) { hit(3.5, 'brush', 0.45, 0.5, sw); hit(3.75, 'brush', 0.55, 0.55, sw); }
    return out;
  }
  if (kit === 'shaker') {
    for (let k = 0; k < 8; k++) if (k % 2 === 1 || rng() < 0.2) hit(k * 0.5, 'shaker', k % 2 ? 0.7 : 0.45, 0.5 + rng() * 0.4, k % 2 ? sw : 0);
    return out;
  }
  const lofi = kit === 'lofi';
  if (level >= 1) { // kick
    hit(0, 'kickSoft', 0.95, 0.1);
    if (lofi) { if (rng() < 0.7) hit(rng() < 0.5 ? 1.75 : 2.5, 'kickSoft', 0.7, 0.3); if (level === 2 && rng() < 0.4) hit(3.5, 'kickSoft', 0.55, 0.45); }
    else { hit(2, 'kickSoft', 0.8, 0.15); if (rng() < 0.4) hit(rng() < 0.5 ? 1.75 : 3.5, 'kickSoft', 0.55, 0.4); }
  }
  // backbeat
  for (const k of [1, 3]) hit(k, level === 2 ? snare : 'rim', level === 2 ? 0.8 : 0.7, 0.2, lofi ? 0.03 : 0);
  // hats on the eighths (off-beats swung), ghost sixteenths
  for (let k = 0; k < 8; k++) { const off = k % 2 === 1; if (!off && level < 2) continue; hit(k * 0.5, 'hatSoft', off ? 0.7 : 0.4, 0.35 + rng() * 0.25, off ? sw : 0); }
  if (level >= 1) for (const g of [0.75, 1.75, 2.75, 3.75]) if (rng() < (lofi ? 0.35 : 0.2)) hit(g, 'hatSoft', 0.3, 0.7 + rng() * 0.25, sw);
  if (fill) { const base = lofi ? 3.25 : 3; for (let k = 0; base + k * 0.25 < 4; k++) hit(base + k * 0.25, lofi ? 'rim' : snare, 0.35 + 0.15 * k, 0.45); }
  return out;
}

/** Bar index of the first bar <= `bar` whose pad is (re)struck: the start of its chord group. */
export const chordStartBar = (bar: number, barsPerChord: number): number => Math.floor(bar / barsPerChord) * barsPerChord;

/** Composes one piece. Pure and deterministic in (seed, track, root). All pitched notes are scale tones (melody: the pentatonic subset when the theme says so); the pad is voice-led. `root` is the untransposed key; the piece's root includes the theme's transposition. */
export function composePiece(seed: number, trackId: TrackId, keyRoot: number): Piece {
  const th: Theme = THEMES[trackId], rng = mulberry32(seed), root = keyRoot + th.transpose;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)]!;
  const mode = pick(th.modes);
  const form = th.form, sections: Section[] = [];
  let acc = 0;
  for (const letter of form) { const n = sectionBars(letter); sections.push({ letter, role: ROLE_OF[letter] ?? 'verse', startBar: acc, bars: n }); acc += n; }
  const bars = acc, events: NoteEvent[] = [], chords: number[][] = [];
  const melSide = (seed >>> 5) & 1 ? 0.2 : -0.2;
  const allowed = th.pentatonic ? PENTATONIC_DEGREES[mode] : null;
  const add = (layer: Layer, beat: number, dur: number, idxOrMidi: number, vel: number, rank: number, inst: InstId, raw = false, panBias = 0, nudge = 0): void => {
    const midi = raw ? idxOrMidi : scaleNote(root, mode, idxOrMidi);
    const pan = layer === 'bass' ? 0 : layer === 'melody' ? melSide : layer === 'counter' ? -melSide : layer === 'perc' ? (Math.floor(beat * 2) % 2 ? 0.25 : -0.25) : layer === 'arp' ? (((midi * 5) % 7) - 3) * 0.13 : panBias;
    const e: NoteEvent = { beat: q(beat), dur, midi, vel, inst, layer, pan: Math.max(-0.8, Math.min(0.8, pan)), rank };
    if (nudge) e.nudge = nudge;
    events.push(e);
  };
  // Per-letter plans: A (verse), B (chorus) and C (bridge) differ in progression, motif, bass groove and counter rhythm; repeats vary. Intro / outro borrow the verse chords.
  interface Plan { prog: readonly number[]; steps: number[]; rh: Rhythm[]; groove: number[]; crh: number; seen: number }
  const plans = new Map<string, Plan>();
  const order = [...new Set(form)].sort((a, b) => ('ABC'.includes(b) ? 1 : 0) - ('ABC'.includes(a) ? 1 : 0) || (a < b ? -1 : 1));
  for (const letter of order) {
    const base = pick(th.progressions);
    const others = th.progressions.filter((p) => p !== plans.get('A')?.prog && p !== plans.get('B')?.prog);
    const prog = letter === 'A' || !others.length ? base : ('IO'.includes(letter) ? (plans.get('A')?.prog ?? base) : pick(others));
    const steps = Array.from({ length: 4 }, () => pick([-2, -1, -1, 1, 1, 2, 0]));
    plans.set(letter, { prog, steps, rh: [pick(RHYTHMS), pick(RHYTHMS)], groove: [Math.floor(rng() * GROOVES.length), Math.floor(rng() * GROOVES.length)], crh: Math.floor(rng() * COUNTER_RH.length), seen: 0 });
  }
  let padPrev: number[] | null = null, melCur = RANGE.melLo + 3, cntCur = RANGE.cntLo + 2;
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s]!, plan = plans.get(sec.letter)!, variation = plan.seen++, lastSection = s === sections.length - 1, role = sec.role;
    const lift = variation > 0 || role === 'chorus' ? 1 : 0;
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.startBar + b, t0 = bar * MUSIC.barBeats, deg = plan.prog[Math.floor(b / th.barsPerChord) % plan.prog.length]!;
      const chord = chordIdx(deg), padChord = th.seventh ? seventhIdx(deg) : chord;
      chords.push(chord);
      const phraseEnd = b % 4 === 3, final = lastSection && b === sec.bars - 1;
      // Pad: voice-led triad held for the bar (re-struck each bar).
      const voicing = voiceLead(padPrev, padChord, RANGE.padCenter); padPrev = voicing;
      const sustain = th.inst.pad === 'pad' || th.inst.pad === 'strings';
      const first = b % th.barsPerChord === 0 || !sustain;
      if (first) voicing.forEach((i, k) => add('pad', t0, sustain ? MUSIC.barBeats * Math.min(th.barsPerChord, sec.bars - b) : MUSIC.barBeats, i, (0.7 + k * 0.05) * th.padVel, 0.05, th.inst.pad, false, (k - (voicing.length - 1) / 2) * 0.35));
      // Bass (not in the first two bars of an intro).
      const br = bassIdx(deg), fifth = br + 4, nextDeg = plan.prog[Math.floor((b + 1) / th.barsPerChord) % plan.prog.length]!;
      if (role !== 'intro' || b >= 2) {
        if (th.bassStyle === 'whole') { if (b % th.barsPerChord === 0) add('bass', t0, MUSIC.barBeats * Math.min(th.barsPerChord, sec.bars - b), br, 0.8, 0.1, th.inst.bass); }
        else if (th.bassStyle === 'rootFifth') { add('bass', t0, 1.5, br, 0.85, 0.1, th.inst.bass); add('bass', t0 + 2, 1.5, fifth, 0.65, 0.4, th.inst.bass); }
        else if (th.bassStyle === 'groove') {
          const g = GROOVES[plan.groove[b % 2]!]!;
          for (const [off, dur, io, v] of g) add('bass', t0 + off, dur, br + io, v, off === 0 ? 0.1 : 0.3 + (v < 0.6 ? 0.25 : 0), th.inst.bass);
        } else for (let k = 0; k < 4; k++) add('bass', t0 + k, 0.75, k % 2 ? fifth : br, k === 0 ? 0.85 : 0.6, k === 0 ? 0.1 : 0.45, th.inst.bass);
        if (b % th.barsPerChord === th.barsPerChord - 1 && th.bassStyle !== 'whole' && !final && rng() < 0.5) // walking pickup toward the next chord's root
          add('bass', t0 + 3.5, 0.5, bassIdx(nextDeg) + (rng() < 0.5 ? -1 : 1), 0.5, 0.6, th.inst.bass);
      }
      // Arp over chord tones (+ octave), with rests; a different pattern each couple of bars (sparser in an intro / outro).
      const pat = th.arpPatterns[(Math.floor(bar / 2) + s) % th.arpPatterns.length]!;
      const arpBase = chord.map((c) => c + 7 * Math.round((RANGE.arpLo + 2 - c) / 7));
      arpBase.sort((a, b2) => a - b2);
      const cnt = Math.floor(MUSIC.barBeats / th.arpStep), arpRest = Math.min(0.9, th.arpRest + (role === 'intro' || role === 'outro' ? 0.25 : 0) + (role === 'bridge' ? 0.1 : 0));
      for (let k = 0; k < cnt; k++) {
        if (rng() < arpRest) continue;
        const pos = pat[k % pat.length]!;
        let idx = arpBase[pos % 3]! + (pos >= 3 ? 7 : 0);
        idx = Math.min(RANGE.arpHi, Math.max(RANGE.arpLo, idx));
        add('arp', t0 + k * th.arpStep, th.arpStep * 1.5, idx, (k % 2 === 0 ? 0.8 : 0.55) + rng() * 0.1, k === 0 ? 0.2 : 0.3 + rng() * 0.55, th.inst.arp);
      }
      // Counter-melody: held chord tones that move by step under / around the lead (chorus, bridge, and the verse once it repeats).
      if (!final && (role === 'chorus' || role === 'bridge' || (role === 'verse' && variation > 0))) {
        const rh = COUNTER_RH[plan.crh]!;
        rh.forEach((off, i) => {
          if (rng() < (role === 'bridge' ? 0.05 : 0.2)) return;
          let n = cntCur + pick([-2, -1, 0, 1, 2]);
          n = Math.min(RANGE.cntHi, Math.max(RANGE.cntLo, n)); n = nearestChordTone(n, chord);
          while (n > RANGE.cntHi) n -= N; while (n < RANGE.cntLo) n += N;
          cntCur = n;
          const next = rh[i + 1] ?? MUSIC.barBeats;
          add('counter', t0 + off, Math.min(next - off, 2.5), n, 0.55 + rng() * 0.15, off === 0 ? 0.25 : 0.4 + rng() * 0.4, th.inst.counter);
        });
      }
      // Melody: motif-driven walk; phrases end with a cadence on a chord tone; the last bar of the piece resolves to a chord tone.
      const melodic = role === 'verse' || role === 'chorus' || role === 'bridge' || (role === 'outro' && final);
      if (melodic) {
        if (final) { let fi = nearestChordTone(melCur, chord); if (allowed) fi = snapToDegrees(fi, allowed); while (fi < RANGE.melLo) fi += N; while (fi > RANGE.melHi) fi -= N; add('melody', t0, 4, fi, 0.8 * th.melodyVel, 0.1, th.inst.melody); }
        else if (!(rng() < th.melodyRest * (role === 'chorus' ? 0.6 : role === 'bridge' ? 1.5 : 1) * (phraseEnd ? 1.8 : 1) * (role === 'chorus' && b % 4 === 0 ? 0.2 : 1))) {
          const rh = phraseEnd ? CADENCE : plan.rh[b % 2]!;
          rh.forEach(([off, dur], i) => {
            let step = plan.steps[(i + (b % 2) * 2) % plan.steps.length]! + (rng() < 0.25 + 0.15 * lift ? (rng() < 0.5 ? -1 : 1) : 0);
            if (i === 0) step += lift;
            let nxt = melCur + step;
            const strong = off % 2 === 0 || (phraseEnd && i === rh.length - 1);
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
      }
      // Drums: the verse is lighter, the chorus full; the bridge drops the kick; an intro only leads in with a fill; the outro is bare. Fills end phrases.
      if (th.kit !== 'none' && role !== 'outro') {
        const level: 0 | 1 | 2 = role === 'chorus' ? 2 : role === 'verse' ? 1 : 0;
        const lead = role === 'intro' && b === sec.bars - 1;
        if (role !== 'intro' || lead) {
          const swing = th.kit === 'lofi' ? MUSIC_MIX.swingLofi : th.swing;
          const hits = lead ? drumBar(th.kit, 0, true, rng, swing).filter((h) => h.beat >= 2.5) : drumBar(th.kit, level, phraseEnd && b % 8 === 7, rng, swing, role === 'chorus' ? 'snareSoft' : 'rim');
          for (const h of hits) add('perc', t0 + h.beat, h.dur, 80, h.vel, h.rank, h.inst, true, 0, h.nudge);
        }
      }
    }
  }
  // Stable order: by beat, then layer priority (pad/bass claim voices first).
  events.sort((a, b) => a.beat - b.beat || LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.midi - b.midi);
  return { seed, track: trackId, root, mode, bars, totalBeats: bars * MUSIC.barBeats, form, barsPerChord: th.barsPerChord, sections, chords, events };
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
