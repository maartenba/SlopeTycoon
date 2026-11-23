import { describe, expect, it } from 'vitest';
import { RACE } from '../../../src/config/race';
import { DOWNHILLER_TYPE, SHIPPED_TYPES, CORE_TYPE_COUNT } from '../../../src/config/guestTypes';
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
