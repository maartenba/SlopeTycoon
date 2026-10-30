import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '@/config/buildings';
import { BUILDING_BUILDERS, BuildingMeshes, buildParts, tintVariant } from '@/render/meshes';

const defs = Object.values(BUILDINGS);
const geoList = (p: ReturnType<typeof buildParts>): THREE.BufferGeometry[] =>
  [p.wood, p.stone, p.roof, p.sign?.geometry].filter((g): g is THREE.BufferGeometry => !!g);
/** Triangle budget: ~3,000 for small buildings (footprint <= 6 tiles), ~9,000 for big ones. Richer detail (framed windows, props, timber) needs room. */
export const triBudget = (w: number, h: number): number => (w * h <= 6 ? 3000 : 9000);
const sig = (p: ReturnType<typeof buildParts>): string =>
  geoList(p).map((g) => Array.from(g.getAttribute('position').array as Float32Array).map((v) => v.toFixed(3)).join(',')).join('|');

describe('building meshes', () => {
  it('has a builder for every catalog meshBuilder id', () => {
    for (const d of defs) expect(BUILDING_BUILDERS[d.meshBuilder], d.id).toBeDefined();
  });

  it('fits the footprint (overhang tolerance) and stays in triangle budget', () => {
    for (const d of defs) {
      const box = new THREE.Box3();
      let tris = 0;
      for (const g of geoList(buildParts(d.meshBuilder, d.w, d.h))) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
        tris += g.getAttribute('position').count / 3;
      }
      const tol = 0.6;
      expect(box.min.x, d.id).toBeGreaterThanOrEqual(-d.w / 2 - tol);
      expect(box.max.x, d.id).toBeLessThanOrEqual(d.w / 2 + tol);
      expect(box.min.z, d.id).toBeGreaterThanOrEqual(-d.h / 2 - tol);
      expect(box.max.z, d.id).toBeLessThanOrEqual(d.h / 2 + tol);
      expect(box.max.y, d.id).toBeGreaterThan(0.2);
      expect(box.max.y, d.id).toBeLessThan(4);
      expect(tris, d.id).toBeLessThan(triBudget(d.w, d.h));
    }
  });

  it('chimney offsets from the catalog lie inside the bounding box and on a chimney top vertex', () => {
    let n = 0;
    for (const d of defs) {
      if (!d.chimney) continue;
      n++;
      const p = buildParts(d.meshBuilder, d.w, d.h);
      const box = new THREE.Box3();
      let found = false;
      for (const g of geoList(p)) {
        g.computeBoundingBox(); box.union(g.boundingBox!);
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count && !found; i++) {
          if (Math.abs(pos.getY(i) - d.chimney.y) < 0.021 && Math.hypot(pos.getX(i) - d.chimney.x, pos.getZ(i) - d.chimney.z) < 0.2) found = true;
        }
      }
      expect(box.containsPoint(new THREE.Vector3(d.chimney.x, d.chimney.y - 0.05, d.chimney.z)), d.id).toBe(true);
      expect(found, `${d.id} has no vertex at its chimney top`).toBe(true);
    }
    expect(n).toBe(14); // + biomassHeating (item F), + campground (campfire smoke, Phase 6 Task 19), + small hotel (kitchen chimney) and coffee stand (espresso flue, Phase 6 Tasks 27 / 28); the luxury hotel steams through `BuildingDef.steam`
  });

  it('keeps the glass vertex-colour convention (warm night glow) in every habitable building', () => {
    const glass = new THREE.Color(0x6fb7e0);
    for (const id of ['baseLodge', 'lodge', 'cafe', 'chalet', 'apartment', 'shop', 'mountainHut', 'alpineFarm', 'apresBar']) {
      const d = BUILDINGS[id]!;
      let n = 0;
      for (const g of geoList(buildParts(d.meshBuilder, d.w, d.h))) {
        const c = g.getAttribute('color');
        if (!c) continue;
        for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - glass.r) + Math.abs(c.getY(i) - glass.g) + Math.abs(c.getZ(i) - glass.b) < 0.01) n++;
      }
      expect(n, id).toBeGreaterThan(24);
    }
  });

  it('snow uniform drives every layer material and per-instance tints are deterministic', () => {
    const reg = new BuildingMeshes();
    const g = reg.create('chalet', undefined, 17);
    const again = reg.create('chalet', undefined, 17);
    expect(tintVariant(17)).toBe(tintVariant(17));
    expect(tintVariant(0)).toBe(0);
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((i) => tintVariant(i))).size).toBeGreaterThan(1);
    expect((g.children[0] as THREE.Mesh).material).toBe((again.children[0] as THREE.Mesh).material);
    reg.setSnow(0.7);
    for (const m of g.children as THREE.Mesh[]) expect(m.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(reg.snow.value).toBeCloseTo(0.7);
    reg.setNight(3);
    expect(reg.night.value).toBe(1);
    reg.dispose();
  });

  it('reports triangle counts per type (largest / smallest)', () => {
    const rows = defs.map((d) => ({ id: d.id, tris: geoList(buildParts(d.meshBuilder, d.w, d.h)).reduce((a, g) => a + g.getAttribute('position').count / 3, 0) }));
    rows.sort((a, b) => b.tris - a.tris);
    // eslint-disable-next-line no-console
    if (process.env.MODEL_STATS) console.log(rows.map((r) => `${r.id}:${r.tris}`).join(' '));
    expect(rows[0]!.tris).toBeLessThan(9000);
    expect(rows[rows.length - 1]!.tris).toBeGreaterThan(100);
  });

  it('foundation extends below ground by the requested depth', () => {
    const p = buildParts('chalet', 3, 3, 0.7);
    p.stone!.computeBoundingBox();
    expect(p.stone!.boundingBox!.min.y).toBeCloseTo(-0.7, 5);
  });

  it('creates groups in node with ≤4 meshes, no textures needed', () => {
    const reg = new BuildingMeshes();
    for (const d of defs) {
      const g = reg.create(d.id);
      expect(g.children.length, d.id).toBeGreaterThan(0);
      expect(g.children.length, d.id).toBeLessThanOrEqual(4);
    }
    reg.setSnow(2);
    expect(reg.snow.value).toBe(1);
    reg.dispose();
  });

  it('is deterministic and every building is distinct', () => {
    const seen = new Map<string, string>();
    for (const d of defs) {
      const a = sig(buildParts(d.meshBuilder, d.w, d.h));
      expect(sig(buildParts(d.meshBuilder, d.w, d.h)), d.id).toBe(a);
      expect(seen.get(a), `${d.id} duplicates ${seen.get(a)}`).toBeUndefined();
      seen.set(a, d.id);
    }
  });
});
