import { describe, expect, it } from 'vitest';
import { DAYLIGHT, EVENING } from '@/config/balance';
import { dayGuestLeaveHour } from '@/sim/Daylight';
import { Economy } from '@/sim/Economy';
import { AttractionSystem } from '@/sim/attractions/AttractionSystem';
import { apresEnd, closeHour, eveningPremium, eveningStart, isApres, sleepHour, venueDemand, venueServing } from '@/sim/Evening';
import { GState, GuestStore, GuestType } from '@/sim/guests/Guest';
import { resetIds, rig, run } from './guests/helpers';
import { starterResort } from './guests/resortFixture';

const WINTER = DAYLIGHT.winterSolsticeDay, SUMMER = DAYLIGHT.summerSolsticeDay; // day of year (180-day calendar: winter solstice 150, summer 60)
const hours = (a: number, b: number, step = 0.5): number[] => { const o: number[] = []; for (let h = a; h <= b + 1e-9; h += step) o.push(h); return o; };

describe('hourly venue demand curve', () => {
  it('winter: après bump after the lifts close, dinner peak 18:30-21:00, quiet at 15:00 and at night', () => {
    const d = (h: number): number => venueDemand('dine', WINTER, h);
    for (const h of hours(18.5, 21)) expect(d(h)).toBeGreaterThanOrEqual(1.55);
    expect(d(16.5)).toBeGreaterThan(d(15.5)); // après-ski bump starts at 16:00
    expect(d(12.5)).toBeLessThan(1.1); // lunch is a normal peak, evening is higher
    expect(d(19)).toBeGreaterThan(d(12.5) * 1.4);
    expect(d(21.5)).toBeLessThan(d(21)); expect(d(22.9)).toBeLessThan(0.3);
    expect(d(7.9)).toBe(0); expect(d(23.1)).toBe(0); // venues are closed outside 08:00-23:00
    const peakHours = hours(8, 23).filter((h) => d(h) >= 1.0);
    expect(Math.min(...peakHours.filter((h) => h > 15))).toBeCloseTo(16, 1);
    expect(Math.max(...peakHours)).toBeLessThanOrEqual(21.5);
  });
  it('summer: lunch peak at 12:00 and an evening terrace peak 18:30-22:00', () => {
    const d = (h: number): number => venueDemand('dine', SUMMER, h);
    expect(d(12)).toBeGreaterThanOrEqual(1.45);
    expect(d(12)).toBeGreaterThan(d(14.5)); expect(d(15)).toBeLessThan(0.6);
    for (const h of hours(18.5, 22)) expect(d(h)).toBeGreaterThanOrEqual(1.35);
    expect(venueDemand('terrace', SUMMER, 20)).toBeGreaterThan(1.3);
  });
  it('the bar is an evening venue: winter evenings beat noon by a wide margin, in both seasons', () => {
    expect(venueDemand('bar', WINTER, 19)).toBeGreaterThan(venueDemand('bar', WINTER, 12) * 4);
    expect(venueDemand('bar', SUMMER, 20)).toBeGreaterThan(venueDemand('bar', SUMMER, 12) * 3);
    expect(venueDemand('bar', WINTER, 7)).toBe(0);
  });
  it('is smooth across the year (blend by day length) and deterministic', () => {
    let prev = venueDemand('dine', WINTER, 12);
    for (let day = WINTER + 1; day < WINTER + 90; day += 5) { const v = venueDemand('dine', day, 12); expect(Math.abs(v - prev)).toBeLessThan(0.2); prev = v; }
    expect(venueDemand('bar', 17, 19)).toBe(venueDemand('bar', 17, 19));
  });
  it('opening, bedtime and evening-start hours follow the season', () => {
    expect(closeHour(WINTER)).toBeCloseTo(23, 1); expect(closeHour(SUMMER)).toBeCloseTo(22.5, 1);
    expect(sleepHour(WINTER)).toBeCloseTo(22.5, 1); expect(sleepHour(SUMMER)).toBeCloseTo(23, 1);
    expect(eveningStart(WINTER)).toBeCloseTo(16, 1); expect(eveningStart(SUMMER)).toBeCloseTo(18.5, 1);
    expect(venueServing(WINTER, 22.9)).toBe(true); expect(venueServing(WINTER, 23.1)).toBe(false); expect(venueServing(SUMMER, 22.6)).toBe(false); expect(venueServing(WINTER, 7.9)).toBe(false);
    expect(eveningPremium(12)).toBe(1); expect(eveningPremium(19)).toBeCloseTo(1 + EVENING.premium, 5);
  });
});

describe('après-ski share of day guests', () => {
  const share = (type: number, day: number): number => { let n = 0; for (let id = 1; id <= 4000; id++) if (isApres(id, type, day)) n++; return n / 4000; };
  it('is 20-35 % in winter, depends on the guest type, and is smaller in summer', () => {
    for (const t of [GuestType.Solo, GuestType.Couple, GuestType.Family, GuestType.VIP, GuestType.Budget, GuestType.Adventure]) {
      expect(share(t, WINTER), `type ${t}`).toBeGreaterThanOrEqual(0.19); expect(share(t, WINTER), `type ${t}`).toBeLessThanOrEqual(0.36);
    }
    expect(share(GuestType.Couple, WINTER)).toBeGreaterThan(share(GuestType.Budget, WINTER));
    expect(share(GuestType.Solo, SUMMER)).toBeLessThan(share(GuestType.Solo, WINTER) * 0.6);
  });
  it('is a pure function of (id, type, day) and leaves between 19:00 and 20:00 in winter', () => {
    expect(isApres(77, 1, WINTER)).toBe(isApres(77, 1, WINTER));
    for (let id = 1; id < 200; id++) { const e = apresEnd(id, WINTER); expect(e).toBeGreaterThanOrEqual(19); expect(e).toBeLessThan(20.01); }
  });
});

function resort(extra: string[]) {
  resetIds();
  const f = starterResort(64);
  const street = Math.floor(64 * 0.78) + 2;
  extra.forEach((t, i) => f.addBuildingOnStreet(t, 8 + i * 6, street));
  const r = rig(f.guestWorld({ roadEntry: null, railEntry: null }), 42, 64);
  r.sim.spawner.rateMult = 0; // no new arrivals: only the guests we place
  const econ = new Economy({ money: 0 });
  const sys = new AttractionSystem({ buildings: () => r.world.buildings(), store: r.sim.store, hash: r.sim.hash, status: () => undefined, earn: (c, a) => econ.earn(c, a), bus: r.bus, groundAt: r.world.groundAt });
  r.reg.replace(sys.asSystem());
  r.sim.setAttractions(sys);
  return { r, sys, econ, street };
}
type R = ReturnType<typeof resort>;
function crowd(r: R['r'], n: number, x: number, y: number, o: { overnight?: boolean; type?: number } = {}): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = r.sim.store.add({ x: x + (k % 5) * 0.3, y: y + 0.5, z: 0, type: o.type ?? GuestType.Couple, skill: 1, budget: 800, group: 0, mode: 0, overnight: !!o.overnight, leaveDay: 9999, tick: 0, hunger: 0.1 });
    r.sim.hash.insert(i, r.sim.store.x[i]!, r.sim.store.y[i]!);
    r.sim.store.state[i] = GState.Idle; r.sim.store.timer[i] = 0;
    ids.push(r.sim.store.id[i]!);
  }
  return ids;
}
const at = (r: R['r'], hour: number): void => { r.state.date.minute = Math.round(hour * 60); };
const venueServed = (sys: AttractionSystem): number => sys.all().filter((a) => a.spec.eveningShift).reduce((n, a) => n + a.stats.served, 0);

describe('evening behaviour in the guest sim', () => {
  it('overnight guests are active after dark: they walk to venues, dine and have a drink instead of sitting idle', () => {
    const w = resort(['lodge', 'apresBar', 'chalet']);
    const ids = crowd(w.r, 30, 30, w.street - 1, { overnight: true });
    at(w.r, 17.0); // after sunset in mid-winter
    run(w.r, 40); // until ~21:00: the evening is active until bedtime
    expect(venueServed(w.sys)).toBeGreaterThan(8);
    const bar = w.sys.all().find((a) => a.b.type === 'apresBar')!;
    expect(bar.stats.served + w.sys.all().find((a) => a.b.type === 'lodge')!.stats.served).toBeGreaterThan(8);
    const st = w.r.sim.store;
    expect(ids.some((id) => st.slotOf(id) >= 0 && st.eve[st.slotOf(id)]! >= 1)).toBe(true);
    expect(w.econ.ledger.bars + w.econ.ledger.restaurants).toBeGreaterThan(50);
  });
  it('overnight guests go to sleep at bedtime (22:30) and wake up in the morning; none leave at dusk', () => {
    const w = resort(['lodge', 'apresBar', 'chalet']);
    const ids = crowd(w.r, 20, 30, w.street - 1, { overnight: true });
    at(w.r, 21.0);
    run(w.r, 12); // 22:12
    const st = w.r.sim.store;
    expect(ids.filter((id) => st.slotOf(id) >= 0 && st.state[st.slotOf(id)] === GState.Sleeping).length).toBe(0);
    run(w.r, 10); // 23:12
    const asleep = ids.filter((id) => st.slotOf(id) >= 0 && (st.state[st.slotOf(id)] === GState.Sleeping || st.state[st.slotOf(id)] === GState.Using)).length;
    expect(asleep).toBeGreaterThan(ids.length * 0.8);
    expect(w.r.left.filter((l) => ids.includes(l.id))).toHaveLength(0);
  });
  it('day guests leave at sunset-30min except the après share, who stay for a drink and go home by ~20:00', () => {
    const w = resort(['lodge', 'apresBar']);
    const ids = crowd(w.r, 60, 30, w.street - 1, { type: GuestType.Couple });
    const day = 10, apres = ids.filter((id) => isApres(id, GuestType.Couple, day)), others = ids.filter((id) => !apres.includes(id));
    expect(apres.length).toBeGreaterThan(8); expect(others.length).toBeGreaterThan(8);
    const leave = dayGuestLeaveHour(day);
    at(w.r, leave - 0.3);
    run(w.r, 6); // ~ leave hour + 0.3
    const st = w.r.sim.store;
    const gone = (id: number): boolean => st.slotOf(id) < 0 || st.state[st.slotOf(id)] === GState.Leaving;
    expect(others.filter(gone).length).toBeGreaterThan(others.length * 0.75);
    expect(apres.filter((id) => !gone(id)).length).toBeGreaterThan(apres.length * 0.6); // still around
    at(w.r, 20.3); run(w.r, 4); // after the après end (19:00-20:00)
    expect(apres.filter((id) => st.slotOf(id) >= 0 && st.state[st.slotOf(id)] !== GState.Leaving && st.state[st.slotOf(id)] !== GState.Using).length).toBe(0);
    expect(w.r.left.filter((l) => apres.includes(l.id)).length).toBeGreaterThan(0);
  });
  it('the bar earns much more on a winter evening than at noon (it only serves the après / evening crowd)', () => {
    const earn = (hour: number): number => {
      const w = resort(['apresBar', 'lodge']);
      crowd(w.r, 40, 30, w.street - 1, { overnight: true });
      at(w.r, hour); run(w.r, 20);
      return w.sys.all().find((a) => a.b.type === 'apresBar')!.stats.revenue;
    };
    const noon = earn(11.5), evening = earn(17.5);
    expect(evening).toBeGreaterThan(noon + 40);
    expect(evening).toBeGreaterThan(noon * 3);
  });
  it('venues charge the evening premium after 17:00 and record revenue by hour (busiest hour)', () => {
    const w = resort(['apresBar']);
    const bar = (): ReturnType<AttractionSystem['all']>[number] => w.sys.all().find((a) => a.b.type === 'apresBar')!;
    at(w.r, 12); run(w.r, 1);
    const noonPrice = bar().unitPrice();
    at(w.r, 19); run(w.r, 1);
    expect(bar().unitPrice()).toBeCloseTo(noonPrice * (1 + EVENING.premium), 1);
    crowd(w.r, 30, 30, w.street - 1, { overnight: true }); run(w.r, 20);
    const info = bar().info();
    expect(info.busiestHour).not.toBeNull();
    expect(info.busiestHour!.hour).toBeGreaterThanOrEqual(19);
  });
  it('venues are closed outside serving hours without emitting closed events', () => {
    const w = resort(['apresBar']);
    const events: string[] = [];
    w.r.bus.on('attraction:closed', (e) => events.push(e.reason));
    at(w.r, 23.3); run(w.r, 3);
    expect(w.sys.serving(w.sys.all()[0]!.id)).toBe(false);
    expect(events).toHaveLength(0);
    at(w.r, 9); run(w.r, 3);
    expect(w.sys.serving(w.sys.all()[0]!.id)).toBe(true);
  });
  it('is deterministic and the evening flag survives a store save/load', () => {
    const once = (): string => {
      const w = resort(['lodge', 'apresBar']);
      crowd(w.r, 30, 30, w.street - 1, { overnight: true }); crowd(w.r, 30, 34, w.street - 1);
      at(w.r, 16.2); run(w.r, 60);
      return `${w.r.sim.store.hash()}|${w.sys.all().map((a) => `${a.stats.served}:${a.stats.revenue}`).join(',')}`;
    };
    expect(once()).toBe(once());
    const w = resort(['lodge', 'apresBar']);
    crowd(w.r, 10, 30, w.street - 1, { overnight: true });
    at(w.r, 17); run(w.r, 30);
    const s = w.r.sim.store, snap = JSON.parse(JSON.stringify(s.serialize())) as ReturnType<GuestStore['serialize']>;
    const copy = new GuestStore(s.capacity); copy.load(snap);
    expect(Array.from(copy.eve.subarray(0, 10))).toEqual(Array.from(s.eve.subarray(0, 10)));
    expect(copy.hash()).toBe(s.hash());
  });
  it('keeps the night crowd bounded: at most +30 % of the daytime guests are active after dark', () => {
    const w = resort(['lodge', 'apresBar', 'chalet']);
    const day = crowd(w.r, 60, 30, w.street - 1, { type: GuestType.Solo }).length + crowd(w.r, 20, 34, w.street - 1, { overnight: true }).length;
    at(w.r, 16.0); run(w.r, 40); // ~20:00
    const st = w.r.sim.store; let active = 0;
    for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.state[i] !== GState.Leaving && st.state[i] !== GState.Sleeping) active++;
    expect(active).toBeLessThanOrEqual(day * 0.6 + 20 + day * 0.3);
  });
});
