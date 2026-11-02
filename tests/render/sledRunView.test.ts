import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Grid } from '../../src/world/Grid';
import { Buildings } from '../../src/sim/Buildings';
import { Networks, Layer } from '../../src/world/Networks';
import { SledRunView, STAKE_SPACING } from '../../src/render/SledRunView';
import { COASTER_RAIL, sledGeometry, coasterGeometry } from '../../src/render/TourVehicles';

const make = () => {
  const grid = new Grid(64);
  for (let vy = 0; vy < grid.vsize; vy++) for (let vx = 0; vx < grid.vsize; vx++) grid.setCornerUnchecked(vx, vy, Math.max(0, 80 - vy));
  const net = new Networks(grid, new Buildings(grid.occupancy));
  return { grid, net, view: new SledRunView(grid, net) };
};
const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;

describe('SledRunView', () => {
  it('draws nothing without a run; one merged mesh (one draw call) once a run is painted; rebuilds only on change', () => {
    const { net, view } = make();
    view.update();
    expect(view.group.children.length).toBe(0);
    net.paint(Layer.Sled, Array.from({ length: 12 }, (_, k) => ({ x: 20, y: 10 + k })));
    view.update();
    expect(view.group.children.length).toBe(1);
    expect(view.tiles.sled).toBe(12);
    expect(view.stakes).toBe(Math.ceil(12 / STAKE_SPACING)); // greedy spacing along a straight line
    const mesh = view.group.children[0] as THREE.Mesh;
    view.update();
    expect(view.group.children[0]).toBe(mesh);
    expect(view.triangles).toBeLessThan(12 * 80);
  });
  it('the lane follows the ground (never below it) and coaster rails ride COASTER_RAIL above it', () => {
    const { net, view } = make();
    net.paint(Layer.Sled, Array.from({ length: 6 }, (_, k) => ({ x: 10, y: 10 + k })));
    net.paint(Layer.Coaster, Array.from({ length: 6 }, (_, k) => ({ x: 30, y: 10 + k })));
    view.update();
    const pos = (view.group.children[0] as THREE.Mesh).geometry.attributes.position!;
    let minLane = Infinity, maxRail = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < 20) minLane = Math.min(minLane, y - (80 - (z) ) * 0.5);
      else maxRail = Math.max(maxRail, y - (80 - z) * 0.5);
    }
    expect(minLane).toBeGreaterThan(-0.2);
    expect(maxRail).toBeGreaterThanOrEqual(COASTER_RAIL - 0.1);
  });
  it('vehicle models stay small (sled < 300, coaster car < 300 triangles)', () => {
    expect(tris(sledGeometry())).toBeLessThan(300);
    expect(tris(coasterGeometry())).toBeLessThan(300);
  });
});
