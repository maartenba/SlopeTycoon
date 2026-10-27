import { describe, expect, it } from 'vitest';
import { createGameState } from '@/core/GameState';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { LIFT_SERVICE } from '@/config/liftOps';
import { DAYS_PER_YEAR, GAME_MINUTES_PER_TICK, MINUTES_PER_DAY } from '@/config/balance';
import { simDayOf, SIM_MONTHS } from '@/sim/calendar';
import type { LiftData } from '@/sim/Lift';
import { LiftOps, liftOpenForBusiness, type LiftOpsDeps } from '@/sim/ops/LiftOps';

const TPD = MINUTES_PER_DAY / GAME_MINUTES_PER_TICK;
const APRIL = simDayOf(3, 1); // sim day 0

function mkLift(id: number, kind: LiftData['kind'] = 'chair4'): LiftData {
  const nodes = [{ x: 10, y: 3, z: 10 }, { x: 50, y: 15, z: 10 }];
  return { id, kind, bottom: { x: 9, y: 9, ground: 2 }, top: { x: 49, y: 9, ground: 14 }, towers: [], nodes, tiles: [], open: true, speed: 1, cost: 100000 };
}

function rig(o: { kinds?: LiftData['kind'][]; workshop?: boolean; factor?: { time: number; cost: number } } = {}) {
  const state = createGameState(1, 64, 1e6);
  const bus = new EventBus<GameEvents>();
  const ev: { soon: GameEvents['ops:serviceSoon'][]; started: GameEvents['lift:serviceStarted'][]; done: GameEvents['lift:serviced'][]; late: GameEvents['lift:serviceOverdue'][]; broken: number } = { soon: [], started: [], done: [], late: [], broken: 0 };
  bus.on('ops:serviceSoon', (e) => ev.soon.push(e)); bus.on('lift:serviceStarted', (e) => ev.started.push(e)); bus.on('lift:serviced', (e) => ev.done.push(e)); bus.on('lift:serviceOverdue', (e) => ev.late.push(e)); bus.on('lift:broken', () => ev.broken++);
  const lifts = (o.kinds ?? ['chair4']).map((k, i) => mkLift(i + 1, k));
  const riders = new Map<number, number>(), spent: number[] = [], workshop = { on: o.workshop ?? true }, factor = { v: o.factor ?? { time: 1, cost: 1 } };
  const deps: LiftOpsDeps = {
    lifts: () => lifts, bus, seed: 5, weather: () => ({ kind: 'clear', intensity: 0.5 }), temperature: () => -2, hasWorkshop: () => workshop.on,
    queues: { ridersOn: (id) => riders.get(id) ?? 0, queueLength: () => 0 }, spend: (a) => { spent.push(a); }, serviceFactor: () => factor.v,
    today: () => state.date.year * DAYS_PER_YEAR + state.date.day,
  };
  const ops = new LiftOps(deps);
  let tick = 0;
  const r = {
    state, ops, lifts, ev, riders, spent, workshop, factor,
    abs: () => state.date.year * DAYS_PER_YEAR + state.date.day,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        tick++; state.date.minute += GAME_MINUTES_PER_TICK;
        while (state.date.minute >= MINUTES_PER_DAY) { state.date.minute -= MINUTES_PER_DAY; state.date.day++; }
        if (state.date.day >= DAYS_PER_YEAR) { state.date.day = 0; state.date.year++; }
        ops.update(state, tick);
      }
    },
    setTime(day: number, hour: number, year = 1) { state.date.year = year; state.date.day = day; state.date.minute = Math.round(hour * 60); },
    /** Pretend the lift was last serviced `ago` days ago. */
    lastServiced(l: LiftData, ago: number, count = 1, level: 'basic' | 'thorough' = 'basic') { const o = ops.ops(l); o.maint = { last: r.abs() - ago, count, level: count ? level : undefined }; },
  };
  return r;
}

describe('maintenance windows', () => {
  it('Auto: winter lifts service in April, summer-only lifts in October; a chosen month wins', () => {
    const r = rig({ kinds: ['chair4', 'chair4'] });
    const [w, s] = r.lifts as [LiftData, LiftData];
    r.ops.ops(s).seasons = { winter: false, shoulder: false, summer: true };
    expect(r.ops.windowMonth(w)).toBe(3); expect(r.ops.windowMonth(s)).toBe(9);
    expect(SIM_MONTHS[0]).toBe('April');
    r.ops.setServiceWindow(w.id, 10);
    expect(r.ops.windowMonth(w)).toBe(10);
    r.ops.scheduleAll(3);
    expect(r.ops.windowMonth(s)).toBe(3);
    r.ops.scheduleAll('auto');
    expect(r.ops.windowMonth(s)).toBe(9);
  });
  it('next service date: the first day of the window, never within the minimum gap of the last service', () => {
    const r = rig(); const l = r.lifts[0]!;
    r.setTime(100, 12); r.step(); // mid-year, well after April
    r.lastServiced(l, 100);
    expect(r.ops.nextServiceDay(l)).toBe(2 * DAYS_PER_YEAR + APRIL); // next April = year 2 day 0
    r.setTime(179, 12); r.lastServiced(l, 30); // serviced a month ago: April 1 is tomorrow and the gap rule (20 d) is met
    expect(r.ops.nextServiceDay(l)).toBe(2 * DAYS_PER_YEAR + APRIL);
    r.lastServiced(l, 0); // serviced today by hand: this April is skipped
    expect(r.ops.nextServiceDay(l)).toBe(3 * DAYS_PER_YEAR + APRIL);
    r.lastServiced(l, 30, 0); // only commissioned 30 days ago: wait for the 60-day minimum
    expect(r.ops.nextServiceDay(l)).toBe(3 * DAYS_PER_YEAR + APRIL);
    r.lastServiced(l, 61, 0); expect(r.ops.nextServiceDay(l)).toBe(2 * DAYS_PER_YEAR + APRIL);
    r.ops.setPolicy('manual');
    expect(r.ops.nextServiceDay(l)).toBeNull();
  });
});

describe('planned service', () => {
  it('closes an empty lift in its window, bills maintenance, restores condition, resets the clock and reopens', () => {
    const r = rig(); const l = r.lifts[0]!, o = r.ops.ops(l);
    r.ops.setHours(1, 8, 17);
    r.setTime(179, 22, 0); r.step(); r.lastServiced(l, 200, 0); o.condition = 40; o.ageDays = 400;
    r.setTime(0, 21, 1); r.step();
    expect(o.fault?.kind).toBe('service');
    expect(l.open).toBe(false); expect(l.opsReason).toBe('service');
    expect(liftOpenForBusiness(l)).toBe(true); // planned and announced: not a rating penalty
    const plan = r.ops.servicePlan(l, 'basic');
    expect(r.spent.filter((x) => Math.abs(x - plan.cost) < 1e-6).length).toBe(1); // one booking of the service (plus the daily routine upkeep)
    expect(r.ev.started[0]).toMatchObject({ id: 1, days: plan.days });
    r.step(plan.days * TPD - 3); expect(o.fault?.kind).toBe('service');
    r.step(8);
    expect(o.fault).toBeNull();
    expect(o.condition).toBeGreaterThanOrEqual(LIFT_SERVICE.basic.condition);
    expect(o.ageDays).toBeLessThan(400 * 0.9); // age risk partly cleared
    expect(o.maint).toMatchObject({ count: 1, level: 'basic' }); expect(r.ev.done.length).toBe(1);
    expect(r.ops.serviceStatus(l).state).toBe('ok');
    expect(r.ops.nextServiceDay(l)).toBeGreaterThan(r.abs() + 150);
  });
  it('lasts 2-3 days for basic and 5-7 for thorough; scales with condition; workshop and staff cut length and cost', () => {
    const r = rig(); const l = r.lifts[0]!, o = r.ops.ops(l);
    r.setTime(100, 12); r.step();
    o.condition = 100; const b = r.ops.servicePlan(l, 'basic'), t = r.ops.servicePlan(l, 'thorough');
    expect(b.days).toBeGreaterThanOrEqual(2); expect(b.days).toBeLessThanOrEqual(3);
    expect(t.days).toBeGreaterThanOrEqual(5); expect(t.days).toBeLessThanOrEqual(7);
    expect(t.cost).toBeGreaterThan(b.cost);
    o.condition = 30; expect(r.ops.servicePlan(l, 'basic').days).toBeGreaterThanOrEqual(b.days);
    o.condition = 100;
    r.workshop.on = false; const noWs = r.ops.servicePlan(l, 'basic');
    expect(noWs.cost).toBeGreaterThan(b.cost * 2); expect(noWs.days).toBeGreaterThanOrEqual(b.days);
    r.workshop.on = true; r.factor.v = { time: 0.6, cost: 0.55 };
    const crew = r.ops.servicePlan(l, 'thorough');
    expect(crew.cost).toBeLessThan(t.cost * 0.6); expect(crew.days).toBeLessThan(t.days);
  });
  it('a thorough inspection level means thorough service', () => {
    const r = rig(); const l = r.lifts[0]!; r.setTime(100, 12); r.step();
    r.ops.setInspection(1, 'thorough'); expect(r.ops.servicePlan(l).level).toBe('thorough');
    r.ops.setInspection(1, 'basic'); expect(r.ops.servicePlan(l).level).toBe('basic');
  });
  it('never strands guests: nothing starts with riders on the line; Service now refuses; it starts once the line is empty', () => {
    const r = rig(); const l = r.lifts[0]!;
    r.setTime(179, 22, 0); r.step(); r.lastServiced(l, 200, 0);
    r.setTime(0, 11, 1); r.riders.set(1, 4); r.step(20);
    expect(l.ops!.fault).toBeNull(); expect(r.ops.serviceNow(1)).toBe(false); expect(r.ops.canServiceNow(1)).toBe(false);
    r.riders.set(1, 0); r.step(1);
    expect(l.ops!.fault?.kind).toBe('service'); expect(l.ops!.fault?.stranded).toBe(0);
    expect(r.ev.broken).toBe(0);
  });
  it('Service now works outside any window, not while broken', () => {
    const r = rig(); const l = r.lifts[0]!; r.setTime(100, 12); r.step();
    expect(r.ops.serviceNow(1)).toBe(true); expect(l.ops!.fault?.kind).toBe('service');
    expect(r.ops.serviceNow(1)).toBe(false); // already in service
    const r2 = rig(); r2.setTime(100, 12); r2.step(); r2.ops.forceBreakdown(1);
    expect(r2.ops.serviceNow(1)).toBe(false);
  });
  it('is announced the day before, once per window', () => {
    const r = rig(); const l = r.lifts[0]!;
    r.setTime(177, 12, 1); r.step(); r.lastServiced(l, 100);
    r.setTime(178, 23.95, 1); r.step(); // crosses into day 179 = the day before April 1
    expect(r.ev.soon.length).toBe(1);
    expect(r.ev.soon[0]).toMatchObject({ count: 1, month: 3 });
    r.step(TPD); expect(r.ev.soon.length).toBe(1);
  });
});

describe('risk, overdue and policy', () => {
  it('a fresh service lowers the breakdown rate, overdue raises it, escalating and capped', () => {
    const r = rig(); const l = r.lifts[0]!, o = r.ops.ops(l);
    r.setTime(100, 12); r.step(); o.condition = 100;
    r.lastServiced(l, 150, 0); const none = r.ops.breakdownPerHour(l);
    r.lastServiced(l, 0, 1, 'basic'); const fresh = r.ops.breakdownPerHour(l);
    r.lastServiced(l, 0, 1, 'thorough'); const fresherT = r.ops.breakdownPerHour(l);
    expect(fresh).toBeLessThan(none); expect(fresherT).toBeLessThan(fresh);
    const rates = [181, 220, 270, 330, 450].map((d) => { r.lastServiced(l, d, 0); return r.ops.breakdownPerHour(l); });
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]!);
    expect(rates[0]!).toBeGreaterThan(none * 0.99);
    expect(rates[3]!).toBeGreaterThan(none * 2);
    expect(rates[4]!).toBeLessThan(none * 5);
    r.lastServiced(l, 160, 0);
    const st = r.ops.serviceStatus(l);
    expect(st.state).toBe('due'); expect(st.skipRiskMult).toBeGreaterThan(1.3);
    r.lastServiced(l, 200, 0); expect(r.ops.serviceStatus(l).state).toBe('overdue');
    r.lastServiced(l, 300, 0); expect(r.ops.serviceStatus(l).state).toBe('critical');
  });
  it('overdue and critical are announced once each', () => {
    const r = rig(); const l = r.lifts[0]!;
    r.setTime(100, 12); r.step(); r.ops.setPolicy('manual'); r.lastServiced(l, 179, 0);
    r.step(TPD * 3); expect(r.ev.late.map((e) => e.level)).toEqual(['overdue']);
    r.step(TPD * 100); r.step(TPD * 2); expect(r.ev.late.map((e) => e.level)).toEqual(['overdue', 'critical']);
    r.step(TPD); expect(r.ev.late.length).toBe(2);
  });
  it('Manual policy never starts a service by itself but the overdue risk still builds', () => {
    const r = rig(); const l = r.lifts[0]!;
    r.ops.setPolicy('manual');
    r.setTime(179, 22, 0); r.step(); r.lastServiced(l, 200, 0);
    r.setTime(0, 21, 1); r.step(TPD * 3);
    expect(l.ops!.fault).toBeNull(); expect(r.ev.started.length).toBe(0); expect(r.ops.serviceStatus(l).state).toBe('overdue');
    expect(r.ops.serviceNow(1)).toBe(true);
  });
  it('policy and the maintenance data survive serialize / load', () => {
    const r = rig(); r.ops.setPolicy('manual');
    const copy = rig(); copy.ops.load(JSON.parse(JSON.stringify(r.ops.serialize())));
    expect(copy.ops.getPolicy()).toBe('manual');
    const auto = rig(); auto.ops.load(JSON.parse(JSON.stringify(auto.ops.serialize())));
    expect(auto.ops.getPolicy()).toBe('auto');
    expect(Object.keys(auto.ops.serialize() as object)).not.toContain('policy'); // the default adds nothing to the save
  });
  it('projects the spend of the next 30 days', () => {
    const r = rig({ kinds: ['chair4', 'chair4'] });
    r.setTime(160, 12); r.step(); for (const l of r.lifts) r.lastServiced(l, 120);
    const p = r.ops.projectedServiceCost(30);
    expect(p.count).toBe(2); expect(p.cost).toBeCloseTo(r.ops.servicePlan(r.lifts[0]!).cost * 2, 6);
    expect(r.ops.projectedServiceCost(5).count).toBe(0);
  });
});
