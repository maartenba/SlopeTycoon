import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '@/core/GameState';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { LIFT_OPS } from '@/config/liftOps';
import { LIFTS } from '@/config/lifts';
import { DAYS_PER_YEAR, GAME_MINUTES_PER_TICK, MINUTES_PER_DAY } from '@/config/balance';
import { computeStats, upkeepPerDay, type LiftData } from '@/sim/Lift';
import { LiftOps, defaultOps, inHours, liftOpenForBusiness, type LiftOpsDeps } from '@/sim/ops/LiftOps';
import { Incidents, type Incident } from '@/sim/ops/Incidents';
import { Coverage } from '@/sim/Coverage';

const TPD = MINUTES_PER_DAY / GAME_MINUTES_PER_TICK;

function mkLift(id: number, kind: LiftData['kind'] = 'chair4'): LiftData {
  const nodes = [{ x: 10, y: 3, z: 10 }, { x: 50, y: 15, z: 10 }];
  return { id, kind, bottom: { x: 9, y: 9, ground: 2 }, top: { x: 49, y: 9, ground: 14 }, towers: [], nodes, tiles: [], open: true, speed: 1, cost: 100000 };
}

interface Rig {
  state: GameState; ops: LiftOps; lifts: LiftData[]; ev: Record<string, unknown[]>; tick: number;
  riders: Map<number, number>; spent: number[];
  /** Incident responder simulation: resolves stranded incidents after `rescueTicks` when a patrol exists. */
  incidents: Incidents; patrol: { on: boolean; ticks: number };
  workshop: { on: boolean };
  step(n?: number): void;
  setTime(day: number, hour: number): void;
}

function rig(o: { kinds?: LiftData['kind'][]; weather?: string; temp?: number; workshop?: boolean; patrol?: boolean; patrolTicks?: number; seed?: number } = {}): Rig {
  const state = createGameState(1, 64, 1e6);
  const bus = new EventBus<GameEvents>();
  const ev: Record<string, unknown[]> = {};
  for (const k of ['lift:broken', 'lift:repaired', 'incident:stranded', 'ops:schedule'] as const) bus.on(k, (e) => (ev[k] ??= []).push(e));
  const lifts = (o.kinds ?? ['chair4']).map((k, i) => mkLift(i + 1, k));
  const riders = new Map<number, number>();
  const incidents = new Incidents({ guests: { position: () => null, near: () => [], freeze: () => true, release: () => undefined, hurtNear: () => undefined }, coverage: new Coverage(64), buildings: () => [], bus, seed: 3 });
  const spent: number[] = [];
  const patrol = { on: o.patrol ?? true, ticks: o.patrolTicks ?? 4 };
  const workshop = { on: o.workshop ?? false };
  const weather = { kind: o.weather ?? 'clear', intensity: 0.5 };
  const deps: LiftOpsDeps = {
    lifts: () => lifts, bus, seed: o.seed ?? 5,
    weather: () => weather, temperature: () => o.temp ?? -2, hasWorkshop: () => workshop.on,
    queues: { ridersOn: (id) => riders.get(id) ?? 0, queueLength: () => 0 },
    incidents, spend: (a) => { spent.push(a); },
  };
  const ops = new LiftOps(deps);
  const r: Rig = {
    state, ops, lifts, ev, tick: 0, riders, spent, incidents, patrol, workshop,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        r.tick++;
        state.date.minute += GAME_MINUTES_PER_TICK;
        while (state.date.minute >= MINUTES_PER_DAY) { state.date.minute -= MINUTES_PER_DAY; state.date.day++; }
        if (state.date.day >= DAYS_PER_YEAR) { state.date.day = 0; state.date.year++; }
        // fake patrol: resolves stranded incidents `ticks` after creation
        if (patrol.on) for (const inc of [...incidents.open]) if (inc.kind === 'stranded' && r.tick - inc.createdTick >= patrol.ticks) incidents.resolve(inc, 'recovered', 'none');
        incidents.update(r.tick);
        ops.update(state, r.tick);
      }
    },
    setTime(day, hour) { state.date.day = day; state.date.minute = Math.round(hour * 60); },
  };
  return r;
}

describe('LiftOps schedule', () => {
  it('inHours handles normal and wrapping windows', () => {
    expect(inHours(9, 8.5, 16.5)).toBe(true);
    expect(inHours(8, 8.5, 16.5)).toBe(false);
    expect(inHours(16.5, 8.5, 16.5)).toBe(false);
    expect(inHours(23, 22, 6)).toBe(true);
    expect(inHours(3, 22, 6)).toBe(true);
    expect(inHours(12, 22, 6)).toBe(false);
  });
  it('manual hours: auto mode opens 08:30-17:00 and closes outside; "hours" closures still count as open for business', () => {
    const r = rig();
    r.ops.setHours(1, 8.5, 17); // new lifts default to Auto (daylight); manual hours switch that off
    r.setTime(10, 8); r.step();
    expect(r.lifts[0]!.open).toBe(false);
    expect(r.lifts[0]!.opsReason).toBe('hours');
    expect(liftOpenForBusiness(r.lifts[0]!)).toBe(true);
    r.step(6); // 08:36..
    expect(r.lifts[0]!.open).toBe(true);
    r.setTime(10, 17.1); r.step(2);
    expect(r.lifts[0]!.open).toBe(false);
  });
  it('configurable hours and manual modes', () => {
    const r = rig();
    r.ops.setHours(1, 6, 22); r.setTime(10, 7); r.step();
    expect(r.lifts[0]!.open).toBe(true);
    r.ops.setMode(1, 'closed'); r.step();
    expect(r.lifts[0]!.open).toBe(false);
    expect(r.lifts[0]!.opsReason).toBe('manual');
    r.setTime(10, 3); r.ops.setMode(1, 'open'); r.step();
    expect(r.lifts[0]!.open).toBe(true); // manual open ignores the schedule
    r.ops.setMode(1, 'auto'); r.step();
    expect(r.lifts[0]!.open).toBe(false);
  });
  it('summer profile closes non-bike lifts by default; keepOnly + one aggregated news event', () => {
    expect(defaultOps('tbar').seasons.summer).toBe(false);
    expect(defaultOps('chair4').seasons.summer).toBe(true);
    const r = rig({ kinds: ['tbar', 'chair4', 'gondola6', 'chair2'] });
    r.setTime(150, 12); r.step(); // winter noon
    expect(r.lifts.every((l) => l.open)).toBe(true);
    r.setTime(60, 12); r.step(); // summer noon: a new day triggers the profile switch
    expect(r.lifts.map((l) => l.open)).toEqual([false, true, true, true]);
    expect(r.lifts[0]!.opsReason).toBe('season');
    expect(r.ev['ops:schedule']).toEqual([{ profile: 'summer', operating: 3, total: 4 }]);
    r.ops.keepOnly('summer', new Set([2])); r.step();
    expect(r.lifts.map((l) => l.open)).toEqual([false, true, false, false]);
    expect(r.ev['ops:schedule']!.at(-1)).toEqual({ profile: 'summer', operating: 1, total: 4 });
  });
});

describe('LiftOps energy & upkeep', () => {
  const day = (r: Rig): { upkeep: number; energy: number } => { r.step(TPD); return r.ops.settleDay(); };
  it('closed lifts use no energy and only 15% upkeep; running lifts pay energy; projections drop when lifts are off', () => {
    const run = (mode: 'auto' | 'closed') => { const r = rig(); r.setTime(10, 0); r.ops.setMode(1, mode); r.ops.settleDay(); return { r, c: day(r) }; };
    const open = run('auto'), shut = run('closed');
    expect(shut.c.energy).toBe(0);
    expect(shut.c.upkeep).toBeCloseTo(upkeepPerDay(shut.r.lifts[0]!) * LIFT_OPS.closedUpkeepShare, 6);
    expect(open.c.energy).toBeGreaterThan(0);
    expect(open.c.upkeep).toBeGreaterThan(shut.c.upkeep * 2);
    const r = rig({ kinds: ['chair4', 'chair4', 'chair4'] });
    const winter = r.ops.projectedDailyEnergy('winter');
    r.ops.keepOnly('summer', new Set([1]));
    expect(r.ops.projectedDailyEnergy('summer')).toBeCloseTo(winter / 3, 6);
  });
  it('eco mode halves speed while nobody queues and cuts energy', () => {
    const a = rig(), b = rig();
    b.ops.setEco(1, true);
    a.setTime(10, 9); b.setTime(10, 9); a.step(); b.step();
    expect(b.lifts[0]!.ecoActive).toBe(true);
    expect(computeStats('chair4', b.lifts[0]!.nodes, 0.5).throughputPerHour).toBeLessThan(computeStats('chair4', a.lifts[0]!.nodes, 1).throughputPerHour);
    a.step(40); b.step(40);
    expect(b.ops.settleDay().energy).toBeLessThan(a.ops.settleDay().energy);
  });
  it('bigger variants cost more energy per hour', () => {
    const r = rig({ kinds: ['chair2', 'chair8b', 'gondola10'] });
    const e = r.lifts.map((l) => r.ops.energyPerHour(l));
    expect(e[0]!).toBeLessThan(e[1]!); expect(e[1]!).toBeLessThan(e[2]!);
  });
});

describe('LiftOps wear, breakdowns, repairs', () => {
  it('wear grows with operating hours and weather; routine maintenance and workshop restore it', () => {
    const calm = rig(), storm = rig({ weather: 'storm' });
    for (const r of [calm, storm]) { r.ops.setMode(1, 'open'); r.ops.ops(r.lifts[0]!).condition = 100; }
    // storm closes a chairlift (wind) so use a tolerant lift for the storm run
    const st = rig({ weather: 'storm', kinds: ['funicular'] }); st.ops.setMode(1, 'open');
    calm.setTime(5, 9); st.setTime(5, 9);
    calm.step(30); st.step(30);
    const cc = calm.ops.ops(calm.lifts[0]!).condition;
    expect(cc).toBeLessThan(100);
    expect(st.ops.ops(st.lifts[0]!).condition / 1).toBeLessThan(100);
    const w = rig({ workshop: true }), nw = rig({ workshop: false });
    for (const r of [w, nw]) { r.ops.ops(r.lifts[0]!).condition = 50; r.ops.setMode(1, 'closed'); r.setTime(5, 1); r.step(TPD * 5); }
    expect(w.ops.ops(w.lifts[0]!).condition).toBeGreaterThan(nw.ops.ops(nw.lifts[0]!).condition);
    expect(nw.ops.ops(nw.lifts[0]!).condition).toBeGreaterThan(50);
  });
  it('breakdown risk rises as condition falls and with bad weather; inspections reduce it', () => {
    const r = rig();
    const l = r.lifts[0]!, o = r.ops.ops(l);
    const base = r.ops.breakdownPerHour(l);
    o.condition = 40;
    expect(r.ops.breakdownPerHour(l)).toBeGreaterThan(base * 3);
    o.condition = 100; o.ageDays = 720;
    expect(r.ops.breakdownPerHour(l)).toBeCloseTo(base * 2, 8);
    o.ageDays = 0; o.inspection = 'thorough'; o.lastInspection = 0; (r.ops as unknown as { absDay: number }).absDay = 3;
    expect(r.ops.breakdownPerHour(l)).toBeCloseTo(base * LIFT_OPS.inspectionRisk.thorough, 8);
  });
  it('breakdowns are deterministic for a seed and differ between seeds', () => {
    const sig = (seed: number): string => {
      const r = rig({ seed, kinds: ['chair4', 'chair2', 'gondola6'] });
      for (const l of r.lifts) { r.ops.ops(l).condition = 25; r.ops.setMode(l.id, 'open'); }
      r.setTime(0, 0);
      r.step(TPD * 40);
      return JSON.stringify(r.lifts.map((l) => [r.ops.ops(l).breakdowns, Math.round(r.ops.ops(l).condition * 1000)])) + JSON.stringify(r.ev['lift:broken']);
    };
    expect(sig(7)).toBe(sig(7));
    expect(sig(7)).not.toBe(sig(8));
    expect(JSON.parse(sig(7).split(']]')[0]! + ']]').flat().reduce((a: number, b: number, i: number) => a + (i % 2 === 0 ? b : 0), 0)).toBeGreaterThan(0);
  });
  it('a broken lift is closed, repaired after hours, then resumes; workshop is faster and cheaper than a contractor', () => {
    const run = (workshop: boolean) => {
      const r = rig({ workshop });
      r.ops.ops(r.lifts[0]!).condition = 60; r.ops.setMode(1, 'open');
      r.setTime(10, 10); r.step();
      r.spent.length = 0;
      expect(r.ops.forceBreakdown(1)).toBe(true);
      expect(r.lifts[0]!.open).toBe(false);
      expect(r.lifts[0]!.opsReason).toBe('fault');
      const cost = r.spent.reduce((a, b) => a + b, 0), eta = r.ops.status(1)!.repairEtaHours;
      let ticks = 0;
      while (r.ops.ops(r.lifts[0]!).fault && ticks < TPD * 3) { r.step(); ticks++; }
      expect(r.lifts[0]!.open).toBe(true);
      expect(r.ev['lift:repaired']).toHaveLength(1);
      return { cost, eta, ticks };
    };
    const w = run(true), c = run(false);
    expect(w.eta).toBeLessThan(c.eta);
    expect(w.cost).toBeLessThan(c.cost);
    expect(w.ticks).toBeLessThan(c.ticks);
  });
  it('rush repair halves remaining time; overhaul restores condition to 100 and closes the lift', () => {
    const r = rig({ workshop: true });
    r.ops.ops(r.lifts[0]!).condition = 50; r.ops.setMode(1, 'open'); r.setTime(10, 10); r.step();
    r.ops.forceBreakdown(1);
    const before = r.ops.status(1)!.repairEtaHours;
    expect(r.ops.repairNow(1)).toBe(true);
    expect(r.ops.status(1)!.repairEtaHours).toBeLessThan(before * 0.75);
    expect(r.ops.repairNow(1)).toBe(false); // only once
    r.step(TPD);
    const r2 = rig({ workshop: true });
    r2.ops.ops(r2.lifts[0]!).condition = 40; r2.ops.setMode(1, 'open'); r2.setTime(10, 10); r2.step();
    expect(r2.ops.repairNow(1)).toBe(true);
    expect(r2.lifts[0]!.open).toBe(false);
    r2.step(TPD);
    expect(r2.ops.ops(r2.lifts[0]!).condition).toBeGreaterThan(98);
    expect(r2.lifts[0]!.open).toBe(true);
  });
  it('inspections: periodic at night, cost money, boost condition, close the lift for hours', () => {
    const r = rig({ workshop: true });
    r.ops.setInspection(1, 'basic'); r.ops.ops(r.lifts[0]!).condition = 70;
    r.setTime(0, 0); r.step(TPD * (LIFT_OPS.inspection.basic.everyDays + 2));
    const o = r.ops.ops(r.lifts[0]!);
    expect(o.lastInspection).toBeGreaterThan(0);
    expect(o.condition).toBeGreaterThan(70);
    expect(r.spent.length).toBeGreaterThan(0);
    // inspect now
    const r2 = rig({ workshop: true }); r2.setTime(5, 10); r2.step(); r2.ops.setMode(1, 'open');
    expect(r2.ops.inspectNow(1, 'thorough')).toBe(true);
    expect(r2.lifts[0]!.open).toBe(false);
    expect(r2.lifts[0]!.opsReason).toBe('inspection');
    expect(r2.ops.inspectNow(1, 'basic')).toBe(false);
    r2.step(TPD / 2);
    expect(r2.lifts[0]!.open).toBe(true);
  });
});

describe('stranded guests', () => {
  const strand = (o: Parameters<typeof rig>[0]) => {
    const r = rig(o);
    r.ops.setMode(1, 'open'); r.ops.ops(r.lifts[0]!).condition = 40; r.setTime(10, 10); r.step();
    r.riders.set(1, 12);
    r.ops.forceBreakdown(1);
    return r;
  };
  it('emits lift:broken and incident:stranded once, with an incident', () => {
    const r = strand({});
    expect(r.ev['lift:broken']).toEqual([{ id: 1, kind: 'chair4', stranded: 12 }]);
    expect(r.ev['incident:stranded']).toHaveLength(1);
    expect(r.incidents.open.filter((i) => i.kind === 'stranded')).toHaveLength(1);
    r.step(30);
    expect(r.ev['incident:stranded']).toHaveLength(1);
  });
  it('with a patrol the strand is evacuated quickly; without one the lift crew evacuates later; nobody stays stranded', () => {
    const when = (patrol: boolean): number => {
      const r = strand({ patrol, workshop: true });
      let t = 0;
      while (!r.lifts[0]!.evac && t < 200) { r.step(); t++; if (!r.ops.ops(r.lifts[0]!).fault) break; }
      return t;
    };
    const a = when(true), b = when(false);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThanOrEqual(LIFT_OPS.stranded.selfEvacTicks + 1);
  });
  it('no softlock: whatever happens, strands resolve within the max wait and the lift is eventually repaired', () => {
    for (const patrol of [true, false]) for (const workshop of [true, false]) for (const kind of ['chair4', 'cablecar'] as const) {
      const r = rig({ patrol, workshop, kinds: [kind], temp: -20, seed: 9 });
      r.ops.setMode(1, 'open'); r.ops.ops(r.lifts[0]!).condition = 10; r.setTime(10, 10); r.step();
      r.riders.set(1, 30); r.ops.forceBreakdown(1);
      let evacAt = -1;
      for (let t = 0; t < TPD * 3; t++) { r.step(); if (r.lifts[0]!.evac && evacAt < 0) evacAt = t; }
      expect(evacAt, `${kind} patrol=${patrol} workshop=${workshop}`).toBeGreaterThanOrEqual(0);
      expect(evacAt).toBeLessThanOrEqual(LIFT_OPS.stranded.selfEvacTicksNoWorkshop + 1);
      expect(r.incidents.open.filter((i) => i.kind === 'stranded')).toHaveLength(0);
      expect(r.ops.ops(r.lifts[0]!).fault).toBeNull();
      expect(r.lifts[0]!.evac).toBe(false);
    }
  });
  it('a quick repair resumes the ride with nobody evacuated', () => {
    const r = rig({ patrol: false, workshop: true });
    r.ops.setMode(1, 'open'); r.ops.ops(r.lifts[0]!).condition = 100; r.setTime(10, 10); r.step();
    r.riders.set(1, 4); r.ops.forceBreakdown(1);
    r.ops.repairNow(1); // rush
    let evac = false;
    for (let t = 0; t < 40; t++) { r.step(); evac ||= !!r.lifts[0]!.evac; if (!r.ops.ops(r.lifts[0]!).fault) break; }
    expect(r.ops.ops(r.lifts[0]!).fault).toBeNull();
    void evac;
  });
  it('incidents: stranded severity escalates and the rating penalty counts recent strandings', () => {
    const r = rig({ patrol: false });
    r.ops.setMode(1, 'open'); r.setTime(10, 10); r.step(); r.riders.set(1, 3);
    const p0 = r.incidents.stats().penalty;
    r.ops.forceBreakdown(1);
    expect(r.incidents.stats().penalty).toBeGreaterThan(p0);
    const inc = r.incidents.open.find((i) => i.kind === 'stranded') as Incident;
    expect(inc.severity).toBe(0);
    r.step(8);
    expect(inc.severity).toBeGreaterThanOrEqual(1);
  });
});

describe('lift variants', () => {
  it('throughput = carriers/hour x capacity for every loop variant, and bigger variants carry more', () => {
    const nodes = [{ x: 10, y: 3, z: 10 }, { x: 50, y: 15, z: 10 }];
    let prev = 0;
    for (const k of ['chair2', 'chair4', 'chair4d', 'chair6', 'chair8b'] as const) {
      const s = computeStats(k, nodes, 1);
      expect(s.throughputPerHour).toBeCloseTo(s.carriersPerHour * LIFTS[k].capacityPerCarrier, 6);
      expect(s.capacity).toBe(LIFTS[k].capacityPerCarrier);
      expect(s.throughputPerHour).toBeGreaterThan(prev);
      prev = s.throughputPerHour;
    }
    expect(LIFTS.gondola10.capacityPerCarrier).toBe(10);
    expect(LIFTS.gondola6.capacityPerCarrier).toBe(6);
    expect(LIFTS.chair6b.bubble).toBe(true);
    expect(LIFTS.chair4d.detachable).toBe(true);
    expect(LIFTS.chair4.detachable).toBe(false);
    expect(LIFTS.chair4d.loadTimeS).toBeLessThan(LIFTS.chair4.loadTimeS);
    expect(LIFTS.gondola10.windTolerance).toBeGreaterThan(LIFTS.chair2.windTolerance);
  });
  it('wind: chairs close in a storm while gondolas and funiculars keep running', () => {
    const r = rig({ weather: 'storm', kinds: ['chair2', 'gondola10', 'funicular'] });
    r.setTime(150, 12); r.step();
    expect(r.lifts.map((l) => l.open)).toEqual([false, true, true]);
    expect(r.lifts[0]!.opsReason).toBe('wind');
  });
});

describe('legacy lift ids', () => {
  it("'chairlift' loads as chair4 and 'gondola' as gondola6", async () => {
    const { LiftStore } = await import('@/sim/Lift');
    const { Occupancy } = await import('@/world/Occupancy');
    const store = new LiftStore(new Occupancy(64));
    const add = (kind: string) => store.add({ ...mkLift(0), kind: kind as never } as Omit<LiftData, 'id'>);
    expect(add('chairlift').kind).toBe('chair4');
    expect(add('gondola').kind).toBe('gondola6');
    expect(add('tbar').kind).toBe('tbar');
  });
});
