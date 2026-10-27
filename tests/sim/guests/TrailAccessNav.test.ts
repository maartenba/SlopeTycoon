/** Phase 6 Task 2: a hike-mode guest can reach the trail tile beside a trail-served building; skiers (no snow-free walkable trail) cannot. */
import { describe, it, expect } from 'vitest';
import { NavMode } from '../../../src/sim/guests/NavGraph';
import { Fixture } from './resortFixture';

const T = (f: Fixture, x: number, y: number): number => y * f.size + x;

describe('trail-served building: navigation', () => {
  it('hikers walk the path, then the trail, to the tile beside a hut on the trail', () => {
    const f = new Fixture(64);
    f.path(4, 50, 60, 50);
    f.trail('hike', 20, 30, 20, 49);
    f.setSnowline(0);
    const g = f.graph(); g.update(0);
    // the hut footprint is x 21-22, y 34-35: its entrance tile is the trail tile (20, 35)
    const r = g.pf.find(NavMode.Hike, T(f, 10, 50), T(f, 20, 35));
    expect(r).not.toBeNull();
    // with snow over the trail (winter) hikers cannot reach it
    f.setSnowline(60); g.update(1);
    expect(g.pf.find(NavMode.Hike, T(f, 10, 50), T(f, 20, 35))).toBeNull();
  });
});
