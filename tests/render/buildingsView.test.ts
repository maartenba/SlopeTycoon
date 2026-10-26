import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSim } from '@/game/createSim';
import { BuildingMeshes } from '@/render/meshes';
import { BuildingsView } from '@/render/BuildingsView';
import { placeBuilding, baseHeight } from '@/sim/PlaceBuilding';
import { bulldoze } from '@/build/Bulldoze';

const setup = (seed = 3) => {
  const sim = createSim({ size: 64, seed });
  const scene = new THREE.Scene();
  const view = new BuildingsView(scene, new BuildingMeshes(), sim.grid, sim.buildings);
  return { sim, scene, view };
};
const meshesInScene = (scene: THREE.Scene): THREE.Object3D[] => scene.children.filter((c) => c.name.startsWith('building:'));

describe('BuildingsView', () => {
  it('creates a mesh for the boot Base Lodge at its footprint, on the terrain', () => {
    const { sim, scene, view } = setup();
    expect(scene.children.length).toBe(0); // nothing before sync (boot buildings exist in the store only)
    view.sync();
    const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
    expect(lodge).toBeTruthy();
    const g = view.get(lodge.id)!;
    expect(g).toBeTruthy();
    expect(g.name).toBe('building:baseLodge');
    expect(g.parent).toBe(scene);
    expect(g.position.x).toBeCloseTo(lodge.x + lodge.w / 2);
    expect(g.position.z).toBeCloseTo(lodge.y + lodge.h / 2);
    expect(g.position.y).toBeCloseTo(baseHeight(sim.grid, lodge.x, lodge.y, lodge.w, lodge.h));
    expect(g.children.length).toBeGreaterThan(0);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.isEmpty()).toBe(false);
  });

  it('keeps exactly one mesh per building and is idempotent', () => {
    for (const seed of [1, 3, 9]) {
      const { sim, scene, view } = setup(seed);
      view.sync(); view.sync(); view.sync();
      const all = sim.buildings.all();
      expect(meshesInScene(scene).length).toBe(all.length);
      expect(view.size).toBe(all.length);
      for (const b of all) expect(view.get(b.id)).toBeDefined();
      expect(new Set(meshesInScene(scene)).size).toBe(all.length);
    }
  });

  it('follows place, rotate and remove', () => {
    const { sim, scene, view } = setup();
    view.sync();
    const lodge = sim.buildings.all()[0]!;
    // find a free spot for a rectangular building via placeBuilding probing
    let placed = null as ReturnType<typeof placeBuilding> | null;
    for (let r = 6; r < 20 && !placed?.ok; r++) {
      for (let dx = -r; dx <= r && !placed?.ok; dx += 2) placed = placeBuilding(sim.env, sim.props, 'rental', lodge.x + dx, lodge.y + r, 0, true, true);
    }
    expect(placed?.ok).toBe(true);
    const b = placed!.building!;
    view.sync();
    expect(meshesInScene(scene).length).toBe(sim.buildings.size);
    const g = view.get(b.id)!;
    expect(g.rotation.y).toBeCloseTo(0);
    sim.buildings.rotate(b.id, 1, b.x, b.y);
    view.sync();
    expect(view.get(b.id)).toBe(g); // same group, re-seated
    expect(g.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(g.position.x).toBeCloseTo(b.x + b.w / 2);
    // terraform under it: re-seated on the next sync
    const before = g.position.y;
    sim.grid.setCornerUnchecked(b.x, b.y, sim.grid.getCorner(b.x, b.y) - 4);
    view.sync();
    const g2 = view.get(b.id)!; // a deeper plinth (bigger corner spread) rebuilds the mesh; the pad stays on the highest corner
    expect(g2.position.y).toBeCloseTo(before);
    expect(g2).not.toBe(g);
    expect(meshesInScene(scene).length).toBe(sim.buildings.size); // old group removed
    bulldoze(sim.buildings, sim.economy, b.id);
    view.sync();
    expect(view.get(b.id)).toBeUndefined();
    expect(meshesInScene(scene).length).toBe(sim.buildings.size);
  });
});
