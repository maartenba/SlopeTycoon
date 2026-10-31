/** [perf] Snowboarder / Ski tourer: route shape detection, lift pick and tourer goal lists stay cheap. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/Rng';
import { Decider, routeShape, type LiftInfo } from '../../../src/sim/guests/Decision';
import { Touring } from '../../../src/sim/guests/Tourer';
import { SHIPPED_TYPES } from '../../../src/config/guestTypes';
import type { NavGraph } from '../../../src/sim/guests/NavGraph';
import { budget } from '../../perfMode';

const best = (n: number, f: () => void): number => { let b = Infinity; for (let k = 0; k < n; k++) { const t = performance.now(); f(); b = Math.min(b, performance.now() - t); } return b; };

describe('[perf] boarders and tourers', () => {
  it('routeShape over a 600-tile route (done once per lift per nav epoch) is far below a millisecond budget', () => {
    const n = 128;
    const nav = { size: n, isPiste: (t: number) => (t % n) >= 40 && (t % n) < 44, tileAltitude: (t: number) => 100 - ((t / n) | 0) * 0.2 } as unknown as NavGraph;
    const nodes = Array.from({ length: 600 }, (_, i) => (i % 120) * n + 41);
    expect(best(5, () => { for (let k = 0; k < 20; k++) routeShape(nav, nodes); }) / 20).toBeLessThan(budget(3));
  });
  it('pickSkiLift with the shape terms (12 lifts) and the tourer goal list (20 routes) cost next to nothing', () => {
    const d = new Decider(() => null);
    d.lifts = Array.from({ length: 12 }, (_, i): LiftInfo => ({ lift: { id: i } as never, skiDescent: [true, true, true, true], bikeDescent: false, topDepth: 0.7, bottomX: i * 5, bottomY: 10, flat: [0.2, 0.2, 0.2, 0.2], wide: [0.5, 0.5, 0.5, 0.5] }));
    const flats = SHIPPED_TYPES.find((t) => t.id === 'snowboarder')!.flats;
    const rng = new Rng(1);
    expect(best(5, () => { for (let k = 0; k < 2000; k++) d.pickSkiLift(2, 30, 10, rng, -1, flats); }) / 2000).toBeLessThan(budget(0.05));
    const t = new Touring();
    t.attach({ openRoutes: () => Array.from({ length: 20 }, (_, i) => ({ id: i })), dangerOf: () => 2, isOpen: () => true, routeTiles: (id) => Array.from({ length: 80 }, (_, k) => id * 100 + k) });
    expect(best(5, () => t.goalTiles((x) => x)) ).toBeLessThan(budget(5));
  });
});
