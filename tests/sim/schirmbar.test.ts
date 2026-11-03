import { describe, expect, it } from 'vitest';
import { schirmbarStatus, schirmbarStop } from '../../src/sim/attractions/Schirmbar';
import { SCHIRMBAR, SCHIRMBAR_REASON } from '../../src/config/schirmbar';
import { BUILDINGS } from '../../src/config/buildings';
import { UNLOCKS } from '../../src/config/unlocks';
import { RESTAURANT_SPECS } from '../../src/sim/attractions/Restaurant';
import { simDayOf } from '../../src/sim/calendar';
import type { WeatherKind } from '../../src/core/events';

const W = (kind: WeatherKind, wind = 0.1, fog = 0) => ({ kind, wind, fog });

describe('schirmbarStatus (pure open / closed rule)', () => {
  it('opens on clear, cloudy and light-snow winter days', () => {
    for (const k of ['clear', 'cloudy', 'snow'] as const) expect(schirmbarStatus({ season: 'winter', weather: W(k), playerClosed: false })).toEqual({ open: true });
  });
  it('closes in a storm, heavy snow, rain, high wind and fog, each with its own reason', () => {
    expect(schirmbarStatus({ season: 'winter', weather: W('storm', 1), playerClosed: false })).toEqual({ open: false, reason: SCHIRMBAR_REASON.storm });
    expect(schirmbarStatus({ season: 'winter', weather: W('heavySnow'), playerClosed: false })).toEqual({ open: false, reason: SCHIRMBAR_REASON.heavySnow });
    expect(schirmbarStatus({ season: 'winter', weather: W('rain'), playerClosed: false }).reason).toBe(SCHIRMBAR_REASON.rain);
    expect(schirmbarStatus({ season: 'winter', weather: W('clear', SCHIRMBAR.maxWind + 0.01), playerClosed: false }).reason).toBe(SCHIRMBAR_REASON.wind);
    expect(schirmbarStatus({ season: 'winter', weather: W('clear', 0.1, SCHIRMBAR.maxFog), playerClosed: false }).reason).toBe(SCHIRMBAR_REASON.fog);
    expect(schirmbarStatus({ season: 'winter', weather: W('clear', SCHIRMBAR.maxWind), playerClosed: false }).open).toBe(true); // the limit itself is still fine
  });
  it('is closed outside winter whatever the weather, and by the player in any weather (the player switch is reported first)', () => {
    for (const s of ['spring', 'summer', 'autumn'] as const) expect(schirmbarStatus({ season: s, weather: W('clear'), playerClosed: false })).toEqual({ open: false, reason: SCHIRMBAR_REASON.season });
    expect(schirmbarStatus({ season: 'winter', weather: W('clear'), playerClosed: true })).toEqual({ open: false, reason: SCHIRMBAR_REASON.player });
    expect(schirmbarStatus({ season: 'summer', weather: W('storm', 1), playerClosed: true }).reason).toBe(SCHIRMBAR_REASON.player);
  });
});

describe('Schirmbar catalog', () => {
  it('is a 2 x 2 services building without road, path or power, beside pistes but never ON one, unlocked at level 2', () => {
    const d = BUILDINGS.schirmbar!;
    expect([d.w, d.h, d.access, d.pisteRule, d.site.onWater]).toEqual([2, 2, 'none', 'edge', 'never']);
    expect(d.season).toBe('winter');
    expect(UNLOCKS.find((u) => u.id === 'schirmbar')?.level).toBe(2);
    expect(d.cost).toBeLessThanOrEqual(2000); // near the Coffee Stand
    expect(RESTAURANT_SPECS.schirmbar!.hours).toEqual(SCHIRMBAR.hours);
  });
  it('the stop hash is deterministic and takes about 1 pass in oneIn', () => {
    let n = 0; for (let id = 1; id <= 2000; id++) { expect(schirmbarStop(id, 3)).toBe(schirmbarStop(id, 3)); if (schirmbarStop(id, 3)) n++; }
    expect(n / 2000).toBeGreaterThan(0.18); expect(n / 2000).toBeLessThan(0.32);
  });
});

describe('Schirmbar in a real resort (headless)', () => {
  const setup = async (winterDay: number | null) => {
    const { createSim } = await import('../../src/game/createSim');
    const { findSite } = await import('../../src/tutorial/suggest');
    const { placeBuilding } = await import('../../src/sim/PlaceBuilding');
    const sim = createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', startDay: simDayOf(11, 8), now: () => 0 }); // 8 December
    // find where skiers really ski: watch one morning, take the busiest tile that has room for the bar beside it
    sim.guestSim.spawner.rateMult = 6;
    const heat = new Map<number, number>(), st = sim.guestSim.store;
    for (let i = 0; i < 90; i++) { sim.tick(1); for (let k = 0; k < st.limit; k++) if (st.alive[k] && st.act[k] === 5) { const key = Math.floor(st.y[k]!) * 64 + Math.floor(st.x[k]!); heat.set(key, (heat.get(key) ?? 0) + 1); } }
    let site: { x: number; y: number; rot: number } | null = null;
    for (const [key] of [...heat].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      site = findSite(sim, 'schirmbar', { x: key % 64, y: Math.floor(key / 64) }, { rmax: 3 });
      if (site) break;
    }
    if (!site) throw new Error('no site beside the ski line');
    const o = placeBuilding(sim.env, sim.props, 'schirmbar', site.x, site.y, site.rot, true, false);
    expect(o.ok, JSON.stringify(o)).toBe(true);
    sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
    void winterDay;
    sim.tick(1); // the attraction system learns the date on its first update
    return { sim, id: o.building!.id };
  };
  it('placed on open ground it is active with no road, path or power; clear winter day = open, storm = closed, and the player switch closes it', async () => {
    const { sim, id } = await setup(null);
    expect(sim.buildings.get(id)!.active).toBe(true);
    const at = sim.attractions;
    sim.weather.current.kind = 'clear'; sim.weather.current.wind = 0.1; sim.weather.current.fog = 0;
    expect(at.refreshOpen(id)!.open).toBe(true);
    sim.weather.current.kind = 'storm'; sim.weather.current.wind = 1;
    expect(at.refreshOpen(id)!.open).toBe(false); expect(at.get(id)!.reason).toBe(SCHIRMBAR_REASON.storm);
    sim.weather.current.kind = 'clear'; sim.weather.current.wind = 0.1;
    expect(at.setSchirmbarClosed(id, true)).toMatchObject({ open: false, reason: SCHIRMBAR_REASON.player });
    expect(at.setSchirmbarClosed(id, false)).toMatchObject({ open: true });
  }, 60_000);
  it('on a clear day skiers stop for a drink (income, capped); a storm day sells nothing; the same run twice is identical', async () => {
    const run = async (storm: boolean) => {
      const { sim, id } = await setup(null);
        for (let i = 0; i < 240 * 3; i++) {
        if (i % 40 === 0) { sim.weather.current.kind = storm ? 'storm' : 'clear'; sim.weather.current.wind = storm ? 1 : 0.1; sim.weather.current.fog = 0; }
        sim.tick(1);
      }
      const a = sim.attractions.get(id)!;
      return { stops: sim.guestSim.barStops, served: a.stats.served, revenue: a.stats.revenue, today: a.stats.today ?? 0 };
    };
    const clear = await run(false), clear2 = await run(false), storm = await run(true);
    expect(clear).toEqual(clear2); // deterministic
    expect(clear.stops).toBeGreaterThan(0);
    expect(clear.served).toBeGreaterThan(0);
    expect(clear.revenue).toBeGreaterThan(0);
    expect(clear.today).toBeLessThanOrEqual(SCHIRMBAR.dailyCap);
    expect(storm.served).toBe(0); expect(storm.revenue).toBe(0);
  }, 240_000);
});
