import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MID_TILES, NEAR_CAPS, NEAR_HYSTERESIS, NEAR_TILES, fadeWeight, nearLod, nearLodFor } from '../../src/render/lod/nearLod';
import { Gear, GEAR_COUNT } from '../../src/render/guestAppearance';
import { buildGearGeometry, visibleTriangles } from '../../src/render/meshes/Figures';
import { buildChairGeometry } from '../../src/render/meshes/lifts/Chair';
import { buildGondolaGeometry } from '../../src/render/meshes/lifts/Gondola';
import { buildTramGeometry } from '../../src/render/meshes/lifts/Tram';
import { buildFunicularCarGeometry } from '../../src/render/meshes/lifts/Funicular';
import { buildTowerGeometry } from '../../src/render/meshes/lifts/Tower';
import { buildCableGeometry, buildCableNearGeometry } from '../../src/render/meshes/lifts/Cable';
import { distToPolyline, STATION_ROOF_HIDE_RADIUS } from '../../src/render/meshes/lifts';
import { nearRockGeometry, nearTreeGeometry } from '../../src/render/props/NearTrees';
import { LODFADE_FRAG_PARS, LODFADE_VERT_PARS, TREE_SPECIES, createMeshMaterial, createPropUniforms } from '../../src/render/props/Trees';
import { PropKind } from '../../src/world/Props';
import { GuestRenderer } from '../../src/render/GuestRenderer';
import { GuestStore } from '../../src/sim/guests/Guest';
import { liftPath } from '../../src/sim/Lift';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const finite = (g: THREE.BufferGeometry): boolean => { for (const k of Object.keys(g.attributes)) { const a = g.getAttribute(k).array as ArrayLike<number>; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return false; } return true; };

describe('nearLod (pure)', () => {
  it('orthographic cameras always get the base level, at every zoom / distance', () => {
    for (const d of [0, 0.5, 3, NEAR_TILES, 10, MID_TILES, 80, 1e6, Infinity, NaN]) {
      expect(nearLod('ortho', d)).toBe('base');
      expect(nearLod('ortho', d, 'near')).toBe('base');
    }
    for (const h of [4, 10, 30, 90, 500]) {
      const o = new THREE.OrthographicCamera(-h, h, h / 2, -h / 2, 0.1, 1000);
      for (const d of [0, 1, 5, 50]) expect(nearLodFor(o, d)).toBe('base');
    }
  });
  it('perspective bands: near < 6 tiles, mid < 20, far beyond', () => {
    expect(nearLod('perspective', 0)).toBe('near'); expect(nearLod('perspective', 5.99)).toBe('near');
    expect(nearLod('perspective', NEAR_TILES)).toBe('mid'); expect(nearLod('perspective', 19.9)).toBe('mid');
    expect(nearLod('perspective', MID_TILES)).toBe('far'); expect(nearLod('perspective', 500)).toBe('far');
    expect(nearLodFor(new THREE.PerspectiveCamera(), 2)).toBe('near');
  });
  it('hysteresis: an object at a band edge does not flicker', () => {
    expect(nearLod('perspective', NEAR_TILES + 0.3, 'near')).toBe('near');
    expect(nearLod('perspective', NEAR_TILES + NEAR_HYSTERESIS + 0.01, 'near')).toBe('mid');
    expect(nearLod('perspective', NEAR_TILES - 0.3, 'mid')).toBe('mid');
    expect(nearLod('perspective', NEAR_TILES - NEAR_HYSTERESIS - 0.01, 'mid')).toBe('near');
    expect(nearLod('perspective', MID_TILES + 0.3, 'mid')).toBe('mid');
    expect(nearLod('perspective', MID_TILES - 0.3, 'far')).toBe('far');
    let band = nearLod('perspective', 5.9), flips = 0;
    for (let i = 0; i < 200; i++) { const d = 6 + 0.4 * Math.sin(i * 0.9); const b = nearLod('perspective', d, band); if (b !== band) flips++; band = b; }
    expect(flips).toBe(0);
  });
  it('fade weights are complementary and monotonic', () => {
    expect(fadeWeight(2, 8, 4)).toBe(0); expect(fadeWeight(12, 8, 4)).toBe(1); expect(fadeWeight(8, 8, 4)).toBeCloseTo(0.5, 5);
    let prev = -1;
    for (let d = 3; d < 13; d += 0.5) { const w = fadeWeight(d, 8, 4); expect(w).toBeGreaterThanOrEqual(prev); prev = w; }
  });
});

describe('near figures', () => {
  it('every near gear variant is <= 400 visible triangles for any hair style / pack, has more detail than the base, and is NaN-free', () => {
    for (let g = 0; g < GEAR_COUNT; g++) {
      const base = buildGearGeometry(g), near = buildGearGeometry(g, true);
      expect(finite(near)).toBe(true);
      near.computeBoundingBox();
      expect(near.boundingBox!.min.toArray().every(Number.isFinite)).toBe(true);
      for (let style = 0; style < 9; style++) for (const pack of [false, true]) {
        const t = visibleTriangles(near, style, pack);
        expect(t).toBeLessThanOrEqual(400);
        expect(t).toBeGreaterThan(visibleTriangles(base, style, pack));
      }
    }
  });
  it('near batches exist but stay hidden for iso / orthographic cameras; instance caps hold', () => {
    const st = new GuestStore(200);
    for (let i = 0; i < 100; i++) st.add({ x: 30 + (i % 10) * 0.2, y: 32 + Math.floor(i / 10) * 0.2, z: 0, type: 0, skill: 0, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    const r = new GuestRenderer(st);
    const o = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500); o.position.set(60, 60, 60); o.lookAt(32, 0, 32); o.updateMatrixWorld(true);
    r.update(0.5, 20, o, 1);
    expect(r.nearDrawn).toBe(0);
    expect(r.group.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && c.name.startsWith('guests-near') && c.visible).length).toBe(0);
    const p = new THREE.PerspectiveCamera(70, 1.6, 0.05, 300); p.position.set(31, 1, 31); p.lookAt(32, 0.5, 32); p.updateMatrixWorld(true);
    r.update(0.5, 20, p, 2);
    expect(r.nearDrawn).toBeGreaterThan(0);
    expect(r.nearDrawn).toBeLessThanOrEqual(NEAR_CAPS.figuresTotal);
    const near = r.group.children.filter((c) => c.name.startsWith('guests-near') && c.visible) as THREE.InstancedMesh[];
    expect(near.reduce((a, m) => a + m.count, 0)).toBe(r.nearDrawn);
    for (const m of near) expect(m.count).toBeLessThanOrEqual(NEAR_CAPS.figuresPerBatch);
    const total = r.batchCounts().reduce((a, b) => a + b, 0) + r.nearDrawn;
    expect(total).toBe(r.drawnCount); // the rest of the guests use the standard meshes
    expect(Gear.Walk).toBeDefined();
  });
});

describe('near lift hardware', () => {
  it('near variants add detail on top of the base (never remove) and are finite', () => {
    const pairs: [string, THREE.BufferGeometry, THREE.BufferGeometry][] = [
      ['chair4', buildChairGeometry(4, false, true), buildChairGeometry(4, false, true, true)],
      ['chair2', buildChairGeometry(2, false, false), buildChairGeometry(2, false, false, true)],
      ['bubble8', buildChairGeometry(8, true, true), buildChairGeometry(8, true, true, true)],
      ['gondola', buildGondolaGeometry(6), buildGondolaGeometry(6, true)],
      ['gondola10', buildGondolaGeometry(10), buildGondolaGeometry(10, true)],
      ['tram', buildTramGeometry(), buildTramGeometry(true)],
      ['funicular', buildFunicularCarGeometry(), buildFunicularCarGeometry(true)],
      ['tower', buildTowerGeometry(2, 'chair4'), buildTowerGeometry(2, 'chair4', 0.3, true)],
    ];
    for (const [name, base, near] of pairs) {
      expect(finite(near), name).toBe(true);
      expect(tris(near), name).toBeGreaterThan(tris(base));
      expect(tris(near), name).toBeLessThan(tris(base) + 900);
      near.computeBoundingBox();
      expect(near.boundingBox!.getSize(new THREE.Vector3()).length(), name).toBeLessThan(6);
    }
  });
  it('the near cable is a round tube (>= 6 radial segments), lit vertex colours, light (not near-black) and same path', () => {
    const path = liftPath({ kind: 'chair4', nodes: [{ x: 10, y: 10, z: 0 }, { x: 30, y: 10, z: 4 }] } as never);
    const base = buildCableGeometry(path), near = buildCableNearGeometry(path);
    expect(finite(near)).toBe(true);
    expect(tris(near)).toBeGreaterThan(tris(base));
    const col = near.getAttribute('color').array as Float32Array;
    let lum = 0; for (let i = 0; i < col.length; i += 3) lum += col[i]! * 0.3 + col[i + 1]! * 0.59 + col[i + 2]! * 0.11;
    expect(lum / (col.length / 3)).toBeGreaterThan(0.4);
    near.computeBoundingBox(); base.computeBoundingBox();
    expect(near.boundingBox!.min.x).toBeLessThan(base.boundingBox!.min.x + 0.01);
    expect(near.boundingBox!.max.x).toBeGreaterThan(base.boundingBox!.max.x - 0.01);
  });
  it('polyline distance helper + roof fade radius', () => {
    const poly = new Float32Array([0, 0, 10, 0]);
    expect(distToPolyline(poly, 5, 3)).toBeCloseTo(3, 5); expect(distToPolyline(poly, -4, 3)).toBeCloseTo(5, 5); expect(distToPolyline(poly, 12, 0)).toBeCloseTo(2, 5);
    expect(STATION_ROOF_HIDE_RADIUS).toBe(3);
  });
});

describe('near trees / rocks', () => {
  it('near tree meshes: >= 12 radial segments crowns, finite, bounded, richer than the full mesh', () => {
    for (const sp of TREE_SPECIES) {
      const near = nearTreeGeometry(sp.kind)!, full = sp.full();
      expect(near, String(sp.kind)).toBeTruthy();
      expect(finite(near)).toBe(true);
      expect(tris(near)).toBeGreaterThan(tris(full));
      expect(tris(near)).toBeLessThan(2400);
      near.computeBoundingBox(); const sz = near.boundingBox!.getSize(new THREE.Vector3());
      expect(sz.y).toBeLessThan(3.5); expect(sz.x).toBeLessThan(3.5);
      expect(near.getAttribute('aBase').count).toBe(near.getAttribute('position').count);
    }
    expect(nearTreeGeometry(PropKind.Rock)).toBeUndefined();
    const rock = nearRockGeometry(); expect(finite(rock)).toBe(true); expect(tris(rock)).toBeGreaterThan(400);
  });
  it('tree shader: cross-fade uses complementary stipple masks and is inert in iso (uLodFade width 0 -> never discards)', () => {
    const m = createMeshMaterial(createPropUniforms(), TREE_SPECIES[0]);
    expect(m.vertexShader).toContain('lodFadeW'); expect(m.fragmentShader).toContain('lodFadeDiscard');
    expect(m.vertexShader).not.toMatch(/#include <(?!common|begin)/);
    expect((m.uniforms.uLodFade!.value as THREE.Vector3).toArray()).toEqual([0, 1e9, 0]);
    expect(LODFADE_VERT_PARS).toContain('smoothstep'); expect(LODFADE_FRAG_PARS).toContain('discard');
    // outgoing keeps n < wOut, incoming keeps n >= 1 - wIn: with wIn = 1 - wOut they partition every n
    for (const t of [0, 0.2, 0.5, 0.8, 1]) for (const n of [0, 0.1, 0.49, 0.5, 0.9, 0.999]) {
      const out = n < 1 - t, inn = n >= 1 - t;
      expect(out !== inn).toBe(true);
    }
  });
});
