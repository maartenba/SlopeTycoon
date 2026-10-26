import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Grid, TileType } from '@/world/Grid';
import { generateTerrain, terrainRelief } from '@/world/TerrainGen';
import { PropKind, TREE_KINDS, VEGETATION_KINDS, PROP_KIND_COUNT, generateProps, surfaceHeight } from '@/world/Props';
import { InstancedLayer, TreeLayer, TREE_FULL_MAX_VIEW, TREE_LOW_MAX_VIEW } from '@/render/props/Trees';
import { RockLayer } from '@/render/props/Rocks';
import { cameraOffset } from '@/render/CameraController';
import { CAMERA_PITCH } from '@/config/balance';
import { budget } from '../perfMode';

function setup(size: 64 | 128 | 256, seed = 7) {
  const grid = new Grid(size);
  const t = generateTerrain(grid, seed);
  const t0 = performance.now();
  const props = generateProps(grid, t.forestDensity, seed);
  return { grid, props, ms: performance.now() - t0 };
}

function camFor(size: number, vh: number, tx: number, ty: number): THREE.OrthographicCamera {
  const aspect = 16 / 9;
  const c = new THREE.OrthographicCamera(-vh * aspect / 2, vh * aspect / 2, vh / 2, -vh / 2, 0.1, size * 4);
  c.position.copy(cameraOffset(Math.PI / 4, CAMERA_PITCH, size).add(new THREE.Vector3(tx, 0, ty)));
  c.lookAt(tx, 0, ty);
  c.updateMatrixWorld(true);
  return c;
}

describe('prop placement', () => {
  it('is deterministic', () => {
    const a = setup(128).props, b = setup(128).props;
    expect(a.countByKind()).toEqual(b.countByKind());
    expect(a.propsInChunk(1, 1).ox).toEqual(b.propsInChunk(1, 1).ox);
  });

  it('[perf] 128 map has ~20k trees, 256 map >= 50k trees, placement is fast', () => {
    const s128 = setup(128), s256 = setup(256);
    const k128 = s128.props.countByKind(), k256 = s256.props.countByKind();
    const sum = (k: number[]): number => VEGETATION_KINDS.reduce((a, x) => a + k[x]!, 0);
    const t128 = sum(k128), t256 = sum(k256);
    console.log(`128: ${t128} trees ${k128[2]} rocks in ${s128.ms.toFixed(0)}ms; 256: ${t256} trees ${k256[2]} rocks in ${s256.ms.toFixed(0)}ms`);
    expect(t128).toBeGreaterThanOrEqual(15000);
    expect(t128).toBeLessThanOrEqual(30000);
    expect(t256).toBeGreaterThanOrEqual(50000);
    expect(s256.ms).toBeLessThan(budget(3000));
  });

  it('no trees on water/rock/steep tiles; rocks exist on rock tiles', () => {
    const { grid, props } = setup(128);
    let rocksOnRock = 0;
    for (const c of props.chunks) {
      for (let i = 0; i < c.kind.length; i++) {
        const type = grid.tileType[c.ty[i]! * grid.size + c.tx[i]!]!;
        expect(type).not.toBe(TileType.Water);
        if (c.kind[i] !== PropKind.Rock) {
          expect(type).not.toBe(TileType.Rock);
          expect(grid.steepness(c.tx[i]!, c.ty[i]!)).toBeLessThanOrEqual(2.2);
        } else if (type === TileType.Rock) rocksOnRock++;
      }
    }
    expect(rocksOnRock).toBeGreaterThan(0);
  });

  it('removeInRect removes props and reports touched chunks', () => {
    const { props } = setup(128);
    const before = props.count();
    const touched: number[] = [];
    const n = props.removeInRect(0, 0, 40, 40, touched);
    expect(n).toBeGreaterThan(0);
    expect(props.count()).toBe(before - n);
    expect(touched.length).toBeGreaterThan(0);
    for (const c of [props.propsInChunk(0, 0)]) for (let i = 0; i < c.kind.length; i++) expect(c.tx[i]! <= 40 && c.ty[i]! <= 40).toBe(false);
  });
});

describe('species variety', () => {
  it.each([64, 128, 256] as const)('size %i has every vegetation species and per-size counts are sane', (size) => {
    const k = setup(size).props.countByKind();
    expect(k.length).toBe(PROP_KIND_COUNT);
    for (const kind of TREE_KINDS) expect(k[kind]).toBeGreaterThan(size === 64 ? 10 : 100);
    expect(k[PropKind.Shrub]).toBeGreaterThan(10);
    const veg = VEGETATION_KINDS.reduce((a, x) => a + k[x]!, 0);
    expect(veg).toBeGreaterThan(size === 64 ? 3000 : size === 128 ? 15000 : 50000);
    console.log(`${size}: ${JSON.stringify(k)}`);
  });

  it('species mix differs by altitude: broadleaf low, conifers/larch/snags high', () => {
    const { grid, props } = setup(128);
    const relief = terrainRelief(128);
    const lowC = new Array(PROP_KIND_COUNT).fill(0) as number[], highC = new Array(PROP_KIND_COUNT).fill(0) as number[];
    for (const c of props.chunks) {
      for (let i = 0; i < c.kind.length; i++) {
        const [n, e, s, w] = grid.getCorners(c.tx[i]!, c.ty[i]!);
        const hf = ((n + e + s + w) / 4 - 8) / relief;
        if (hf < 0.2) lowC[c.kind[i]!]!++;
        else if (hf > 0.6) highC[c.kind[i]!]!++;
      }
    }
    const broad = (a: number[]): number => a[PropKind.Deciduous]! + a[PropKind.Birch]! + a[PropKind.Oak]!;
    const conif = (a: number[]): number => a[PropKind.Conifer]! + a[PropKind.Pine]! + a[PropKind.Larch]!;
    const frac = (n: number, a: number[]): number => n / Math.max(1, VEGETATION_KINDS.reduce((s, k) => s + a[k]!, 0));
    expect(frac(broad(lowC), lowC)).toBeGreaterThan(frac(broad(highC), highC) + 0.2);
    expect(frac(conif(highC), highC)).toBeGreaterThan(frac(conif(lowC), lowC) + 0.2);
    expect(frac(highC[PropKind.Snag]! + highC[PropKind.Larch]!, highC)).toBeGreaterThan(frac(lowC[PropKind.Snag]! + lowC[PropKind.Larch]!, lowC));
  });
});

describe('terrain following', () => {
  it('surfaceHeight tracks corner changes and refreshChunk marks the owning cells stale', () => {
    const { grid, props } = setup(128);
    const c = props.propsInChunk(2, 2);
    const i = c.kind.findIndex((k) => k === PropKind.Conifer);
    expect(i).toBeGreaterThanOrEqual(0);
    const y0 = props.propY(c, i);
    const tx = c.tx[i]!, ty = c.ty[i]!;
    for (const [vx, vy] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]] as const) grid.setCornerUnchecked(vx, vy, grid.getCorner(vx, vy) + 2);
    expect(props.propY(c, i)).toBeCloseTo(y0 + 1, 5); // +2 half-steps = +1 world unit
    expect(surfaceHeight(grid, tx + 0.5, ty + 0.5)).toBeGreaterThan(y0 - 1);

    const layer = new InstancedLayer(props, PropKind.Conifer, [
      { maxView: Infinity, groupChunks: 2, geometry: new THREE.BufferGeometry(), material: new THREE.MeshBasicMaterial() },
    ]);
    const cam = camFor(128, 200, 64, 64);
    layer.update(cam, 200, 100); // builds all visible cells
    expect(layer.staleCount(0)).toBe(0);
    const dirty = grid.consumeDirtyChunks();
    layer.refreshChunks(dirty);
    expect(layer.staleCount(0)).toBeGreaterThan(0);
    layer.update(cam, 200, 100);
    expect(layer.staleCount(0)).toBe(0);
  });
});

describe('near level cap', () => {
  it('a capped level keeps the props NEAREST to the camera (never the first N in chunk order), and cap 0 hands over to the standard level from distance 0', () => {
    const { props } = setup(128);
    // chunk 2,2 has plenty of conifers; stand right next to the LAST one in storage order
    const c = props.propsInChunk(2, 2);
    const idx: number[] = [];
    for (let i = 0; i < c.kind.length; i++) if (c.kind[i] === PropKind.Conifer) idx.push(i);
    expect(idx.length).toBeGreaterThan(5);
    const last = idx[idx.length - 1]!;
    const lx = c.tx[last]! + c.ox[last]!, lz = c.ty[last]! + c.oy[last]!;
    const cam = new THREE.PerspectiveCamera(120, 1, 0.05, 200);
    cam.position.set(lx + 0.05, surfaceHeight(props.grid, lx, lz) + 3, lz + 0.05);
    cam.lookAt(lx, 0, lz); cam.updateMatrixWorld(true);
    const near = { maxView: -1, perspectiveOnly: true, groupChunks: 1, maxPerCell: 3, geometry: new THREE.BufferGeometry(), material: new THREE.MeshBasicMaterial(), band: [0, 8] as [number, number] };
    const std = { maxView: -1, perspectiveOnly: true, groupChunks: 1, geometry: new THREE.BufferGeometry(), material: new THREE.MeshBasicMaterial(), band: [8, 40] as [number, number] };
    const layer = new InstancedLayer(props, PropKind.Conifer, [near, std]);
    layer.update(cam, 30, 100);
    const meshes = layer.group.children.filter((m): m is THREE.InstancedMesh => (m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count === 3);
    expect(meshes.length).toBeGreaterThan(0);
    let found = false;
    for (const m of meshes) { const a = m.instanceMatrix.array as Float32Array; for (let k = 0; k < 3; k++) if (Math.abs(a[k * 16 + 12]! - lx) < 1e-3 && Math.abs(a[k * 16 + 14]! - lz) < 1e-3) found = true; }
    expect(found).toBe(true);
    // cap 0: the standard level's band now starts at 0
    layer.setNearCap(0);
    expect(std.band[0]).toBe(0);
    layer.setNearCap(5);
    expect(std.band[0]).toBe(8);
  });
});

describe('draw calls', () => {
  it('prop draw calls stay < 40 at all zooms on 256 and 128 maps', () => {
    const rows: string[] = [];
    for (const size of [128, 256] as const) {
      const { grid, props } = setup(size);
      void grid;
      const trees = new TreeLayer(props);
      const rocks = new RockLayer(props);
      let worst = 0;
      for (const vh of [12, 20, TREE_FULL_MAX_VIEW, 40, 60, TREE_LOW_MAX_VIEW, 120, size * 0.75]) {
        if (vh > size * 0.75) continue;
        for (const [tx, ty] of [[size / 2, size / 2], [size * 0.3, size * 0.4], [size * 0.7, size * 0.6], [size * 0.5, size * 0.1]] as const) {
          const cam = camFor(size, vh, tx, ty);
          const n = trees.countDraws(cam, vh) + rocks.countDraws(cam, vh);
          worst = Math.max(worst, n);
          expect(n).toBeLessThan(40);
        }
      }
      rows.push(`${size}: worst ${worst}`);
    }
    console.log('prop draw calls (max over zooms/positions):', rows.join('; '));
  });
});
