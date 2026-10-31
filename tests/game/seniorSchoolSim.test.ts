/** Phase 6 Task 29: Senior + School group in the real sim (calendar gates, save / load, determinism). */
import { describe, expect, it } from 'vitest';
import { makeResort } from './harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { applySave, stateHash } from '../../src/game/saveState';
import { CORE_TYPE_COUNT, SHIPPED_TYPES } from '../../src/config/guestTypes';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { weekdayOf } from '../../src/sim/Clock';
import { calendarDayOfMonth, realMonthOfDay } from '../../src/sim/calendar';
import { isHoliday } from '../../src/sim/Pricing';

const SENIOR = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'senior');
const SCHOOL = CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === 'school');

function dayFor(year: number, month: number, wd: (w: number) => boolean, dom: (d: number) => boolean = () => true): number {
  for (let d = 0; d < DAYS_PER_YEAR; d++) if (realMonthOfDay(d) === month && dom(calendarDayOfMonth(d)) && wd(weekdayOf({ year, day: d })) && !isHoliday(d)) return d;
  throw new Error('no day');
}

/** A starter resort on a given day of the real calendar with a (virtual) Ski School and a Café (the spawner's building / flag list), career gate open. */
function resort(wd: (w: number) => boolean, month = 0, dom: (d: number) => boolean = () => true): Sim {
  const { sim } = makeResort(64, 3);
  sim.progression.unlockAll = true;
  sim.game.date.day = dayFor(sim.game.date.year, month, wd, dom);
  sim.game.date.minute = 7 * 60 + 30;
  const flags = sim.guestSim.spawner.flagsFn!;
  sim.guestSim.spawner.flagsFn = () => [...flags(), 'skiSchoolHQ', 'cafe', 'toilets'];
  sim.guestSim.spawner.rateMult = 14;
  return sim;
}
const arrivals = (sim: Sim): { school: number; senior: number; all: number } => {
  const out = { school: 0, senior: 0, all: 0 };
  sim.bus.on('guest:arrived', (e) => { const sl = sim.guestSim.store.slotOf(e.id); if (sl < 0) return; out.all++; const t = sim.guestSim.store.type[sl]!; if (t === SCHOOL) out.school++; else if (t === SENIOR) out.senior++; });
  return out;
};

describe('Senior + School group in a real resort', () => {
  it('school groups come on weekdays (January) and never on a Saturday; seniors come every day', () => {
    const wkday = resort((w) => w === 1);
    const a = arrivals(wkday); wkday.tick(400);
    const sat = resort((w) => w === 5);
    const b = arrivals(sat); sat.tick(400);
    expect(a.all).toBeGreaterThan(30);
    expect(a.school).toBeGreaterThan(8); // at least one class of 9-16
    expect(b.school).toBe(0);
    expect(a.senior + b.senior).toBeGreaterThan(0);
  }, 120_000);

  it('save -> load -> N ticks equals the control (classes in the ski school, seniors in the village)', async () => {
    const sim = resort((w) => w === 2, 11, (d) => d <= 8); // early December, a Wednesday
    sim.tick(45); // about noon: classes have arrived and are at the venue
    const count = (x: Sim, t: number): number => { const st = x.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === t) n++; return n; };
    expect(count(sim, SCHOOL)).toBeGreaterThan(8);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'school'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    restored.progression.unlockAll = true;
    const f = restored.guestSim.spawner.flagsFn!;
    restored.guestSim.spawner.flagsFn = () => [...f(), 'skiSchoolHQ', 'cafe', 'toilets'];
    restored.guestSim.spawner.rateMult = 14;
    applySave(sim, structuredClone(env.modules)); // control: the live sim restored in place
    const differing = (): string[] => { const x = stateHash(sim).parts, y = stateHash(restored).parts; return Object.keys(x).filter((k) => x[k] !== y[k]); };
    expect(differing()).toEqual([]);
    expect(count(restored, SCHOOL)).toBe(count(sim, SCHOOL));
    for (let d = 0; d < 120; d += 40) {
      sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40);
      expect(differing(), `after ${d + 40} ticks`).toEqual([]);
    }
  }, 180_000);
});
