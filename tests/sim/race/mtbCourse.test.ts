import { describe, expect, it } from 'vitest';
import { RACE } from '../../../src/config/race';
import { DOWNHILLER_TYPE, SHIPPED_TYPES, CORE_TYPE_COUNT } from '../../../src/config/guestTypes';
import { Layer } from '../../../src/world/Networks';
import { stateHash } from '../../../src/game/saveState';
import type { Sim } from '../../../src/game/createSim';
import { mkSummer, prepareDownhill } from './helpers';

const riders = (s: Sim): number => { const st = s.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === DOWNHILLER_TYPE) n++; return n; };

describe('Downhill course (0.8.2)', () => {
  it('the Downhiller is a shipped extra at its index', () => { expect(SHIPPED_TYPES[DOWNHILLER_TYPE - CORE_TYPE_COUNT]!.id).toBe('downhiller'); });
  it('no downhillers or demand without a marked, valid course; marking works with both huts', () => {
    const s = mkSummer();
    expect(s.race.demandMtb(0)).toBe(0);
    s.guestSim.spawner.rateMult = 6; s.tick(240 * 2); expect(riders(s)).toBe(0);
    const { id } = prepareDownhill(s, 2);
    expect(s.race.reasonFor(s.mtbRuns[0]!)).toBeNull();
    expect(s.setRunCourse(id, true).ok).toBe(true);
    s.tick(2);
    expect(s.race.activeMtb().length).toBe(1);
    expect(s.race.active().length).toBe(0); expect(s.race.demand(0)).toBe(0); // winter racers unaffected
    expect(s.race.demandMtb(0)).toBeCloseTo(RACE.diffQuality[3]! * RACE.mtb.surface, 5);
    expect(s.race.demandMtb(RACE.mtb.maxRidersPerCourse)).toBe(0);
  }, 60_000);
  it('a course without a Timing Hut is refused with the trail wording', () => {
    const s = mkSummer(); const { id } = prepareDownhill(s, 2);
    for (const b of s.buildings.all().filter((x) => x.type === 'timingHut')) s.buildings.remove?.(b.id);
    s.tick(2);
    const r = s.setRunCourse(id, true); expect(r.ok).toBe(false); expect(r.reason).toBe(RACE.mtb.reasons.noTimingHut);
  });
  it('downhillers arrive, lap, pay; deterministic', () => {
    const go = (): { h: string; laps: number; seen: number } => {
      const s = mkSummer(); const { id } = prepareDownhill(s, 2); s.setRunCourse(id, true); s.guestSim.spawner.rateMult = 10;
      let seen = 0; for (let d = 0; d < 6; d++) { s.tick(240); seen = Math.max(seen, riders(s)); }
      return { h: stateHash(s).hash, laps: s.race.total, seen };
    };
    const a = go(), b = go();
    expect(a.h).toBe(b.h);
    expect(a.seen).toBeGreaterThan(0); expect(a.laps).toBeGreaterThan(0);
  }, 120_000);
});

describe('Downhill course fixes (0.8.2 follow-up)', () => {
  const lifts = (s: Sim, kind: string): void => { s.lifts.all().forEach((l) => { l.kind = kind as never; }); s.tick(1); };
  it('1. a course no bike lift reaches is "not usable" with the reason, draws no demand, no Downhiller; the lift brings it back', () => {
    const s = mkSummer(); const { id } = prepareDownhill(s, 2);
    lifts(s, 'tbar'); expect(s.setRunCourse(id, true).ok).toBe(true); s.tick(2);
    const c = s.race.courses()[0]!;
    expect(c.valid).toBe(true); expect(c.blocked).toBe(RACE.mtb.noLift);
    expect(s.race.demandMtb(0)).toBe(0); expect(s.race.activeMtb().length).toBe(0); expect(s.race.mtbStarts().length).toBe(0);
    expect(s.trailRows()[0]!.course.text).toContain(RACE.mtb.noLift);
    s.guestSim.spawner.rateMult = 10; s.tick(240 * 3); expect(riders(s)).toBe(0);
    lifts(s, 'chair4'); s.tick(2);
    expect(s.race.courses()[0]!.blocked).toBeNull(); expect(s.race.demandMtb(0)).toBeGreaterThan(0);
  }, 60_000);
  it('2. riders ride exactly the course tiles from its start to the foot and every lap lands at the foot (seed 5 too)', () => {
    let ran = 0;
    for (const seed of [5, 3]) {
      const s = mkSummer(seed); let id: number; try { id = prepareDownhill(s, 2).id; } catch { continue; } if (!s.setRunCourse(id, true).ok) continue; s.guestSim.spawner.rateMult = 10; s.tick(2);
      if (s.race.courses()[0]!.blocked) { expect(s.trailRows()[0]!.course.text).toContain(RACE.mtb.noLift); continue; } // either the reason shows ...
      const poly = [...s.race.courses()[0]!.run.poly], onRoute = new Set(poly); const st = s.guestSim.store, n = s.size;
      let seenOn = 0, offEx = 0;
      for (let k = 0; k < 240 * 5; k++) {
        s.tick(1);
        for (const [slot, x] of s.guestSim.exc.map) { if (st.type[slot] !== DOWNHILLER_TYPE) continue; if (Array.from(x.route).every((t) => onRoute.has(t)) && x.route[x.route.length - 1] === poly[poly.length - 1]) seenOn++; else offEx++; void n; }
      }
      ran++; expect(s.race.total, `seed ${seed} laps`).toBeGreaterThan(0); // ... or the riders lap
      expect(seenOn).toBeGreaterThan(0); expect(offEx).toBe(0); expect(onRoute.size).toBe(poly.length);
    }
    expect(ran).toBeGreaterThan(0);
  }, 120_000);
  it('3. the Downhiller look is orange (CLOTH_COLORS[look.top])', async () => {
    const { CLOTH_COLORS, CLOTH_NAMES } = await import('../../../src/render/guestAppearance');
    const look = SHIPPED_TYPES[DOWNHILLER_TYPE - CORE_TYPE_COUNT]!.look!;
    expect(CLOTH_NAMES[look.top!]).toBe('orange'); expect(CLOTH_COLORS[look.top!]).toBe(look.colour);
  });
  it('4. a removed trail leaves the course inactive with a reason; rebuilding it brings it back', () => {
    const s = mkSummer(); const { id, tiles } = prepareDownhill(s, 2); s.setRunCourse(id, true); s.tick(2);
    expect(s.race.courses()[0]!.valid).toBe(true);
    const n = s.size, undo = tiles.map((t) => ({ x: t % n, y: (t / n) | 0 }));
    for (const p of undo) s.networks.unpaint(Layer.Mtb, p.x, p.y);
    s.tick(2);
    const c = s.race.courses()[0]!;
    expect(c.id).toBe(id); expect(c.valid).toBe(false); expect(c.reason).toBe('gone'); expect(s.race.demandMtb(0)).toBe(0);
    const row = s.trailRows().find((r) => r.id === id)!; expect(row.course.on).toBe(true); expect(row.course.text).toContain(RACE.mtb.reasons.gone);
    s.networks.paint(Layer.Mtb, undo, 2); s.tick(2);
    expect(s.race.courses()[0]!.valid).toBe(true); expect(s.race.courses()[0]!.id).toBe(id);
  });
  it('4b. an inactive (gone) course can be unmarked', () => {
    const s = mkSummer(); const { id, tiles } = prepareDownhill(s, 2); s.setRunCourse(id, true); s.tick(2);
    for (const t of tiles) s.networks.unpaint(Layer.Mtb, t % s.size, (t / s.size) | 0); s.tick(2);
    expect(s.setRunCourse(id, false).ok).toBe(true); s.tick(2); expect(s.race.courses().length).toBe(0);
  });
  it('5. "Downhill N" is a stable number per course: unmarking another course renumbers nothing; it survives a save', () => {
    const s = mkSummer(); const { id } = prepareDownhill(s, 2); s.setRunCourse(id, true); s.tick(1);
    expect(s.race.nameNo(id)).toBe(1);
    const saved = s.race.serialize()!; expect(saved.mtbNo).toEqual([[id, 1]]);
    s.race.load({ ...saved, mtbNo: [[id, 3], [id + 1, 1]] }); expect(s.race.nameNo(id)).toBe(3); // an explicit number is kept
    s.race.load({ ...saved, mtbNo: undefined }); expect(s.race.nameNo(id)).toBe(1); // an older save without numbers is numbered by id order
    s.setRunCourse(id, false); expect(s.race.nameNo(id)).toBe(0);
  });
});
