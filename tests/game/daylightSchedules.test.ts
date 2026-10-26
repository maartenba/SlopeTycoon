import { describe, expect, it } from 'vitest';
import { makeResort, TICKS_PER_DAY, fullHash } from './harness';
import { arrivalWindow, dayGuestLeaveHour, autoLiftHours } from '@/sim/Daylight';
import { hourOfDay } from '@/sim/Clock';
import { DAYLIGHT, GAME_MINUTES_PER_TICK, DAYS_PER_YEAR } from '@/config/balance';
import { GState } from '@/sim/guests/Guest';
import { isApres } from '@/sim/Evening';

const WINTER = DAYLIGHT.winterSolsticeDay, SUMMER = DAYLIGHT.summerSolsticeDay;

describe('guest schedules follow the sun', () => {
  for (const [name, day] of [['winter solstice', WINTER], ['summer solstice', SUMMER]] as const) {
    it(`${name}: arrivals only inside [sunrise+1h, sunset-2.5h]; day guests are all heading home by sunset-30min/-1h`, () => {
      const { sim } = makeResort(64, 3, { startDay: day, defaultHours: true });
      sim.game.date.minute = 6 * 60; // from 06:00
      const win = arrivalWindow(sim.game.date.day), leave = dayGuestLeaveHour(sim.game.date.day);
      const rates: Array<[number, number]> = [];
      let sawDayGuestBeforeLeave = false;
      for (let t = 0; t < TICKS_PER_DAY * 0.75; t++) {
        sim.tick(1);
        const h = hourOfDay(sim.game.date);
        rates.push([h, sim.guestSim.spawner.status().rate]);
        if (h > leave - 1 && h < leave - 0.2) { const s = sim.guestSim.store; for (let i = 0; i < s.limit; i++) if (s.alive[i] && !s.overnight[i] && s.state[i] !== GState.Leaving) sawDayGuestBeforeLeave = true; }
        if (h > leave + 0.3 && sim.game.date.day === (day % DAYS_PER_YEAR)) {
          const s = sim.guestSim.store;
          for (let i = 0; i < s.limit; i++) if (s.alive[i] && !s.overnight[i] && !isApres(s.id[i]!, s.type[i]!, day % DAYS_PER_YEAR)) expect([GState.Leaving, GState.Riding, GState.Queueing, GState.Injured]).toContain(s.state[i]);
        }
      }
      const spawning = rates.filter(([, r]) => r > 0).map(([h]) => h);
      expect(spawning.length).toBeGreaterThan(20);
      expect(Math.min(...spawning)).toBeGreaterThanOrEqual(win.from - 1e-9); expect(Math.max(...spawning)).toBeLessThanOrEqual(win.to + GAME_MINUTES_PER_TICK / 60 + 1e-9);
      expect(sawDayGuestBeforeLeave).toBe(true);
    }, 120000);
  }
  it('lifts default to Auto (daylight): open sunrise+45min .. sunset-15min in every season, manual hours stay available', () => {
    const { sim } = makeResort(64, 2, { defaultHours: true });
    const l = sim.lifts.all()[0]!, o = sim.liftOps.ops(l);
    expect(o.daylight).toBe(true);
    for (const day of [WINTER, SUMMER, 30]) {
      const w = autoLiftHours(day);
      sim.game.date.day = day;
      for (const [h, open] of [[w.from - 0.4, false], [w.from + 0.4, true], [(w.from + w.to) / 2, true], [w.to + 0.3, false]] as const) {
        sim.game.date.minute = Math.round(h * 60); sim.liftOps.update(sim.game, sim.game.date.tick + 1);
        expect(o.from, `day ${day} from`).toBeCloseTo(w.from, 1); expect(o.to).toBeCloseTo(w.to, 1);
        expect(l.open && !l.opsClosed, `day ${day} ${h.toFixed(2)}`).toBe(open);
      }
    }
    sim.liftOps.setHours(l.id, 6, 22);
    expect(o.daylight).toBe(false);
    sim.game.date.day = WINTER; sim.game.date.minute = 6.5 * 60; sim.liftOps.update(sim.game, sim.game.date.tick + 1);
    expect(o.from).toBe(6);
    sim.liftOps.setDaylight(l.id, true); expect(o.daylight).toBe(true);
  });
  it('is deterministic: same seed + same season -> same state hash', () => {
    const a = makeResort(64, 5, { startDay: SUMMER }).sim, b = makeResort(64, 5, { startDay: SUMMER }).sim;
    a.tick(TICKS_PER_DAY); b.tick(TICKS_PER_DAY);
    expect(fullHash(a)).toBe(fullHash(b));
  }, 60000);
});
