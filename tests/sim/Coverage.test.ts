import { describe, expect, it } from 'vitest';
import { Coverage, paintOverlay, EMPTY_NETWORK, steepnessDifficulty, type CoverageBuilding } from '@/sim/Coverage';
import { BUILDINGS } from '@/config/buildings';

let id = 1;
const mk = (type: string, x: number, y: number, active = true): CoverageBuilding => ({ id: id++, type, x, y, w: BUILDINGS[type]!.w, h: BUILDINGS[type]!.h, active });

describe('Coverage', () => {
  it('radius edge is inclusive from footprint centre', () => {
    const c = new Coverage(64);
    const hut = mk('firstAid', 30, 30); // centre (31,31), r 18
    c.refresh([hut]);
    expect(c.isCovered('firstAid', 31 + 17, 31)).toBe(true); // tile centre dist 17.5 -> inside... (48+.5-31=17.5)
    expect(c.isCovered('firstAid', 31 + 18, 31)).toBe(false); // 18.5 > 18
    expect(c.isCovered('firstAid', 31, 31 - 18)).toBe(true); // centre y 31-17.5 -> 17.5? tile 13 -> 13.5, d=17.5
  });
  it('inactive building gives no coverage', () => {
    const c = new Coverage(64);
    c.refresh([mk('firstAid', 30, 30, false)]);
    expect(c.coverageFraction('firstAid')).toBe(0);
  });
  it('snowmaking needs a linked active reservoir', () => {
    const c = new Coverage(128);
    const cannon = mk('snowCannon', 20, 20);
    c.refresh([cannon]);
    expect(c.isCovered('snowmaking', 20, 20)).toBe(false);
    const far = mk('reservoir', 100, 100);
    c.refresh([cannon, far]);
    expect(c.isCovered('snowmaking', 20, 20)).toBe(false);
    const near = mk('reservoir', 30, 20);
    c.refresh([cannon, far, near]);
    expect(c.isCovered('snowmaking', 20, 20)).toBe(true);
    c.refresh([cannon, far, { ...near, active: false }]);
    expect(c.isCovered('snowmaking', 20, 20)).toBe(false);
  });
  it('removal clears coverage; nearestResponder/fraction work', () => {
    const c = new Coverage(64);
    const a = mk('patrolHub', 10, 10), h = mk('helipad', 50, 50);
    c.refresh([a, h]);
    expect(c.coverageFraction('patrol')).toBeGreaterThan(0);
    expect(c.nearestResponder('patrol', 12, 12)?.id).toBe(a.id);
    expect(c.nearestResponder('firstAid', 0, 0)).toBeNull();
    c.refresh([h]);
    expect(c.coverageFraction('patrol')).toBe(0);
    expect(c.isCovered('heli', 50, 50)).toBe(true);
  });
  it('region-limited update equals full recompute', () => {
    const N = 128;
    const a = mk('firstAid', 20, 20), b = mk('patrolHub', 60, 40), r = mk('reservoir', 90, 90), s = mk('snowCannon', 100, 95);
    const inc = new Coverage(N), full = new Coverage(N);
    let set = [a, b, s];
    inc.refresh(set);
    set = [...set, r];
    inc.refresh(set, inc.affectedRect(r)); // adding reservoir enables the cannon
    full.refresh(set);
    for (const k of ['firstAid', 'patrol', 'snowmaking'] as const) expect(inc.map(k)).toEqual(full.map(k));
    expect(inc.isCovered('snowmaking', 100, 95)).toBe(true);
    set = set.filter((x) => x !== a);
    inc.refresh(set, inc.affectedRect(a));
    full.refresh(set);
    expect(inc.map('firstAid')).toEqual(full.map('firstAid'));
  });
  it('paints overlays and thresholds', () => {
    const c = new Coverage(64);
    const hut = mk('firstAid', 30, 30);
    c.refresh([hut]);
    const out = new Uint8Array(64 * 64 * 4);
    paintOverlay(out, 64, 'firstAid', c, EMPTY_NETWORK, [hut]);
    expect(out[(31 * 64 + 31) * 4 + 3]).toBeGreaterThan(0);
    paintOverlay(out, 64, 'connectivity', c, EMPTY_NETWORK, [hut]);
    expect(out[(30 * 64 + 30) * 4]).toBe(230); // red = unconnected
    expect([0.1, 0.2, 0.3, 0.9].map(steepnessDifficulty)).toEqual([1, 2, 3, 4]);
  });
});
