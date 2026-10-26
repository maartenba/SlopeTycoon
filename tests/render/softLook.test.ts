import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { MIN_PART_THICKNESS, TREE_SPECIES, createImpostorAtlas, tier } from '../../src/render/props/Trees';
import { nearTreeGeometry } from '../../src/render/props/NearTrees';
import { PropKind } from '../../src/world/Props';
import { CANOPY } from '../../src/world/TreeHeights';
import { PartBuilder, MIN_THIN, chamferBox, doorway, chimney } from '../../src/render/meshes/common';
import { createBearGeometry, createCowGeometry } from '../../src/render/meshes/Animals';

/** "Softer look" pass (docs/models.md): rounder crowns / tiers, smooth normals, thicker thin parts, impostors regenerated to match. */
const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;
const finite = (g: THREE.BufferGeometry): boolean => { for (const n of ['position', 'normal'] as const) { const a = g.getAttribute(n).array as Float32Array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return false; } return true; };
/** Triangle budget per species (full / low LOD): old meshes were 62-192 / 10-44. The rounder crowns (3-4 lumpy welded lobes, 4-5 scalloped tiers, smooth normals) are spent inside the same budget:
 * open-ended trunks / branches (-12 tris each) pay for them. Low conifers grow 10 -> 14 (2 stacked tiers instead of one cone). */
const FULL_MAX = 150, LOW_MAX = 60;

describe('tree meshes (soft look)', () => {
  it('are finite, unit-normal, inside the sim canopy table, within the triangle budget', () => {
    for (const sp of TREE_SPECIES) for (const full of [true, false]) {
      const g = full ? sp.full() : sp.low();
      expect(finite(g), `${sp.kind}`).toBe(true);
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i += 7) expect(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1), `normal ${sp.kind}`).toBeLessThan(1e-3);
      g.computeBoundingBox();
      const b = g.boundingBox!, c = CANOPY[sp.kind]!;
      expect(b.min.y, `${sp.kind}`).toBeGreaterThanOrEqual(-0.03); // shrub lobes sink a hair into the ground
      expect(b.max.y, `${sp.kind}`).toBeLessThanOrEqual(c.height + 1e-6);
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z), `${sp.kind}`).toBeLessThanOrEqual(c.radius + 0.011);
      expect(tris(g), `${sp.kind} ${full ? 'full' : 'low'}`).toBeLessThanOrEqual(full ? FULL_MAX : LOW_MAX);
      expect(tris(g)).toBeGreaterThanOrEqual(14);
    }
  });

  it('thickness guard: every declared thin part (trunk top, branch tip, twig) is >= MIN_PART_THICKNESS', () => {
    expect(MIN_PART_THICKNESS).toBeGreaterThanOrEqual(0.03);
    for (const sp of TREE_SPECIES) for (const g of [sp.full(), sp.low()]) expect(g.userData.minThick as number, `${sp.kind}`).toBeGreaterThanOrEqual(MIN_PART_THICKNESS - 1e-9);
    // near (ground) trees declare their limbs through the same guard-free path but must keep trunks >= 0.03
    for (const k of [PropKind.Conifer, PropKind.Deciduous, PropKind.Oak, PropKind.Snag]) expect(finite(nearTreeGeometry(k)!)).toBe(true);
  });

  it('conifers have 4-6 scalloped tiers (10-14 radial segments), deciduous crowns 3-5 overlapping lobes', () => {
    for (const sp of TREE_SPECIES) {
      if (sp.recipe.tiers && sp.kind !== PropKind.Larch && sp.kind !== PropKind.Pine) expect(sp.recipe.tiers.length).toBeGreaterThanOrEqual(4);
      if (sp.recipe.tiers) expect(sp.recipe.tiers.length).toBeLessThanOrEqual(6);
      if (sp.recipe.blobs) expect(sp.recipe.blobs.length).toBeGreaterThanOrEqual(2);
    }
    const t = tier(0.5, 0.8, 0.3, 12, 1, true, true);
    expect(t).toHaveLength(2);
    const pos = t[0]!.geo.getAttribute('position');
    expect(pos.count).toBe(1 + 2 * 12); // apex + shoulder ring + hem ring
    // scalloped hem: ring radii vary (per-vertex noise + alternating droop)
    const radii = new Set<string>(); for (let i = 1 + 12; i < pos.count; i++) radii.add(Math.hypot(pos.getX(i), pos.getZ(i)).toFixed(3));
    expect(radii.size).toBeGreaterThan(4);
  });

  it('smooth crowns: welded vertices share one normal (no facet creases inside a lobe)', () => {
    const g = TREE_SPECIES.find((s) => s.kind === PropKind.Oak)!.full();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), a = g.getAttribute('aBase');
    const seen = new Map<string, THREE.Vector3>(); let shared = 0;
    for (let i = 0; i < p.count; i++) {
      if (a.getW(i) < 0.5) continue;
      const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`, v = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
      const o = seen.get(key);
      if (o) { shared++; expect(o.distanceTo(v)).toBeLessThan(1e-3); } else seen.set(key, v);
    }
    expect(shared).toBeGreaterThan(100);
  });
});

describe('thin building parts', () => {
  it('beams, bunting cords and fence rails never get thinner than MIN_THIN', () => {
    expect(MIN_THIN).toBeGreaterThanOrEqual(0.03);
    const b = new PartBuilder(4, 4).beam(0, 0, 0, 1, 0, 0, 0.005, 0xffffff);
    const g = b.finish().stone!; g.computeBoundingBox();
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeGreaterThanOrEqual(MIN_THIN - 1e-6);
  });
  it('chamfered box, arched door and round chimney are finite and arch rises above the door rectangle', () => {
    expect(finite(chamferBox(1, 1, 1, 0.07))).toBe(true);
    const b = new PartBuilder(4, 4); doorway(b, 0, 1, 's'); chimney(b, 0, 1, 0, 0.5);
    const p = b.finish();
    for (const g of [p.wood!, p.stone!]) { expect(finite(g)).toBe(true); g.computeBoundingBox(); }
    // chimney cap top is exactly y + hgt
    expect(p.stone!.boundingBox!.max.y).toBeCloseTo(1.5, 5);
  });
  it('rounded animals stay finite', () => { expect(finite(createBearGeometry())).toBe(true); expect(finite(createCowGeometry())).toBe(true); });
});

describe('impostor atlas', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('draws every species x (normal, snow, bare) cell with scalloped tiers and lumpy blobs', () => {
    const calls = { fill: 0, quad: 0, ellipse: 0 };
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'fill' ? () => { calls.fill++; } : k === 'quadraticCurveTo' ? () => { calls.quad++; } : k === 'ellipse' ? () => { calls.ellipse++; } : () => undefined), set: () => true });
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    vi.stubGlobal('document', { createElement: () => canvas });
    createImpostorAtlas();
    expect(canvas.width).toBe(64 * TREE_SPECIES.length * 3);
    expect(canvas.height).toBe(128);
    expect(calls.fill).toBeGreaterThan(TREE_SPECIES.length * 3);
    expect(calls.quad).toBeGreaterThan(20); // scalloped hems
    expect(calls.ellipse).toBeGreaterThan(10); // multi-lobe crowns
  });
});
