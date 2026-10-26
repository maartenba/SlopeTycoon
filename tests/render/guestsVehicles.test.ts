import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  Age, AGE_SCALE, animPhase, appearanceOf, BOARDER_SHARE, describeAppearance, Gear, GEAR_COUNT, gearFor, HairStyle, isBoarder, moveFactor, Outfit, outfitFor, POSE, SKIN_TONES, UsingKind,
  HAIR_COLORS, ageOf, mix32, rand01,
} from '../../src/render/guestAppearance';
import { buildGearGeometry, visibleTriangles } from '../../src/render/meshes/Figures';
import { GUEST_DRAW_CALLS, GuestRenderer } from '../../src/render/GuestRenderer';
import { GState, GuestStore, GuestType } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { createVehicleMesh, vehicleLook } from '../../src/render/meshes/Vehicles';
import { VehicleKind } from '../../src/sim/guests/Arrivals';
import { buildBus, buildCar, buildPlane, buildTrain } from '../../src/render/meshes/VehicleModels';

const N = 5000;
const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;

describe('guest appearance (pure, deterministic)', () => {
  it('is stable per id and only the head-wear depends on the season', () => {
    for (let id = 1; id < 300; id++) {
      const a = appearanceOf(id, id % 6, false), b = appearanceOf(id, id % 6, false);
      expect(b).toEqual(a);
      const w = appearanceOf(id, id % 6, true);
      expect({ ...w, hairStyle: 0 }).toEqual({ ...a, hairStyle: 0 });
      expect(describeAppearance(id, 0)).toBe(describeAppearance(id, 0));
    }
    expect(mix32(7, 3)).toBe(mix32(7, 3));
    expect(rand01(12345, 9)).toBeGreaterThanOrEqual(0);
    expect(rand01(12345, 9)).toBeLessThan(1);
  });

  it('skin tones, hair colours and genders cover the palette (coverage over 5000 ids)', () => {
    const skin = new Array(SKIN_TONES.length).fill(0), hair = new Array(HAIR_COLORS.length).fill(0), styles = new Array(9).fill(0);
    let female = 0;
    for (let id = 1; id <= N; id++) {
      const a = appearanceOf(id, id % 6, id % 2 === 0);
      skin[a.skin]++; hair[a.hair]++; styles[a.hairStyle]++;
      if (a.female) female++;
    }
    for (const c of skin) expect(c / N).toBeGreaterThanOrEqual(0.05);
    for (const c of hair) expect(c / N).toBeGreaterThanOrEqual(0.015);
    for (const c of styles) expect(c / N).toBeGreaterThan(0.01); // every hair/hat style is used (both seasons mixed)
    expect(Math.abs(female / N - 0.5)).toBeLessThan(0.03);
  });

  it('kids belong to family groups; the family system can override', () => {
    let kidsFam = 0, fam = 0, kidsOther = 0;
    for (let id = 1; id <= N; id++) {
      if (id % 6 === GuestType.Family) { fam++; if (ageOf(id, GuestType.Family) === Age.Child) kidsFam++; } else { if (ageOf(id, id % 6) === Age.Child) kidsOther++; }
    }
    expect(kidsFam / fam).toBeGreaterThan(0.28);
    expect(kidsFam / fam).toBeLessThan(0.44);
    expect(kidsOther).toBe(0);
    expect(ageOf(1, GuestType.Solo, true)).toBe(Age.Child);
    expect(appearanceOf(1, GuestType.Family, false, true).scale).toBeLessThan(0.72);
    expect(appearanceOf(1, GuestType.Family, false, false).age).not.toBe(Age.Child);
    expect(AGE_SCALE[Age.Child]).toBeCloseTo(0.65);
  });

  it('winter heads wear helmets/beanies, summer heads caps/sun hats', () => {
    let helm = 0, sun = 0;
    for (let id = 1; id <= 2000; id++) {
      if (appearanceOf(id, 0, true).hairStyle === HairStyle.Helmet) helm++;
      if (appearanceOf(id, 0, false).hairStyle === HairStyle.SunHat) sun++;
      expect(appearanceOf(id, 0, false).hairStyle).not.toBe(HairStyle.Helmet);
      expect(appearanceOf(id, 0, true).hairStyle).not.toBe(HairStyle.SunHat);
    }
    expect(helm / 2000).toBeGreaterThan(0.3);
    expect(sun / 2000).toBeGreaterThan(0.1);
  });
});

describe('gear rules', () => {
  it('constants mirrored from the sim stay in sync', () => {
    expect(GState.Riding).toBe(5); expect(GState.Using).toBe(6); expect(GState.Injured).toBe(7);
    expect(NavMode.Hike).toBe(1); expect(NavMode.Bike).toBe(2); expect(NavMode.Ski0).toBe(3); expect(NavMode.SkiOff).toBe(7);
  });
  it('snow -> ski/board (~70/30), summer -> hike/bike, lift -> sit, rink -> skate, beach/injured -> lie', () => {
    let boards = 0;
    for (let id = 1; id <= 4000; id++) {
      const g = gearFor(GState.Walking, NavMode.Ski2, id);
      expect([Gear.Ski, Gear.Board]).toContain(g);
      if (g === Gear.Board) boards++;
      expect(isBoarder(id)).toBe(g === Gear.Board);
    }
    expect(Math.abs(boards / 4000 - BOARDER_SHARE)).toBeLessThan(0.03);
    expect(gearFor(GState.Walking, NavMode.Hike, 1)).toBe(Gear.Hike);
    expect(gearFor(GState.Walking, NavMode.Bike, 1)).toBe(Gear.Bike);
    expect(gearFor(GState.Walking, NavMode.Walk, 1)).toBe(Gear.Walk);
    expect(gearFor(GState.Riding, NavMode.Ski1, 1)).toBe(Gear.Sit);
    expect(gearFor(GState.Using, 0, 1, UsingKind.Rink)).toBe(Gear.Skate);
    expect(gearFor(GState.Using, 0, 1, UsingKind.Beach)).toBe(Gear.Lie);
    expect(gearFor(GState.Using, 0, 1, UsingKind.Other)).toBe(Gear.Walk);
    expect(gearFor(GState.Injured, NavMode.Ski1, 1)).toBe(Gear.Lie);
    expect(gearFor(GState.Queueing, NavMode.Ski1, 1)).toBeGreaterThanOrEqual(Gear.Ski);
  });
  it('outfits follow season and activity', () => {
    expect(outfitFor(Gear.Ski, false, false)).toBe(Outfit.Warm);
    expect(outfitFor(Gear.Walk, true, false)).toBe(Outfit.Warm);
    expect(outfitFor(Gear.Hike, false, false)).toBe(Outfit.Summer);
    expect(outfitFor(Gear.Lie, false, true)).toBe(Outfit.Swim);
    expect(outfitFor(Gear.Skate, false, false)).toBe(Outfit.Warm);
  });
});

describe('animation parameters (deterministic, bounded)', () => {
  it('phase/speed functions are pure and every gear has a pose', () => {
    for (let g = 0; g < GEAR_COUNT; g++) {
      const p = POSE[g]!;
      expect(p).toBeDefined();
      for (const v of [p.leg, p.arm, p.sway, p.bob, p.wheel, p.freq]) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
      expect(p.leg).toBeLessThan(1.2); expect(p.sway).toBeLessThan(0.5);
    }
    expect(animPhase(1, 10, 0.15, 20)).toBe(animPhase(1, 10, 0.15, 20));
    expect(animPhase(0, 10, 0, 20)).toBe(0); // standing still: no phase advance
    expect(moveFactor(0)).toBe(0); expect(moveFactor(0.04)).toBe(1); expect(moveFactor(0, 1)).toBe(1);
  });
});

describe('figure geometry budget', () => {
  it('each figure is ~100-260 visible triangles with valid tags; skinny gear batches stay cheap', () => {
    for (let g = 0; g < GEAR_COUNT; g++) {
      const geo = buildGearGeometry(g);
      expect(geo.getAttribute('aTag').count).toBe(geo.getAttribute('position').count);
      expect(geo.getAttribute('aTag').itemSize).toBe(4);
      expect(geo.getAttribute('normal').count).toBe(geo.getAttribute('position').count);
      let worst = 0;
      for (let st = 0; st <= HairStyle.SunHat; st++) worst = Math.max(worst, visibleTriangles(geo, st, true));
      const best = visibleTriangles(geo, HairStyle.Bald, false);
      expect(best).toBeGreaterThanOrEqual(90);
      expect(worst).toBeLessThanOrEqual(g === Gear.Bike ? 340 : 260);
      expect(tris(geo)).toBeLessThan(900); // everything incl. hidden variants (vertex shader collapses them)
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
    }
  });
});

describe('GuestRenderer batches', () => {
  const mk = (): { st: GuestStore; r: GuestRenderer } => {
    const st = new GuestStore(400);
    const states: Array<[number, number]> = [[GState.Walking, 0], [GState.Walking, NavMode.Hike], [GState.Walking, NavMode.Ski2], [GState.Walking, NavMode.Bike], [GState.Riding, 0], [GState.Injured, 0]];
    for (let i = 0; i < 120; i++) {
      const s = st.add({ x: 10 + (i % 10), y: 10 + ((i / 10) | 0), z: 0, type: i % 6, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
      st.state[s] = states[i % 6]![0]; st.moveMode[s] = states[i % 6]![1]; st.px[s] = st.x[s]! - 0.1; st.py[s] = st.y[s]!;
    }
    return { st, r: new GuestRenderer(st) };
  };
  it('stays within the draw-call budget and routes guests to gear batches', () => {
    const { r } = mk();
    expect(r.group.children.length).toBe(GUEST_DRAW_CALLS + GEAR_COUNT); // + the (normally hidden) near-LOD batches, drawn only by ground cameras
    expect(GUEST_DRAW_CALLS).toBeLessThanOrEqual(12);
    r.update(0.5, 20);
    const c = r.batchCounts();
    expect(c.reduce((a, b) => a + b, 0)).toBe(120);
    expect(c[Gear.Walk]).toBe(20); expect(c[Gear.Hike]).toBe(20); expect(c[Gear.Bike]).toBe(20); expect(c[Gear.Sit]).toBe(20); expect(c[Gear.Lie]).toBe(20);
    expect(c[Gear.Ski]! + c[Gear.Board]!).toBe(20);
    expect(r.meshes.filter((m) => m.visible).length).toBeLessThanOrEqual(GEAR_COUNT);
  });
  it('far zoom draws only the impostor points; winter switches outfits/head-wear without crashing', () => {
    const { r } = mk();
    r.update(0.5, 200);
    expect(r.batchCounts().every((n) => n === 0)).toBe(true);
    expect(r.group.children[GEAR_COUNT]!.visible).toBe(true);
    r.winter = true; r.update(0.5, 20);
    expect(r.group.children[GEAR_COUNT]!.visible).toBe(false);
  });
  it('kid hook scales the instance matrix', () => {
    const { r } = mk();
    r.isKid = () => true; r.update(0.5, 20);
    const m0 = (r.meshes[Gear.Walk]!.instanceMatrix.array as Float32Array)[5]!;
    expect(m0).toBeLessThan(0.72);
  });
  it('update path allocates nothing per guest (static check of the hot loop)', () => {
    const src = GuestRenderer.prototype.update.toString();
    expect(src).not.toMatch(/\bnew\s/);
    expect(src).not.toMatch(/\.(map|filter|slice|concat|forEach)\(/);
    expect(src).not.toMatch(/\.\.\./);
  });
});

describe('vehicles', () => {
  it('looks are deterministic; VIP cars are sports cars; styles/colours vary', () => {
    expect(vehicleLook(0, 5, false)).toEqual(vehicleLook(0, 5, false));
    expect(vehicleLook(0, 5, true).style).toBe(4);
    const styles = new Set<number>(), colors = new Set<number>(), racks = new Set<number>();
    for (let id = 0; id < 200; id++) { const l = vehicleLook(0, id, false); styles.add(l.style); colors.add(l.color); racks.add(l.rack); }
    expect(styles.size).toBe(4); expect(colors.size).toBeGreaterThanOrEqual(6); expect(racks.size).toBe(2);
  });
  it('model triangle budgets, finite vertices and few draw calls per vehicle', () => {
    for (let s = 0; s < 5; s++) for (const rack of [0, 1, 2]) {
      const m = buildCar(s, 0xc93a32, rack);
      expect(tris(m.body)).toBeLessThan(900); expect(tris(m.lights)).toBe(48);
      const p = m.body.getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      expect(m.body.getAttribute('color').count).toBe(p.count);
    }
    expect(tris(buildBus(false, 0x3a78c2).body)).toBeLessThan(2000);
    expect(tris(buildTrain().body)).toBeLessThan(3500); // was 3300: wheels 10 -> 12 radial segments, hubs 6 -> 8 (soft look pass)
    expect(tris(buildPlane().body)).toBeLessThan(900);
    for (const k of [VehicleKind.Car, VehicleKind.Bus, VehicleKind.Train, VehicleKind.Plane]) {
      const v = createVehicleMesh(k, 3, false, false);
      expect(v.group.children.length).toBeLessThanOrEqual(3);
    }
    expect(createVehicleMesh(VehicleKind.Plane).prop).not.toBeNull();
    expect(createVehicleMesh(VehicleKind.Car).prop).toBeNull();
  });
});
