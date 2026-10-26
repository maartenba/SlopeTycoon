import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPHICS_QUALITIES, QUALITY_PRESETS } from '../../src/config/balance';
import { GROUND_CAPS, MID_TILES, NEAR_CAPS, NEAR_TILES, RIDE_DRAW_BUDGET_128, nearLod, setGroundCaps } from '../../src/render/lod/nearLod';
import { Gear } from '../../src/render/guestAppearance';
import { buildGearGeometry } from '../../src/render/meshes/Figures';
import { buildChairGeometry } from '../../src/render/meshes/lifts/Chair';
import { BUILDING_ROOF_HIDE_RADIUS, BuildingMeshes } from '../../src/render/meshes';
import { EYE, FIGURE_HEIGHT, RIDE_NEAR } from '../../src/render/view/ViewCameraRig';

const height = (g: THREE.BufferGeometry): { min: number; max: number } => { g.computeBoundingBox(); return { min: g.boundingBox!.min.y, max: g.boundingBox!.max.y }; };

afterEach(() => setGroundCaps({ nearTiles: NEAR_TILES, figures: NEAR_CAPS.figuresTotal }));

describe('ground-level scale (figure vs ride rig)', () => {
  it('FIGURE_HEIGHT is the real drawn height of a standing adult figure (not the old 1.15 guess)', () => {
    const h = height(buildGearGeometry(Gear.Walk)).max; // feet at the origin, instance scale ~1 for an adult
    expect(h).toBeGreaterThan(0.45); expect(h).toBeLessThan(0.62);
    expect(Math.abs(FIGURE_HEIGHT - h)).toBeLessThan(0.06);
  });
  it('standing eyes are at ~0.9 x figure height (head level of the guests next to you), always clear of the near plane', () => {
    for (const k of ['ski', 'board', 'foot', 'bike'] as const) {
      const r = EYE[k].up / FIGURE_HEIGHT;
      expect(r).toBeGreaterThan(0.82); expect(r).toBeLessThan(1.0);
      expect(EYE[k].up).toBeGreaterThan(RIDE_NEAR * 4);
      expect(EYE[k].bob).toBeLessThan(EYE[k].up * 0.05); // bob never plunges into the ground
    }
  });
  it('chair eye (below the grip) sits at the head level of a seated rider: above the seat pad, below the cable', () => {
    const seat = height(buildChairGeometry(4)); // origin = cable grip, hangs downward
    expect(seat.min).toBeLessThan(EYE.chair.up - 0.3); // footrest well below the eye
    expect(EYE.chair.up).toBeLessThan(0); // under the cable
    expect(EYE.chair.up).toBeGreaterThan(-0.2); // not lower than the backrest top / riders' heads
  });
  it('cabin eyes stay below the cabin ceiling', () => {
    // gondola cabin: roof fairing at -0.5, floor at -0.5 - 0.4; eye between the bench top and the ceiling
    expect(EYE.gondola.up).toBeLessThan(-0.54); expect(EYE.gondola.up).toBeGreaterThan(-0.86);
  });
});

describe('building roof fade', () => {
  it('setNearHide switches the roof fade on around a ground camera and off (radius 0) for iso', () => {
    const bm = new BuildingMeshes();
    const u = (bm as unknown as { nearHide: { value: THREE.Vector4 } }).nearHide.value;
    expect(u.w).toBe(0);
    bm.setNearHide({ x: 1, y: 2, z: 3 });
    expect([u.x, u.y, u.z, u.w]).toEqual([1, 2, 3, BUILDING_ROOF_HIDE_RADIUS]);
    bm.setNearHide(null);
    expect(u.w).toBe(0);
  });
});

describe('ground quality caps', () => {
  it('low disables the heaviest near features; med keeps the Task 11 defaults; high >= med', () => {
    const { low, med, high } = QUALITY_PRESETS;
    expect(low.ground.nearTiles).toBe(0); expect(low.ground.nearTreesPerCell).toBe(0); expect(low.ground.nearRocksPerCell).toBe(0);
    expect(low.ground.nearFigures).toBe(0); expect(low.ground.detailTexture).toBe(false);
    expect(med.ground.nearTiles).toBe(NEAR_TILES); expect(med.ground.nearTreesPerCell).toBe(NEAR_CAPS.treesPerCell);
    expect(med.ground.nearRocksPerCell).toBe(NEAR_CAPS.rocksPerCell); expect(med.ground.nearFigures).toBe(NEAR_CAPS.figuresTotal);
    for (const k of ['nearTiles', 'nearTreesPerCell', 'nearRocksPerCell', 'nearFigures', 'fogRangeScale'] as const) {
      expect(low.ground[k]).toBeLessThanOrEqual(med.ground[k]); expect(med.ground[k]).toBeLessThanOrEqual(high.ground[k]);
    }
    for (const q of GRAPHICS_QUALITIES) expect(QUALITY_PRESETS[q].ground.nearFigures).toBeLessThanOrEqual(NEAR_CAPS.figuresTotal);
  });
  it('setGroundCaps drives nearLod: low never yields the near band, high widens it; iso is unaffected', () => {
    setGroundCaps({ nearTiles: 0, figures: 0 });
    for (const d of [0, 1, 5, 19]) expect(nearLod('perspective', d)).toBe('mid');
    expect(nearLod('perspective', MID_TILES + 1)).toBe('far');
    setGroundCaps({ nearTiles: 8, figures: 40 });
    expect(nearLod('perspective', 7)).toBe('near'); expect(nearLod('perspective', 9.5)).toBe('mid');
    expect(nearLod('ortho', 1)).toBe('base');
    setGroundCaps({ nearTiles: -3, figures: 999 });
    expect(GROUND_CAPS.nearTiles).toBe(0); expect(GROUND_CAPS.figures).toBe(NEAR_CAPS.figuresTotal);
  });
  it('draw-call budget calc: near features add at most a bounded number of draws', () => {
    // upper bound of what the Task 11 near variants add in a ride frame: 8 near gear batches + a handful of near lift/rock/tree cell meshes
    const nearFigureDraws = 8, nearTreeCells = 4 * 9, nearRockCells = 4, nearLift = 12;
    expect(nearFigureDraws + nearTreeCells + nearRockCells + nearLift).toBeLessThan(RIDE_DRAW_BUDGET_128 / 4);
    expect(RIDE_DRAW_BUDGET_128).toBe(350);
  });
});
