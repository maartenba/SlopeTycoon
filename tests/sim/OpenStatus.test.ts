import { describe, expect, it } from 'vitest';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, Layer, lineTiles } from '../../src/world/Networks';
import { OpenStatus } from '../../src/sim/OpenStatus';
import type { LiftData } from '../../src/sim/Lift';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { DAYS_PER_YEAR, HEIGHT_UNIT } from '../../src/config/balance';
import { runDays, world } from './snowHelpers';

type W = ReturnType<typeof world>;

function setup(seed: number, toDay: number) {
  const w = world(seed);
  runDays(w, toDay + DAYS_PER_YEAR - 120); // from winter start (day 120) to `toDay` of the next year
  expect(w.state.date.day).toBe(toDay);
  const buildings = new Buildings(w.grid.occupancy);
  const net = new Networks(w.grid, buildings);
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('piste:opened', (e) => events.push(`piste:${e.open}`));
  bus.on('lift:opened', (e) => events.push(`lift:${e.id}:${e.open}`));
  bus.on('lift:closed', (e) => events.push(`closed:${e.id}:${e.reason}`));
  const lifts: LiftData[] = [];
  const os = new OpenStatus({ grid: w.grid, cond: w.cond, weather: w.weather, bus, networks: () => net, lifts: () => lifts, buildings: () => buildings.all() });
  return { w, net, buildings, lifts, os, events };
}

const lift = (w: W, id: number, kind: LiftData['kind'], bx: number, tx: number, y = 20, mode?: LiftData['mode']): LiftData => ({
  id, kind, bottom: { x: bx, y, ground: w.cond.altitude(bx, y) }, top: { x: tx, y, ground: w.cond.altitude(tx, y) },
  towers: [], nodes: [], tiles: [], open: true, speed: 1, cost: 0, mode,
});
const paintRow = (net: Networks, y: number, x0: number, x1: number): void => { net.paint(Layer.Ski, lineTiles({ x: x0, y }, { x: x1, y })); };
const lineRel = (w: W): number => (w.weather.current.snowline - w.scale.baseWorld) / w.scale.reliefWorld;

describe('mid-spring snowline', () => {
  const S = setup(11, 15);
  const { w, net, os, lifts } = S;
  it('tiles above the snowline are skiable and valley tiles hikeable on the same day', () => {
    const line = w.weather.current.snowline;
    // the snowline sits mid-slope (not in the valley, not above the summit)
    expect(line).toBeGreaterThan(w.scale.baseWorld + 0.15 * w.scale.reliefWorld);
    expect(line).toBeLessThan(w.scale.baseWorld + 0.85 * w.scale.reliefWorld);
    for (const x of [56, 59, 62]) expect(w.cond.isSkiable(x, 30)).toBe(true);
    for (const x of [1, 3, 5]) { expect(w.cond.isHikeable(x, 30)).toBe(true); expect(w.cond.isSkiable(x, 30)).toBe(false); }
    expect(w.cond.zone(2, 30)).toBe('meadow');
    expect(w.cond.zone(61, 30)).toBe('snow');
  });
  it('a piste spanning the snowline reports a shortened open length', () => {
    paintRow(net, 30, 2, 61);
    os.evaluate();
    const st = os.pisteAt(30, 30)!;
    expect(st).toBeDefined();
    expect(st.open).toBe(true);
    expect(st.openLengthM).toBeGreaterThan(0);
    expect(st.openLengthM).toBeLessThan(st.totalLengthM);
    expect(st.totalLengthM).toBe(60 * 10);
  });
  it('a lift whose top is above the snowline stays open for skiing; valley bottom allows foot too (mixed)', () => {
    paintRow(net, 20, 4, 60);
    lifts.push(lift(w, 1, 'chair4', 4, 56), lift(w, 2, 'tbar', 4, 56), lift(w, 3, 'chair4', 1, 5));
    S.os.evaluate();
    expect(lifts[0]!.open).toBe(true);
    expect(lifts[0]!.activeMode).toBe('mixed');
    expect(lifts[1]!.open).toBe(true);
    expect(lifts[1]!.activeMode).toBe('ski'); // T-bars cannot carry foot passengers
    // both stations in the snow-free valley: no snow to ski, but foot/bike chairs keep running in shoulder season
    expect(lifts[2]!.activeMode).toBe('foot');
    expect(lifts[2]!.open).toBe(true);
    lifts.push(lift(w, 4, 'tbar', 1, 5));
    S.os.evaluate();
    expect(lifts[3]!.open).toBe(false);
    expect(lifts[3]!.closedReason).toMatch(/^Closed: no snow at the top station \(/);
    expect(S.events.some((e) => e.startsWith('closed:4:'))).toBe(true);
  });
  it('explicit lift modes are respected', () => {
    lifts.push(lift(w, 5, 'chair4', 1, 56, 20, 'foot'), lift(w, 6, 'chair4', 56, 60, 20, 'foot'));
    S.os.evaluate();
    expect(lifts[4]!.activeMode).toBe('foot');
    expect(lifts[5]!.open).toBe(false); // snow at the bottom station
    expect(lifts[5]!.closedReason).toMatch(/snow at the bottom/);
  });
  it('catalog needs are evaluated at the tile with a reason', () => {
    const valley = S.os.evaluateNeeds(['snow'], 2, 30);
    expect(valley.open).toBe(false);
    expect(valley.reason).toMatch(/^Closed: no snow at [\d,]+ m$/);
    expect(S.os.evaluateNeeds(['snow'], 61, 30).open).toBe(true);
    expect(S.os.evaluateNeeds(['snowFree'], 2, 30).open).toBe(true);
    expect(S.os.evaluateNeeds(['snowFree'], 61, 30).open).toBe(false);
    const b = S.buildings.add('stuntPark', 1, 40, 0).building;
    S.os.evaluate();
    expect(S.os.buildingStatus(b.id)!.open).toBe(false);
    void lineRel;
  });
});

describe('seasonal snow cover across seeds (64 map)', () => {
  it('mid-spring: high tiles skiable & valley hikeable; early summer: highest tiles still snowy, valley bare', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const spring = world(seed);
      runDays(spring, 75);
      expect(spring.cond.isSkiable(62, 30), `seed ${seed} spring high`).toBe(true);
      expect(spring.cond.isHikeable(2, 30), `seed ${seed} spring valley`).toBe(true);
      const summer = world(seed);
      runDays(summer, 90); // day 30 = first day of summer
      expect(summer.cond.isSkiable(62, 30), `seed ${seed} summer high`).toBe(true);
      expect(summer.cond.isBikeable(3, 30), `seed ${seed} summer valley`).toBe(true);
    }
  });
});

describe('early summer, high peaks', () => {
  it('a high piste stays open while the valley offers hiking and MTB', () => {
    const S = setup(11, 37);
    const { w, net, os } = S;
    for (let y = 40; y < 44; y++) paintRow(net, y, 50, 62); // highest tiles (main piste)
    paintRow(net, 46, 2, 14); // valley piste: nothing to ski in early summer
    net.paint(Layer.Mtb, lineTiles({ x: 2, y: 50 }, { x: 14, y: 50 }));
    net.paint(Layer.Hike, lineTiles({ x: 2, y: 52 }, { x: 14, y: 52 }));
    os.evaluate();
    expect(os.pisteAt(58, 40)!.open).toBe(true);
    expect(os.pisteAt(5, 46)!.open).toBe(false);
    expect(w.cond.isBikeable(8, 50)).toBe(true);
    expect(w.cond.isHikeable(8, 52)).toBe(true);
    const tf = os.trailOpenFraction();
    expect(tf.mtb).toBe(1); expect(tf.hike).toBe(1);
  });
});

describe('hysteresis', () => {
  it('open pistes/lifts do not toggle while depth stays in the dead band', () => {
    const S = setup(11, 15);
    const { w, net, os, lifts, events } = S;
    paintRow(net, 45, 50, 60);
    lifts.push(lift(w, 1, 'tbar', 50, 58, 45));
    for (let x = 50; x <= 61; x++) for (let y = 44; y <= 47; y++) { const i = w.grid.tileIndex(x, y); w.grid.snowDepth[i] = 0.5; w.cond.refreshTile(i); }
    os.evaluate();
    expect(os.pisteAt(55, 45)!.open).toBe(true);
    expect(lifts[0]!.open).toBe(true);
    events.length = 0;
    // a day's temperature fluctuation modelled as depth wobbling between 16 and 29 cm, evaluated every in-game hour
    for (let h = 0; h < 48; h++) {
      const d = 0.225 + 0.065 * Math.sin(h);
      for (let x = 50; x <= 61; x++) for (let y = 44; y <= 47; y++) { const i = w.grid.tileIndex(x, y); w.grid.snowDepth[i] = d; w.cond.refreshTile(i); }
      os.evaluate();
    }
    expect(events).toEqual([]);
    expect(os.pisteAt(55, 45)!.open).toBe(true);
    // drops under 15 cm: closes exactly once
    for (let x = 50; x <= 61; x++) for (let y = 44; y <= 47; y++) { const i = w.grid.tileIndex(x, y); w.grid.snowDepth[i] = 0.1; w.cond.refreshTile(i); }
    os.evaluate(); os.evaluate();
    expect(events.filter((e) => e.startsWith('piste:')).length).toBe(1);
    expect(os.pisteAt(55, 45)!.open).toBe(false);
    expect(HEIGHT_UNIT).toBe(0.5);
  });
});
