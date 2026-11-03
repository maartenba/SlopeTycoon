import { APRES_SONG } from '../config/audioMusic';
import type { InstId } from './musicThemes';

/**
 * Apres-Ski Bar party music: a pure, deterministic song generator (no Math.random, no audio). 4/4 at 124-128 bpm, four-on-the-floor kick, clap on 2 and 4, off-beat open hats, driving bass,
 * accordion chord stabs and brass hits, a sing-along pentatonic hook (no lyrics), and a real arrangement: intro, verse, build-up (snare roll + riser), DROP, break, build-up, drop, outro.
 * Four variants chosen by the seed (tempo, key, chords, bass style, lead instrument). `apresStep(seed, step)` is the whole API: the hits of one sixteenth-note step (loops forever).
 * Played by `Apres.ts`; rendered offline by `npm run audio:export`. Tunables: `APRES_SONG` in src/config/audioMusic.ts.
 */
const A = APRES_SONG;
export const STEPS_PER_BAR = 16;

/** Deterministic hash -> [0, 1). */
export function hash01(seed: number, n: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export type Quality = 'M' | 'm' | '7';
export type BassStyle = 'offbeat' | 'oompah' | 'roll';
export interface ApresVariant { id: number; name: string; bpm: number; /** One chord per bar, repeating: semitones above the key and quality. */ prog: ReadonlyArray<readonly [number, Quality]>; bass: BassStyle; lead: 'accordion' | 'brass'; /** Hook starting degrees (pentatonic index) to choose from. */ hookStart: readonly number[] }
export const APRES_VARIANTS: readonly ApresVariant[] = [
  { id: 0, name: 'Party-Schlager', bpm: A.bpms[0]!, prog: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], bass: 'offbeat', lead: 'accordion', hookStart: [4, 5, 6] },
  { id: 1, name: 'Polka-EDM', bpm: A.bpms[1]!, prog: [[0, 'M'], [5, 'M'], [7, '7'], [0, 'M']], bass: 'oompah', lead: 'accordion', hookStart: [2, 4, 5] },
  { id: 2, name: 'Ballermann Anthem', bpm: A.bpms[2]!, prog: [[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']], bass: 'offbeat', lead: 'brass', hookStart: [4, 5, 7] },
  { id: 3, name: 'Brass Drop', bpm: A.bpms[3]!, prog: [[0, 'M'], [9, 'm'], [5, 'M'], [7, '7']], bass: 'roll', lead: 'brass', hookStart: [4, 5, 6] },
];
export const apresVariantIndex = (seed: number): number => Math.floor(hash01(seed, 1) * APRES_VARIANTS.length);

export type SectionKind = 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro';
export interface ApresPlan { variant: ApresVariant; key: number; bpm: number; sections: Array<{ kind: SectionKind; startBar: number; bars: number }>; totalBars: number }
const PLAN_CACHE = new Map<number, ApresPlan>();
export function apresPlan(seed: number): ApresPlan {
  const hit = PLAN_CACHE.get(seed); if (hit) return hit;
  if (PLAN_CACHE.size > 32) PLAN_CACHE.clear();
  const plan = buildPlan(seed); PLAN_CACHE.set(seed, plan); return plan;
}
function buildPlan(seed: number): ApresPlan {
  const variant = APRES_VARIANTS[apresVariantIndex(seed)]!, key = A.keys[Math.floor(hash01(seed, 2) * A.keys.length)]!;
  const sections: ApresPlan['sections'] = []; let bar = 0;
  for (const [kind, bars] of A.form) { sections.push({ kind: kind as SectionKind, startBar: bar, bars }); bar += bars; }
  return { variant, key, bpm: variant.bpm + (hash01(seed, 3) < 0.5 ? 0 : 1) - (variant.bpm >= 128 ? 1 : 0), sections, totalBars: bar };
}

export interface ApresHit { inst: InstId; midi: number; vel: number; /** Length in sixteenth steps. */ steps: number; pan: number }

const PENT = [0, 2, 4, 7, 9];
/** Pentatonic degree index (any integer) -> semitones above the key. */
const pent = (i: number): number => 12 * Math.floor(i / 5) + PENT[((i % 5) + 5) % 5]!;
const CHORD_PCS: Record<Quality, readonly number[]> = { M: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10] };
const HOOK_RH: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 3], [3, 3], [6, 2], [8, 4]], [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], [[2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 4], [4, 2], [6, 2], [8, 8]],
];

export interface HookNote { bar: number; step: number; steps: number; /** Semitones above the key (in the hook register). */ semi: number }
/**
 * The 4-bar sing-along hook: bar 1 states a motif, bar 2 repeats it (call), bar 3 answers it higher, bar 4 resolves long on a chord tone of the last chord. Notes sit on the major
 * pentatonic (no clashes), strong beats snap to chord tones. `loop` (0, 1, ...) varies the contour slightly so a long stay does not loop obviously. Pure.
 */
export function apresHook(seed: number, loop: number): HookNote[] {
  const v = APRES_VARIANTS[apresVariantIndex(seed)]!, h = (n: number): number => hash01(seed, 1000 + loop * 37 + n);
  const rhA = HOOK_RH[Math.floor(h(1) * HOOK_RH.length)]!, rhB = HOOK_RH[Math.floor(h(2) * HOOK_RH.length)]!;
  let deg = v.hookStart[Math.floor(h(3) * v.hookStart.length)]!;
  const CONTOURS = [[1, 1, -1, 2], [2, -1, -1, 1], [-1, 2, 1, -2], [1, -1, 2, -1]] as const, contour = CONTOURS[Math.floor(h(10) * CONTOURS.length)]!;
  const steps = rhA.map((_, i) => contour[i % contour.length]!);
  const out: HookNote[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const [semi0, q] = v.prog[bar % v.prog.length]!, chordPcs = CHORD_PCS[q].map((x) => (x + semi0) % 12);
    const rh = bar === 2 ? rhB : rhA;
    let d = bar === 2 ? deg + 2 : deg;
    rh.forEach(([step, len], i) => {
      d += bar === 3 && i === rh.length - 1 ? 0 : steps[i % steps.length]!;
      let cand = d;
      if (step % 8 === 0 || i === rh.length - 1) { for (let k = 0; k <= 4; k++) { const a = pent(d - k) % 12, b = pent(d + k) % 12; if (chordPcs.includes(((a % 12) + 12) % 12)) { cand = d - k; break; } if (chordPcs.includes(((b % 12) + 12) % 12)) { cand = d + k; break; } } }
      cand = cand > 9 ? 9 - (cand - 9) : cand < 2 ? 2 + (2 - cand) : cand; cand = Math.max(2, Math.min(9, cand)); d = cand; // reflect at the edges of the singing range
      out.push({ bar, step, steps: bar === 3 && i === rh.length - 1 ? Math.max(len, 8) : len, semi: pent(cand) });
    });
    if (bar === 1) deg = d; // the call comes back where it ended
  }
  return out;
}

/** The hits of one sixteenth step (`step` 0 = first step of bar 0; loops after `totalBars`). Order = priority (kick, clap, bass first), so a voice cap drops the decoration. */
export function apresStep(seed: number, step: number): ApresHit[] {
  const plan = apresPlan(seed), v = plan.variant, loopSteps = plan.totalBars * STEPS_PER_BAR, loop = Math.floor(step / loopSteps), s = step % loopSteps;
  const barG = Math.floor(s / STEPS_PER_BAR), st = s % STEPS_PER_BAR;
  const sec = plan.sections.find((x) => barG >= x.startBar && barG < x.startBar + x.bars)!, bar = barG - sec.startBar, kind = sec.kind;
  const [semi, q] = v.prog[barG % v.prog.length]!, root = plan.key + semi, bassN = root - 12;
  const out: ApresHit[] = [];
  const g = A.sectionGain[kind] ?? 1; // the arrangement's dynamics: quieter verse / intro / break, the drop is the loudest
  const hit = (inst: InstId, midi: number, vel: number, steps: number, pan = 0): void => { out.push({ inst, midi, vel: Math.min(1, vel * g), steps, pan }); };
  const lastBuild = kind === 'build' && bar === sec.bars - 1;
  const rnd = (n: number): number => hash01(seed, step * 7 + n);
  // ---- drums ----
  const kickOn = kind === 'verse' || kind === 'drop' || (kind === 'outro' && bar < 2) || (kind === 'build' && bar < sec.bars - 1);
  if (kickOn && st % 4 === 0) hit('kick', 36, kind === 'build' ? 0.8 : 1, 2);
  if ((kind === 'verse' || kind === 'drop') && (st === 4 || st === 12)) hit('clap', 60, kind === 'drop' ? 1 : 0.8, 2);
  if (kind === 'build') { // snare roll: quarter, eighth, sixteenth notes (crescendo); the last two steps rest so the drop lands
    const dens = bar === 0 ? 4 : bar === 1 ? 2 : 1, tot = sec.bars * STEPS_PER_BAR, pos = bar * STEPS_PER_BAR + st;
    if (st % dens === 0 && !(lastBuild && st >= 14)) hit('snare', 60, 0.3 + 0.7 * (pos / tot), 2);
    if (bar === 0 && st === 0) hit('riser', 60, 1, sec.bars * STEPS_PER_BAR);
  }
  if (kind === 'drop' && bar === 0 && st === 0) hit('crash', 60, 1, 16);
  if (kind === 'drop' && bar === 4 && st === 0) hit('crash', 60, 0.7, 16);
  // hats
  if (kind === 'drop' || kind === 'verse') {
    if (st % 4 === 2) hit('hatO', 60, kind === 'drop' ? 0.9 : 0.65, 3, -0.2);
    else if (kind === 'drop' && st % 2 === 1 && rnd(1) < 0.55) hit('hat', 60, 0.38, 1, 0.25);
    else if (kind === 'verse' && st % 4 === 0 && rnd(2) < 0.5) hit('hat', 60, 0.3, 1, 0.25);
  } else if (kind === 'intro' || kind === 'break' || kind === 'outro') { if (st % 2 === 0 && (kind !== 'outro' || bar < 2)) hit('hat', 60, kind === 'intro' ? 0.4 + bar * 0.08 : 0.35, 1, 0.25); }
  // ---- bass ----
  const bassOn = kind === 'verse' || kind === 'drop' || (kind === 'intro' && bar >= 2) || kind === 'build' || (kind === 'outro' && bar === 0);
  if (bassOn) {
    const vol = kind === 'drop' ? 1 : kind === 'verse' ? 0.8 : 0.55;
    if (kind === 'intro' || kind === 'outro' || kind === 'build') { if (st === 0) hit('bassSaw', bassN, vol, kind === 'build' ? 8 : 16); else if (kind === 'build' && st === 8) hit('bassSaw', bassN, vol, 8); }
    else if (v.bass === 'offbeat') { if (st % 4 === 2) hit('bassSaw', bassN + (kind === 'drop' && st === 14 && bar % 2 === 1 ? 7 : 0) + (kind === 'drop' && st === 10 && bar % 4 === 3 ? 12 : 0), vol, 2); }
    else if (v.bass === 'oompah') { if (st === 0) hit('bassSaw', bassN, vol, 3); else if (st === 8) hit('bassSaw', bassN + 7, vol * 0.9, 3); else if (kind === 'drop' && st === 14) hit('bassSaw', bassN + 12, vol * 0.7, 1); }
    else if ([2, 3, 6, 7, 10, 11, 14, 15].includes(st)) hit('bassSaw', bassN + (st % 4 === 3 ? 12 : 0), vol * (st % 4 === 3 ? 0.7 : 1), 1);
  }
  // ---- chords ----
  const acc: InstId = q === 'm' ? 'accm' : q === '7' ? 'acc7' : 'accM', cr = root + 12;
  if (kind === 'verse') { if (st === 4 || st === 12) hit(acc, cr, 0.7, 3, -0.15); }
  else if (kind === 'drop') { if (st === 4 || st === 12 || st === 2 && bar % 2 === 1) hit(acc, cr, 0.85, 3, -0.15); if (st === 0 || st === 10) hit('brassStab', root + 12, 0.8, 2, 0.15); }
  else if (kind === 'build') { if (st === 0 || st === 8) hit(acc, cr, 0.5 + 0.1 * bar, 8, -0.1); }
  else if (kind === 'intro' || kind === 'break') { if (st === 0) hit(acc, cr, kind === 'intro' ? 0.4 + bar * 0.05 : 0.5, 16, -0.1); }
  else if (kind === 'outro' && bar < 2 && st === 0) hit(acc, cr, 0.4, 16, -0.1);
  // ---- hook: quietly at the end of the verse (anticipation), full in both drops, solo in the break ----
  const hookBars = kind === 'drop' ? 8 : kind === 'verse' ? 4 : kind === 'break' ? 4 : 0;
  if (hookBars && (kind !== 'verse' || bar >= 4)) {
    const hb = bar % 4, second = kind === 'drop' && bar >= 4, notes = apresHook(seed, loop * 2 + (second ? 1 : 0)), base = plan.key + (v.lead === 'accordion' ? 24 : 12);
    for (const n of notes) if (n.bar === hb && n.step === st) {
      const velBase = kind === 'drop' ? 0.95 : kind === 'verse' ? 0.6 : 0.7;
      hit(v.lead === 'accordion' ? 'accordion' : 'brass', base + n.semi + (second ? 0 : 0), velBase, n.steps, 0.1);
      if (second) hit(v.lead === 'accordion' ? 'brass' : 'accordion', base + n.semi - (v.lead === 'accordion' ? 12 : -12), 0.5, n.steps, -0.1);
    }
  }
  return out;
}

/** Seconds of one sixteenth step at the plan's tempo. */
export const stepSeconds = (seed: number): number => 60 / apresPlan(seed).bpm / 4;
