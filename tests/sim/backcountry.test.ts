/** Phase 6 Task 32: backcountry routes + avalanche danger 1-5 (docs/backcountry.md). */
import { describe, expect, it } from 'vitest';
import { rampGrid } from './snowHelpers';
import { FakeGuests, mkB, mkSafety, run } from './ops/safetyHelpers';
import { DANGER, dangerText, Sev } from '../../src/sim/ops';
import { Backcountry } from '../../src/sim/ops/Backcountry';
import type { Safety } from '../../src/sim/ops';

const N = 64;
function steepGrid(hs = 2) {
  const g = rampGrid(N);
  for (let vy = 0; vy <= N; vy++) for (let vx = 0; vx <= N; vx++) g.setCornerUnchecked(vx, vy, 4 + hs * vx);
  g.consumeDirtyChunks();
  return g;
}
const ROUTE = Array.from({ length: 16 }, (_, k) => 20 * N + 10 + k); // a line of tiles along +x (uphill)

function setup(seed: number, patrol: boolean) {
  const g = steepGrid();
  g.snowDepth.fill(1.5);
  const weather = { current: { intensity: 1, kind: 'heavySnow' }, temperatureAt: () => -4 };
  const guests = new FakeGuests(N);
  const m = mkSafety({
    seed, guests, buildings: patrol ? [mkB('patrolHub', 22, 22)] : [],
    avalanche: { grid: g, weather, altitude: () => 200, addSnow: (i, d) => { g.snowDepth[i] = Math.max(0, g.snowDepth[i]! + d); }, isPiste: () => false },
  });
  m.safety.resync();
  const net = { version: 1, backcountryComponents: () => [{ tiles: ROUTE, top: { x: 25, y: 20 }, bottom: { x: 10, y: 20 } }], attachedToNetwork: () => true };
  const closedSets: Array<Set<number>> = [];
  const bc = new Backcountry({ size: N, networks: net, avalanche: m.safety.avalanche, patrol: () => m.cov.map('patrol'), snowy: (i) => g.snowDepth[i]! > 0.3, onClosedChange: (s) => closedSets.push(s) });
  return { m, g, bc, weather, net, closedSets };
}
/** Run `ticks` sim ticks, feeding the Backcountry update like createSim does (before the avalanche step of the tick). */
function go(s: ReturnType<typeof setup>, ticks: number, t0: number, onTick?: (t: number) => void): number {
  for (let k = 0; k < ticks; k++) {
    const t = t0 + k;
    s.bc.update(t);
    run(s.m.safety as Safety, 1, t, 10);
    onTick?.(t);
  }
  return t0 + ticks;
}

describe('danger scale', () => {
  it('maps the instability score through fixed thresholds to 1..5 with names', () => {
    const { bc, m } = setup(1, false);
    const a = m.safety.avalanche;
    expect(a.levelOfScore(0)).toBe(1);
    expect(a.levelOfScore(DANGER.thresholds[0]!)).toBe(2);
    expect(a.levelOfScore(DANGER.thresholds[1]!)).toBe(3);
    expect(a.levelOfScore(DANGER.thresholds[2]!)).toBe(4);
    expect(a.levelOfScore(10)).toBe(5);
    expect(dangerText(3)).toBe('Considerable (3)');
    expect(bc.routes()).toHaveLength(1);
    expect(bc.dangerOf(bc.routes()[0]!.id)).toBe(1); // nothing has loaded yet
    expect(a.dangerLevel({ tiles: ROUTE })).toBe(1);
  });

  it('rises after a storm of heavy fresh snow', () => {
    const s = setup(2, false);
    const id = s.bc.routes()[0]!.id;
    let max = 1;
    go(s, 240 * 4, 0, () => { max = Math.max(max, s.bc.dangerOf(id)); });
    expect(max).toBeGreaterThanOrEqual(3);
  });

  it('falls after control blasting (Patrol Hub) and with a clear, settling spell', () => {
    const s = setup(3, true);
    const id = s.bc.routes()[0]!.id, a = s.m.safety.avalanche;
    for (const t of ROUTE) a.inst[t] = 2.4; // a loaded slab
    s.bc.refresh();
    expect(s.bc.dangerOf(id)).toBe(5);
    expect(s.bc.isOpen(id)).toBe(false);
    a.blast(0);
    s.bc.refresh();
    expect(s.bc.dangerOf(id)).toBeLessThanOrEqual(2);
    // settling: no snow, no patrol: the danger decays by itself
    const t2 = setup(3, false), b = t2.m.safety.avalanche, id2 = t2.bc.routes()[0]!.id;
    for (const t of ROUTE) b.inst[t] = 2.4;
    t2.bc.refresh();
    expect(t2.bc.dangerOf(id2)).toBe(5);
    t2.weather.current.intensity = 0; t2.weather.current.kind = 'clear';
    go(t2, 240 * 6, 0);
    expect(t2.bc.dangerOf(id2)).toBeLessThan(5);
  });
});

describe('closing, override, users', () => {
  it('closes at danger 4 with reason, reopens below (hysteresis), and publishes the closed tiles', () => {
    const s = setup(4, false), a = s.m.safety.avalanche, id = s.bc.routes()[0]!.id;
    expect(s.bc.isOpen(id)).toBe(true);
    for (const t of ROUTE) a.inst[t] = 1.0; // score ~1.0 -> level 5
    s.bc.refresh();
    const r = s.bc.route(id)!;
    expect(r.open).toBe(false);
    expect(r.closedReason).toMatch(/^Avalanche danger [45]$/);
    expect(s.closedSets.at(-1)!.size).toBe(ROUTE.length);
    expect(s.bc.closedForDanger()).toHaveLength(1);
    expect(s.bc.openRoutes()).toHaveLength(0);
    expect(s.bc.pickRoute(() => 0.5)).toBeNull();
    for (const t of ROUTE) a.inst[t] = 0.5; // 0.5: level 3, but still above the reopen score? 0.5 < 0.55 -> reopens
    s.bc.refresh();
    expect(s.bc.route(id)!.danger).toBe(3);
    expect(s.bc.isOpen(id)).toBe(true);
    expect(s.closedSets.at(-1)!.size).toBe(0);
    for (const t of ROUTE) a.inst[t] = 1.0; s.bc.refresh();
    for (const t of ROUTE) a.inst[t] = 0.58; s.bc.refresh(); // level 3 but above the reopen score: stays closed (no flapping)
    expect(s.bc.route(id)!.danger).toBe(3);
    expect(s.bc.isOpen(id)).toBe(false);
  });

  it('the override keeps a route open at danger >= 4 (per route and global), and off-piste users only get low-danger routes', () => {
    const s = setup(5, false), a = s.m.safety.avalanche, id = s.bc.routes()[0]!.id;
    for (const t of ROUTE) a.inst[t] = 1.2;
    s.bc.refresh();
    expect(s.bc.isOpen(id)).toBe(false);
    s.bc.setOverride(id, true);
    expect(s.bc.isOpen(id)).toBe(true);
    expect(s.bc.hasRiskyOpen()).toBe(true);
    expect(s.bc.offPisteMask[ROUTE[0]!]).toBe(0); // danger 5: no off-piste share
    expect(s.bc.pickRoute(() => 0, 3)).toBeNull(); // a tourer never goes at >= 4 even when it is open
    expect(s.bc.pickRoute(() => 0, 5)?.id).toBe(id);
    s.bc.setOverride(id, false);
    expect(s.bc.isOpen(id)).toBe(false);
    s.bc.setGlobalOverride(true);
    expect(s.bc.isOpen(id)).toBe(true);
    s.bc.setGlobalOverride(false);
    for (const t of ROUTE) a.inst[t] = 0.05; s.bc.refresh();
    expect(s.bc.offPisteMask[ROUTE[3]!]).toBe(1);
  });

  it('a route that is not attached, or has no snow, is closed with its own reason', () => {
    const s = setup(6, false), id = s.bc.routes()[0]!.id;
    s.g.snowDepth.fill(0); s.bc.refresh();
    expect(s.bc.route(id)!.closedReason).toBe('Closed: no snow');
    s.g.snowDepth.fill(1.5);
    s.net.attachedToNetwork = () => false; s.net.version++; s.bc.refresh();
    expect(s.bc.route(id)!.closedReason).toMatch(/^Not connected/);
  });

  it('save / load keeps overrides, closed flags and levels; null while there is nothing', () => {
    const s = setup(7, false), a = s.m.safety.avalanche, id = s.bc.routes()[0]!.id;
    for (const t of ROUTE) a.inst[t] = 1.2;
    s.bc.refresh(); s.bc.setOverride(id, true);
    const data = JSON.parse(JSON.stringify(s.bc.serialize()));
    const r = setup(7, false);
    for (const t of ROUTE) r.m.safety.avalanche.inst[t] = 1.2;
    r.bc.load(data);
    expect(r.bc.hash()).toBe(s.bc.hash());
    expect(r.bc.route(id)!.override).toBe(true);
    expect(JSON.parse(JSON.stringify(r.bc.serialize()))).toEqual(data);
    r.bc.reset();
    const empty = { version: 1, backcountryComponents: () => [], attachedToNetwork: () => true };
    const none = new Backcountry({ size: N, networks: empty, avalanche: r.m.safety.avalanche, patrol: () => r.m.cov.map('patrol'), snowy: () => true });
    expect(none.serialize()).toBeNull();
  });
});

describe('burials are injuries only', () => {
  it('over many seeded avalanches on a route full of skiers nobody dies or vanishes: every buried guest resolves as recovered / hospitalised', () => {
    let buried = 0, slides = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup(seed, seed % 2 === 0);
      for (let k = 0; k < 30; k++) s.m.guests.add(k + 1, 11 + (k % 15), 20.5); // skiers spread over the route
      const av = s.m.safety.avalanche;
      av.update(0, 10, 0, 0);
      for (const t of ROUTE) av.inst[t] = 2.4; // a loaded slope: a slab comes down on the skiers
      av.release(ROUTE[10]!, false, 0);
      go(s, 240 * 14, 0, (t) => { if (t % 240 === 0 && t < 240 * 6) for (let k = 0; k < 4; k++) s.g.snowDepth[ROUTE[k]!] = 1.5; });
      run(s.m.safety, 700, 240 * 14, 10);
      const a = s.m.safety.avalanche;
      slides += a.releases; buried += a.buriedTotal;
      const inc = s.m.safety.incidents;
      expect(inc.open.length, `seed ${seed}`).toBe(0);
      for (const e of s.m.events) if (e.name === 'incident:resolved') expect(['recovered', 'hospitalised', 'evacuated', 'left']).toContain((e.p as { outcome: string }).outcome);
      for (const g of s.m.guests.guests.values()) expect([undefined, 'hospital', 'leave']).toContain(g.gone);
    }
    expect(slides).toBeGreaterThan(0);
    expect(buried).toBeGreaterThan(0); void Sev;
  });
});
