import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_BUILDERS, SNOW_NOISE_GLSL, buildParts } from '@/render/meshes';
import { BOX_GROW_MAX, boxGrow } from '@/render/meshes/common';
import { BUILDINGS } from '@/config/buildings';

interface Tri { n: THREE.Vector3; d: number; mn: THREE.Vector3; mx: THREE.Vector3; v: THREE.Vector3[] }
function trisOf(g: THREE.BufferGeometry): Tri[] {
  const pos = g.getAttribute('position'), out: Tri[] = [];
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t), b = new THREE.Vector3().fromBufferAttribute(pos, t + 1), c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.length() < 1e-9) continue;
    n.normalize();
    const mn = a.clone().min(b).min(c), mx = a.clone().max(b).max(c);
    out.push({ n, d: n.dot(a), mn, mx, v: [a, b, c] });
  }
  return out;
}
/** Visible (not down-facing) big axis-aligned faces of different boxes lying in the SAME plane and overlapping: they z-fight under camera motion. */
function coplanarOverlaps(g: THREE.BufferGeometry): number {
  const tris = trisOf(g).filter((t) => t.n.y > -0.5 && Math.max(Math.abs(t.n.x), Math.abs(t.n.y), Math.abs(t.n.z)) > 0.999);
  let bad = 0;
  for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
    const a = tris[i]!, b = tris[j]!;
    if (a.n.dot(b.n) < 0.999 || Math.abs(a.d - b.d) > 1e-5) continue;
    if (a.v.filter((p) => b.v.some((q) => p.distanceTo(q) < 1e-6)).length >= 1) continue; // same primitive (quad halves, cylinder cap fans)
    const ox = Math.min(a.mx.x, b.mx.x) - Math.max(a.mn.x, b.mn.x), oy = Math.min(a.mx.y, b.mx.y) - Math.max(a.mn.y, b.mn.y), oz = Math.min(a.mx.z, b.mx.z) - Math.max(a.mn.z, b.mn.z);
    if (ox < -1e-6 || oy < -1e-6 || oz < -1e-6) continue;
    const dims = [ox, oy, oz].filter((v) => v > 0.02).length;
    if (dims >= 2) { bad++; if (process.env.DBG) console.log(a.n.toArray().map((x) => x.toFixed(2)).join(','), a.d.toFixed(5), b.d.toFixed(5), a.mn.toArray().map((x) => x.toFixed(2)).join(','), a.mx.toArray().map((x) => x.toFixed(2)).join(','), '|', b.mn.toArray().map((x) => x.toFixed(2)).join(','), b.mx.toArray().map((x) => x.toFixed(2)).join(',')); }
  }
  return bad;
}

describe('snow / coplanar flicker (user report: flicker on snow patches under a building)', () => {
  it('box growth is strictly increasing then capped (later parts win coplanar ties)', () => {
    expect(boxGrow(0)).toBe(0);
    for (let i = 1; i < 200; i++) expect(boxGrow(i)).toBeGreaterThan(boxGrow(i - 1));
    expect(boxGrow(100000)).toBe(BOX_GROW_MAX);
    expect(BOX_GROW_MAX).toBeLessThan(0.02);
  });

  it('roof snow noise is smooth value noise (no floor()-quantised hash squares)', () => {
    expect(SNOW_NOISE_GLSL).toMatch(/f \* f \* \(3\.0 - 2\.0 \* f\)/);
    expect(SNOW_NOISE_GLSL).not.toMatch(/floor\(p/);
  });

  it('base lodge: no coplanar overlapping visible faces between different boxes (the flickering parallelograms)', () => {
    const def = BUILDINGS.baseLodge!;
    const parts = buildParts(def.meshBuilder, def.w, def.h);
    expect(coplanarOverlaps(parts.wood!)).toBe(0);
  });

  it('no building has coplanar overlapping visible faces in a layer (all builders)', () => {
    const bad: string[] = [];
    for (const id of Object.keys(BUILDING_BUILDERS)) {
      const def = BUILDINGS[id];
      if (!def) continue;
      const p = buildParts(def.meshBuilder, def.w, def.h);
      for (const l of ['wood', 'stone', 'roof'] as const) { const g = p[l]; if (g && coplanarOverlaps(g) > 0) bad.push(`${id}.${l}:${coplanarOverlaps(g)}`); }
    }
    expect(bad).toEqual([]);
  });
});
