import { describe, expect, it } from 'vitest';
import { NAV_SPEED, LIFT_SECONDS_PER_TICK, TICKS_PER_SECOND } from '../../src/config/balance';
import { applyModel, clockMaths, modelAtSize, modelFor, MODELS, pacingTable, speedCatalog, toMult } from '../../scripts/analysis/timeflowLib';

describe('time-flow analysis lib (pure parts)', () => {
  it('applyModel mutates NAV_SPEED only while applied and restores it', () => {
    const before = { ...NAV_SPEED };
    const calls: Array<[string, number]> = [];
    const restore = applyModel(modelFor('t', 't', 150, { walk: 4, hike: 2, bike: 5, ski: 10 }, 6, 4), { setLiftSecPerTick: (v) => calls.push(['lift', v]), setVehicleTripTicks: (v) => calls.push(['trip', v]) });
    expect(NAV_SPEED.walk).toBeCloseTo(4 * 150 / 240, 6);
    expect(NAV_SPEED.skiBase).toBeCloseTo(10 * 150 / 240, 6);
    expect(NAV_SPEED.hike).toBeCloseTo(2 * 150 / 240, 6);
    restore();
    expect({ ...NAV_SPEED }).toEqual(before);
    expect(calls).toEqual([['lift', 6], ['trip', 4], ['lift', LIFT_SECONDS_PER_TICK], ['trip', 6]]);
  });
  it('toMult / clock maths', () => {
    expect(toMult(2, 24, 9)).toBeCloseTo(2 * 24 / 240 / 9, 9);
    expect(clockMaths(24).gameHoursPerRealS).toBeCloseTo(1, 9);
    expect(clockMaths(24).walkTilesPerS).toBeCloseTo(504, 6); // 1.4 m/s x 3600 / 10 m
    expect(modelAtSize(MODELS.find((m) => m.id === 'Es')!, 256).walk).toBeGreaterThan(modelAtSize(MODELS.find((m) => m.id === 'Es')!, 64).walk);
  });
  it('catalogue has the implemented walk speed (3.4 tiles/tick = 5.4 tiles/s at 1x) and the pacing table is consistent with the 180-day year', () => {
    const walk = speedCatalog().find((r) => r.what.startsWith('Guest walking'))!;
    expect(walk.tilesPerS1x).toBeCloseTo(NAV_SPEED.walk * TICKS_PER_SECOND, 6);
    expect(pacingTable(150)[0]!.yearMinutes).toBeCloseTo(150 * 180 / 60, 6);
    expect(pacingTable(150)[2]!.winterMinutes).toBeCloseTo(150 / 10 * 60 / 60, 6);
  });
});
