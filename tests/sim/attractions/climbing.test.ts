/** Phase 6 Task 23: Climbing Crag (docs/climbing.md): site rule (steep rock face nearby), summer attraction, optional instructor, minor mishaps. */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../../src/config/buildings';
import { PRICE_TABLE } from '../../../src/config/prices';
import { unlockLevel } from '../../../src/config/unlocks';
import { ATTRACTION_SPECS } from '../../../src/sim/attractions/registry';
import { CLIMB, CLIMBING_SPECS, mishapRoll } from '../../../src/sim/attractions/Climbing';
import { describeRules } from '../../../src/sim/PlacementRules';
import { placeBuilding, validatePlacement } from '../../../src/sim/PlaceBuilding';
import { createSim, type Sim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/game/saveState';
import { cliffFaces, countCliffs, isCliffTile } from '../../../src/world/Cliffs';
import { TileType } from '../../../src/world/Grid';
import { seasonStartDay } from '../../../src/sim/Clock';
import { Sev } from '../../../src/sim/ops/Incidents';
import { formatAttractionStats } from '../../../src/ui/attractionFormat';
import { RULES } from '../../../src/sim/advisor/rules';
import { planPathTo, buildNetwork } from '../../../src/tutorial/suggest';
import { readFileSync } from 'node:fs';

const RULE = BUILDINGS.crag!.site.nearRock!;
const SUMMER = seasonStartDay('summer') + 20;

const mkSim = (seed = 61, size: 64 | 128 = 64): Sim => {
  const sim = createSim({ size, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0, money: 5_000_000 } as never);
  sim.progression.unlockAll = true;
  return sim;
};
/** First tile whose crag placement is valid (autoFlatten on: the hut may need a small pad at the foot of a cliff). */
function findCragSite(sim: Sim, from = 0): { x: number; y: number } | null {
  const n = sim.size;
  let seen = 0;
  for (let y = 6; y < n - 6; y++) for (let x = 6; x < n - 6; x++) {
    if (countCliffs(sim.grid, { x, y, w: 2, h: 2 }, RULE) < RULE.minTiles) continue;
    if (validatePlacement(sim.env, 'crag', x, y, 0, true).reasons.length) continue;
    if (seen++ >= from) return { x, y };
  }
  return null;
}
/** Place a crag at the first valid site that a footpath can reach, and connect it (access never blocks placement, but an unconnected hut is inactive). */
function placeCrag(sim: Sim, patrolled = false): number {
  for (let k = 0; k < 400; k++) {
    const s = findCragSite(sim, k);
    if (!s) break;
    if (patrolled && !(sim.coverage.map('patrol')[(s.y + 1) * sim.size + s.x + 1]! > 0)) continue; // a crag inside the Ski Patrol Hub's range
    const rect = { x: s.x, y: s.y, w: 2, h: 2 };
    const path = planPathTo(sim, rect);
    if (!path || !path.length) continue;
    const o = placeBuilding(sim.env, sim.props, 'crag', s.x, s.y, 0, true, true);
    if (!o.ok) continue;
    buildNetwork(sim, 1, path);
    sim.refreshCoverage(o.building!, true); sim.buildings.reevaluate();
    if (!sim.buildings.get(o.building!.id)!.active) { sim.buildings.remove(o.building!.id); continue; }
    return o.building!.id;
  }
  throw new Error('no connectable crag site');
}
const queueGuest = (sim: Sim, id: number, budget = 500): number => {
  const slot = sim.guestSim.store.add({ x: 1, y: 1, z: 0, type: 5, skill: 1, budget, group: 0, mode: 0, overnight: false, leaveDay: 999, tick: 0 });
  sim.attractions.arrive(slot, sim.buildings.get(id)!, sim.getSimTick());
  return slot;
};

describe('Climbing Crag data', () => {
  it('is a 2x2 recreation building: trail or footpath access, summer, one optional instructor, steep-rock site rule', () => {
    const d = BUILDINGS.crag!;
    expect([d.w, d.h, d.category, d.staff, d.capacity]).toEqual([2, 2, 'recreation', 1, 8]);
    expect([d.access, ...(d.altAccess ?? [])].sort()).toEqual(['path', 'trail']);
    expect(d.season).toBe('summer');
    expect(RULE).toEqual({ minTiles: 3, radius: 3, minSpread: 2 });
    expect(describeRules('crag').some((l) => /steep rock face/.test(l))).toBe(true);
  });
  it('ticket $30, 8 slots, 6-tick climbs, summer only, adventure + solo guests love it, families hardly', () => {
    expect(PRICE_TABLE.crag!.price).toBe(30);
    const sp = ATTRACTION_SPECS.crag!;
    expect([sp.slots, sp.serviceTicks, sp.seasonOpen]).toEqual([8, 6, ['summer']]);
    const [solo, , family, , , adventure] = sp.appeal;
    expect(adventure).toBe(1);
    expect(solo).toBeGreaterThan(family);
    expect(CLIMBING_SPECS.crag).toBe(sp);
  });
  it('is a selective career unlock (level 2); no goal, tutorial step or advisor rule mentions it', () => {
    expect(unlockLevel('building', 'crag')).toBe(2);
    for (const f of ['src/config/goals.ts', 'src/tutorial/hints.ts', 'src/tutorial/suggest.ts', 'src/sim/advisor/rules.ts', 'src/sim/advisor/strings.ts']) expect(readFileSync(f, 'utf8').includes('crag'), f).toBe(false);
    expect(RULES.some((r) => /crag|climb/.test(r.id))).toBe(false);
  });
});

describe('rock face helper (pure)', () => {
  it('finds cliff tiles (bare rock, corner spread >= 2) nearest first and counts them', () => {
    const sim = mkSim();
    const g = sim.grid;
    let rock: { x: number; y: number } | null = null;
    for (let y = 0; y < g.size && !rock; y++) for (let x = 0; x < g.size; x++) if (isCliffTile(g, x, y, 2)) { rock = { x, y }; break; }
    expect(rock).not.toBeNull();
    expect(g.tileType[g.tileIndex(rock!.x, rock!.y)]).toBe(TileType.Rock);
    const faces = cliffFaces(g, { x: rock!.x, y: rock!.y, w: 1, h: 1 }, { minTiles: 1, radius: 3, minSpread: 2 });
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f, i) => i === 0 || faces[i - 1]!.dist <= f.dist)).toBe(true);
    expect(faces.every((f) => f.spread >= 2 && Math.abs(f.heading) <= Math.PI)).toBe(true);
    expect(countCliffs(g, { x: rock!.x, y: rock!.y, w: 1, h: 1 }, { minTiles: 1, radius: 5, minSpread: 2 })).toBeGreaterThanOrEqual(faces.length);
    expect(isCliffTile(g, -1, 0, 2)).toBe(false);
    // a meadow tile is never a cliff
    let meadow = -1;
    for (let i = 0; i < g.size * g.size && meadow < 0; i++) if (g.tileType[i] === TileType.Grass) meadow = i;
    expect(isCliffTile(g, meadow % g.size, (meadow / g.size) | 0, 0)).toBe(false);
  });
  it('is deterministic', () => {
    const a = cliffFaces(mkSim().grid, { x: 20, y: 20, w: 2, h: 2 }, { minTiles: 1, radius: 8, minSpread: 2 });
    const b = cliffFaces(mkSim().grid, { x: 20, y: 20, w: 2, h: 2 }, { minTiles: 1, radius: 8, minSpread: 2 });
    expect(a).toEqual(b);
  });
});

describe('placement rule', () => {
  it('refuses a spot without a rock face ("Needs a steep rock face nearby") and explains how many are there', () => {
    const sim = mkSim();
    let bad: { x: number; y: number } | null = null;
    for (let y = 8; y < sim.size - 8 && !bad; y++) for (let x = 8; x < sim.size - 8; x++) {
      if (countCliffs(sim.grid, { x, y, w: 2, h: 2 }, RULE) === 0 && !validatePlacement(sim.env, 'crag', x, y, 0, true).reasons.some((r) => r !== 'Needs a steep rock face nearby')) { bad = { x, y }; break; }
    }
    expect(bad).not.toBeNull();
    const c = validatePlacement(sim.env, 'crag', bad!.x, bad!.y, 0, true);
    expect(c.ok).toBe(false);
    expect(c.reasons).toContain('Needs a steep rock face nearby');
    expect(c.hintFor['Needs a steep rock face nearby']).toMatch(/3 steep bare-rock tiles within 3 tiles \(0 here\)/);
  });
  it('accepts the foot of a cliff and says how much rock is in reach', () => {
    const sim = mkSim();
    const s = findCragSite(sim);
    expect(s).not.toBeNull();
    const c = validatePlacement(sim.env, 'crag', s!.x, s!.y, 0, true);
    expect(c.ok).toBe(true);
    expect(c.info.some((l) => /Rock face in reach \(\d+ steep rock tiles\)/.test(l))).toBe(true);
  });
  it('is gated in a career game (level 2)', () => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0, money: 5_000_000 });
    const s = findCragSite(mkSim());
    const c = validatePlacement(sim.env, 'crag', s!.x, s!.y, 0, true);
    expect(c.locked ?? c.reasons.join()).toMatch(/Unlocks at level 2/);
  });
});

describe('crag in the sim', () => {
  it('serves guests in summer: $30 per climb, climbers return happier, the inspector says whether an instructor is on duty', () => {
    const sim = mkSim(), id = placeCrag(sim);
    sim.game.date.day = SUMMER; sim.game.date.minute = 11 * 60;
    sim.tick(1);
    const a = sim.attractions.get(id)!;
    expect(a.reason).toBeUndefined();
    expect(a.open).toBe(true);
    const slot = queueGuest(sim, id);
    const store = sim.guestSim.store, b0 = 500; // charged when the climb starts (arrive admits at once while a place is free)
    sim.tick(2);
    expect(a.usersNow).toBe(1);
    expect(b0 - store.budget[slot]!).toBeCloseTo(30, 5);
    sim.tick(CLIMB.serviceTicks + 2);
    expect(a.stats.served).toBe(1);
    expect(a.stats.revenue).toBeCloseTo(30, 5);
    expect(formatAttractionStats(a.info()).join('\n')).toContain('Guided climbs: an instructor is on duty');
  });

  it('is closed in winter ("Closed for the season") and in snow', () => {
    const sim = mkSim(), id = placeCrag(sim);
    sim.game.date.day = seasonStartDay('winter') + 5; sim.game.date.minute = 11 * 60;
    sim.tick(1);
    expect(sim.attractions.get(id)!.open).toBe(false);
    expect(sim.attractions.get(id)!.reason).toMatch(/season|snow/i);
  });

  it('the instructor is optional: without one it stays open at half capacity and the inspector says so', () => {
    const sim = mkSim(), id = placeCrag(sim);
    sim.game.date.day = SUMMER; sim.game.date.minute = 11 * 60;
    sim.tick(1);
    const a = sim.attractions.get(id)!;
    expect(a.capacity()).toBe(8);
    expect(a.guided()).toBe(true);
    a.setStaff(0);
    sim.tick(1);
    expect(a.open).toBe(true);
    expect(a.capacity()).toBe(Math.floor(8 * CLIMB.unguidedShare));
    expect(a.guided()).toBe(false);
    expect(formatAttractionStats(a.info()).join('\n')).toContain('No instructor: half capacity');
    a.setStaff(2);
    expect(a.capacity()).toBe(8); // an extra instructor does not exceed the 8 places
    expect(a.serviceTime()).toBeLessThanOrEqual(CLIMB.serviceTicks);
  });

  it('mishap chances are small and a roll is stateless and deterministic', () => {
    expect(CLIMB.guided).toBeLessThan(CLIMB.unguided);
    expect(CLIMB.unguided).toBeLessThanOrEqual(0.02);
    expect(mishapRoll(3, 4, 5)).toBe(mishapRoll(3, 4, 5));
    const rolls = Array.from({ length: 2000 }, (_, k) => mishapRoll(7, k, 100 + k));
    expect(rolls.every((r) => r >= 0 && r < 1)).toBe(true);
    const hit = rolls.filter((r) => r < CLIMB.guided).length;
    expect(hit).toBeGreaterThan(0);
    expect(hit).toBeLessThan(40);
  });

  it('a mishap opens a MINOR injury incident for the patrol; the climber is looked after, never worse than hospitalised; nobody dies (no such outcome exists)', () => {
    const spec = CLIMBING_SPECS.crag!, keep = spec.mishap;
    spec.mishap = { guided: 1, unguided: 1 }; // force one on every finished climb
    try {
      const sim = mkSim(), id = placeCrag(sim);
      sim.game.date.day = SUMMER; sim.game.date.minute = 11 * 60;
      sim.tick(1);
      const slot = queueGuest(sim, id);
      const gid = sim.guestSim.store.id[slot]!;
      sim.tick(2 + CLIMB.serviceTicks + 1);
      const a = sim.attractions.get(id)!;
      expect(a.stats.mishaps).toBe(1);
      const inc = sim.safety.incidents.open.find((i) => i.guestId === gid);
      expect(inc).toBeDefined();
      expect(inc!.kind).toBe('injury');
      expect(inc!.severity).toBe(Sev.Minor);
      expect(formatAttractionStats(a.info()).join('\n')).toMatch(/1 minor mishap so far/);
      const resolved: string[] = [];
      sim.bus.on('incident:resolved', (e) => { if (e.id === inc!.id) resolved.push(e.outcome); });
      sim.tick(700); // the patrol answers, or the unattended case runs its (hospital) course
      expect(sim.safety.incidents.open.some((i) => i.id === inc!.id)).toBe(false);
      expect(resolved).toHaveLength(1);
      expect(['recovered', 'hospitalised', 'evacuated', 'left']).toContain(resolved[0]);
    } finally { spec.mishap = keep; }
  });

  it('a crag inside the Ski Patrol Hub range is answered by the patrol: the climber recovers', () => {
    const spec = CLIMBING_SPECS.crag!, keep = spec.mishap;
    spec.mishap = { guided: 1, unguided: 1 };
    try {
      const sim = mkSim(5), id = placeCrag(sim, true); // seed 5: valid crag sites inside the starter hub's range
      sim.game.date.day = SUMMER; sim.game.date.minute = 11 * 60;
      sim.tick(1);
      const slot = queueGuest(sim, id);
      const gid = sim.guestSim.store.id[slot]!;
      sim.tick(2 + CLIMB.serviceTicks + 1);
      const inc = sim.safety.incidents.open.find((i) => i.guestId === gid)!;
      expect(inc.severity).toBe(Sev.Minor);
      let outcome = '', responder = '';
      sim.bus.on('incident:resolved', (e) => { if (e.id === inc.id) { outcome = e.outcome; responder = e.responder; } });
      sim.tick(300);
      expect(outcome).toBe('recovered');
      expect(['patrol', 'firstAid']).toContain(responder);
    } finally { spec.mishap = keep; }
  });

  it('is deterministic: same inputs, same stateHash', () => {
    const run = (): string => {
      const sim = mkSim(), id = placeCrag(sim);
      sim.game.date.day = SUMMER; sim.game.date.minute = 11 * 60;
      sim.tick(1);
      for (let k = 0; k < 5; k++) queueGuest(sim, id);
      sim.tick(80);
      return stateHash(sim).hash;
    };
    expect(run()).toBe(run());
  });
});

describe('availability (info; scripts/analysis/cragScan.ts has the full report)', () => {
  it.each([61, 7, 5])('seed %i (64): at least one valid crag site exists', (seed) => {
    expect(findCragSite(mkSim(seed))).not.toBeNull();
  });
});
