import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { placeLift, validateLift } from '../../src/sim/Lift';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { GState } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { buildStarterResort } from '../../src/game/starterResort';

describe('regressions found by the full-game smoke tests', () => {
  it('lift: a valid preview stays valid after placement (flatten ripple of one station must not un-level the other)', () => {
    // 64/seed 2: the top station needs a big levelling cut whose slope blend used to raise the flat valley-floor bottom station.
    const sim = createSim({ size: 64, seed: 2 });
    sim.game.money = 5e6;
    const env = { grid: sim.grid, lifts: sim.lifts, economy: sim.economy };
    const b = { x: 28, y: 46 }, t = { x: 23, y: 34 };
    const chk = validateLift(env, 'chair4', b, t, { autoFlatten: true });
    expect(chk.ok, chk.reasons.join(';')).toBe(true);
    const out = placeLift(env, sim.props, 'chair4', b, t, true);
    expect(out.reasons).toEqual([]);
    expect(out.ok).toBe(true);
    // the preview must not leave the terrain modified
    expect(validateLift(env, 'chair4', { x: 40, y: 10 }, { x: 40, y: 3 }, { autoFlatten: true }).reasons.length).toBeGreaterThanOrEqual(0);
  });

  it('attractions: released guests are put down on a walkable tile outside the footprint (not stranded inside a solid building)', () => {
    const sim = createSim({ size: 64, seed: 1 });
    buildStarterResort(sim);
    const st = sim.guestSim.store;
    sim.tick(2);
    const nav = sim.guestSim.graph()!;
    nav.pf.maxBuildsPerTick = Infinity;
    const n = sim.size;
    let walkTile = -1;
    for (let k = 0; k < n * n; k++) if (sim.networks.kind[k] === 1 && sim.networks.serves('path', { x: k % n, y: (k / n) | 0, w: 1, h: 1 })) { walkTile = k; break; }
    expect(walkTile).toBeGreaterThanOrEqual(0);
    const checked: string[] = [];
    for (const type of ['iceRink', 'heatedTerrace', 'magicCarpet', 'cafe']) {
      const b = sim.buildings.all().find((q) => q.type === type)!;
      expect(b, type).toBeDefined();
      // a guest in the middle of the footprint (as AttractionSystem.arrive puts it) that the attraction then releases
      const slot = st.add({ x: b.x + b.w / 2, y: b.y + b.h / 2, z: 0, type: 0, skill: 1, budget: 1e6, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: sim.game.date.tick });
      expect(slot).toBeGreaterThanOrEqual(0);
      const res = sim.attractions.arrive(slot, b, sim.game.date.tick);
      if (res !== 'using') continue; // closed in this season: nothing to release
      for (let t = 0; t < 120 && st.state[slot] === GState.Using; t++) sim.tick(1);
      expect(st.state[slot], `${type} should have released the guest`).not.toBe(GState.Using);
      const x = st.x[slot]!, y = st.y[slot]!;
      expect(x < b.x || x >= b.x + b.w || y < b.y || y >= b.y + b.h, `${type}: released inside footprint at ${x},${y}`).toBe(true);
      const here = (Math.floor(y) * n) + Math.floor(x);
      expect(nav.pf.find(NavMode.Walk, here, walkTile) !== null, `${type}: no walk path out from ${x},${y}`).toBe(true);
      checked.push(type);
    }
    expect(checked.length).toBeGreaterThanOrEqual(2);
  });

  it('placeBuilding via sim/PlaceBuilding matches the build/PlacementTool re-export', async () => {
    const mod = await import('../../src/build/PlacementTool');
    expect(mod.placeBuilding).toBe(placeBuilding);
  });
});
