import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeResort } from '../game/harness';
import { SpringMarkers } from '../../src/render/SpringMarkers';
import { Overlays } from '../../src/render/Overlays';
import { planRiver } from '../../src/world/RiverPlanner';
import { applySpring, planSpring } from '../../src/world/Rivers';

describe('SpringMarkers (Landscape > Water tab)', () => {
  it('one instanced mesh (one draw call), hidden until shown, one instance per spring, rebuilt only when the springs change', () => {
    const { sim } = makeResort(64, 61);
    const m = new SpringMarkers(sim.grid, sim.rivers);
    expect(m.group.visible).toBe(false);
    expect(m.group.children).toHaveLength(1);
    expect(m.group.children[0]).toBeInstanceOf(THREE.InstancedMesh);
    expect(m.count()).toBe(0); // nothing is built while hidden
    m.setVisible(true);
    expect(m.group.visible).toBe(true);
    expect(m.count()).toBe(sim.rivers.natural.length);
    expect(m.count()).toBeGreaterThanOrEqual(1);
    const env = sim.riverEnv();
    let n = 0;
    for (let y = 8; y < 56 && !n; y++) for (let x = 8; x < 56 && !n; x++) { const p = planSpring(env, sim.rivers, x, y); if (p.ok) { applySpring(env, sim.rivers, p); n++; } }
    m.update();
    expect(m.count()).toBe(sim.rivers.natural.length + 1);
    const idx = (m.group.children[0] as THREE.InstancedMesh).geometry.getIndex()?.count ?? 0;
    expect(idx).toBeLessThan(300); // a tiny marker
    m.setVisible(false); expect(m.group.visible).toBe(false);
    m.dispose();
  });
});

describe('Overlays.setRiverGhost', () => {
  it('draws the channel outline + cut ticks into the shared preview buffer and clears with null / hide()', () => {
    const { sim } = makeResort(64, 61);
    const ov = new Overlays(sim.grid), s = sim.rivers.natural[0]!, plan = planRiver(sim.riverEnv(), s);
    expect(plan.ok).toBe(true);
    const lines = ov.group.children.filter((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments[];
    const prev = lines.find((l) => l.renderOrder === 9)!;
    ov.setRiverGhost(plan.path, plan.carveDepth, plan.changed, 6);
    expect(ov.group.visible).toBe(true);
    expect(prev.geometry.drawRange.count).toBeGreaterThan(plan.path.length * 2);
    ov.setRiverGhost(null);
    expect(prev.geometry.drawRange.count).toBe(0);
    ov.setRiverGhost(plan.path, plan.carveDepth, plan.changed); ov.hide();
    expect(prev.geometry.drawRange.count).toBe(0);
    ov.dispose();
  });
});
