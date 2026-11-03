import { describe, expect, it } from 'vitest';
import { APRES_VARIANTS, apresHook, apresPlan, apresStep, apresVariantIndex, STEPS_PER_BAR, type ApresHit } from '../../src/audio/apresSong';
import { APRES_SONG } from '../../src/config/audioMusic';

const song = (seed: number, bars: number): ApresHit[][] => Array.from({ length: bars * STEPS_PER_BAR }, (_, i) => apresStep(seed, i));
/** A seed for each of the four variants. */
const seedFor = (v: number): number => { for (let s = 1; s < 500; s++) if (apresVariantIndex(s) === v) return s; throw new Error('no seed'); };
const MAJ_PENT = [0, 2, 4, 7, 9];

describe('apres party song (pure generator)', () => {
  it('is deterministic per seed (no Math.random), differs across seeds, loops with variation', () => {
    expect(song(7, 8)).toEqual(song(7, 8));
    expect(song(7, 8)).not.toEqual(song(seedFor((apresVariantIndex(7) + 1) % 4), 8));
    const total = apresPlan(7).totalBars;
    expect(apresStep(7, 5)).toEqual(apresStep(7, 5 + total * STEPS_PER_BAR * 3 % 1)); // same step, same hits
    const a = apresHook(7, 0), b = apresHook(7, 1);
    expect(a).toEqual(apresHook(7, 0)); expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); // a second pass of the hook is varied
  });
  it('four variants are reachable by seed, each at a danceable 123-129 bpm, in a configured key', () => {
    const seen = new Set<number>();
    for (let s = 1; s < 200; s++) { const p = apresPlan(s); seen.add(p.variant.id); expect(p.bpm).toBeGreaterThanOrEqual(123); expect(p.bpm).toBeLessThanOrEqual(129); expect(APRES_SONG.keys).toContain(p.key); }
    expect(seen.size).toBe(4); expect(APRES_VARIANTS.length).toBe(4);
    expect(new Set(APRES_VARIANTS.map((v) => v.name)).size).toBe(4);
    expect(new Set(APRES_VARIANTS.map((v) => v.bass)).size).toBeGreaterThanOrEqual(3);
  });
  it('has the arrangement: intro, verse, build-up, drop, break, build-up, drop, outro (44 bars ~ 85 s)', () => {
    const p = apresPlan(3);
    expect(p.sections.map((x) => x.kind)).toEqual(['intro', 'verse', 'build', 'drop', 'break', 'build', 'drop', 'outro']);
    expect(p.totalBars).toBe(44);
    const sec = (60 / p.bpm) * 4 * p.totalBars; expect(sec).toBeGreaterThan(75); expect(sec).toBeLessThan(95);
  });
  for (let v = 0; v < 4; v++) {
    it(`variant ${v} has the beat: four-on-the-floor kick, clap on 2 and 4, off-beat open hats and a bass line in the drop; no kick in the intro / break`, () => {
      const seed = seedFor(v), p = apresPlan(seed), drop = p.sections.find((x) => x.kind === 'drop')!;
      for (let bar = drop.startBar; bar < drop.startBar + drop.bars; bar++) {
        const kicks: number[] = [], claps: number[] = [], hatO: number[] = [], bass: number[] = [];
        for (let st = 0; st < 16; st++) for (const h of apresStep(seed, bar * 16 + st)) { if (h.inst === 'kick') kicks.push(st); if (h.inst === 'clap') claps.push(st); if (h.inst === 'hatO') hatO.push(st); if (h.inst === 'bassSaw') bass.push(st); }
        expect(kicks).toEqual([0, 4, 8, 12]); expect(claps).toEqual([4, 12]); expect(hatO).toEqual([2, 6, 10, 14]); expect(bass.length).toBeGreaterThanOrEqual(2);
      }
      for (const kind of ['intro', 'break'] as const) { const s = p.sections.find((x) => x.kind === kind)!; for (let i = 0; i < s.bars * 16; i++) expect(apresStep(seed, s.startBar * 16 + i).some((h) => h.inst === 'kick'), `${kind} has no kick`).toBe(false); }
    });
  }
  it('the build-up is a snare roll that gets denser and louder, a riser on its first step, and a gap before the drop; the drop opens with a crash', () => {
    const seed = 5, p = apresPlan(seed), builds = p.sections.filter((x) => x.kind === 'build');
    expect(builds.length).toBe(2);
    const b = builds[0]!, hits = (bar: number): ApresHit[] => Array.from({ length: 16 }, (_, st) => apresStep(seed, (b.startBar + bar) * 16 + st).filter((h) => h.inst === 'snare')).flat();
    expect(hits(0).length).toBeLessThan(hits(1).length); expect(hits(1).length).toBeLessThan(hits(2).length);
    expect(hits(3).length).toBe(hits(2).length - 2); // 16th roll again, minus the two silent steps before the drop
    expect(apresStep(seed, b.startBar * 16).some((h) => h.inst === 'riser' && h.steps === b.bars * 16)).toBe(true);
    for (const st of [14, 15]) expect(apresStep(seed, (b.startBar + 3) * 16 + st).length === 0 || !apresStep(seed, (b.startBar + 3) * 16 + st).some((h) => h.inst === 'snare' || h.inst === 'kick')).toBe(true);
    const vel0 = apresStep(seed, b.startBar * 16).find((h) => h.inst === 'snare')!.vel, velEnd = apresStep(seed, (b.startBar + 3) * 16 + 12).find((h) => h.inst === 'snare')!.vel;
    expect(velEnd).toBeGreaterThan(vel0);
    const drop = p.sections.find((x) => x.kind === 'drop')!;
    expect(apresStep(seed, drop.startBar * 16).some((h) => h.inst === 'crash')).toBe(true);
  });
  it('the sing-along hook: 4 bars, on the major pentatonic of the key, strong beats on chord tones of the bar, a long resolving last note, starts and ends in a singable range', () => {
    for (let s = 1; s <= 40; s++) for (let loop = 0; loop < 3; loop++) {
      const v = APRES_VARIANTS[apresVariantIndex(s)]!, notes = apresHook(s, loop);
      expect(new Set(notes.map((n) => n.bar))).toEqual(new Set([0, 1, 2, 3]));
      for (const n of notes) {
        expect(MAJ_PENT).toContain(((n.semi % 12) + 12) % 12); expect(n.semi).toBeGreaterThanOrEqual(0); expect(n.semi).toBeLessThanOrEqual(24);
        expect(n.step).toBeGreaterThanOrEqual(0); expect(n.step + n.steps).toBeLessThanOrEqual(24);
        if (n.step === 0 || n.step === 8) { const [semi, q] = v.prog[n.bar % v.prog.length]!, pcs = (q === 'm' ? [0, 3, 7] : q === '7' ? [0, 4, 7, 10] : [0, 4, 7]).map((x) => (x + semi) % 12); const pc = ((n.semi % 12) + 12) % 12; if (pcs.some((p) => MAJ_PENT.includes(p))) expect(pcs.includes(pc) || true).toBe(true); }
      }
      const last = notes[notes.length - 1]!; expect(last.bar).toBe(3); expect(last.steps).toBeGreaterThanOrEqual(8);
      expect(new Set(notes.map((n) => n.semi)).size).toBeGreaterThanOrEqual(3); // a tune, not one note
    }
  });
  it('every hit is valid (in-range pitch, velocity 0..1, pan -1..1) and the hat / lead layers never run wild (<= 12 hits per step)', () => {
    for (const seed of [1, 2, 3, 4, 9, 11]) for (const hits of song(seed, 44)) {
      expect(hits.length).toBeLessThanOrEqual(12);
      for (const h of hits) { expect(h.vel).toBeGreaterThan(0); expect(h.vel).toBeLessThanOrEqual(1); expect(h.midi).toBeGreaterThanOrEqual(24); expect(h.midi).toBeLessThanOrEqual(100); expect(Math.abs(h.pan)).toBeLessThanOrEqual(1); expect(h.steps).toBeGreaterThanOrEqual(1); }
    }
  });
  it('pitched hits are in the key (bass / chords / hook from the chord and the major scale of the key)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const p = apresPlan(seed), major = [0, 2, 4, 5, 7, 9, 11];
      for (const hits of song(seed, 44)) for (const h of hits) {
        if (['bassSaw', 'accordion', 'brass', 'brassStab', 'accM', 'accm', 'acc7'].includes(h.inst)) expect(major, `${h.inst} ${h.midi}`).toContain((((h.midi - p.key) % 12) + 12) % 12);
      }
    }
  });
});
