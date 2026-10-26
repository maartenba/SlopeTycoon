import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLEE, NatureView, fleeOffset } from '../../src/render/NatureView';
import type { Critter } from '../../src/sim/nature/Fauna';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { fullHash } from '../game/harness';
import { AMB, ambienceMix, shelterFromTrunks, SHELTER, type AmbienceState } from '../../src/audio/Ambience';
import { WorldProbe, countTrunks } from '../../src/audio/worldProbe';
import { Grid } from '../../src/world/Grid';
import { PropKind } from '../../src/world/Props';

const critter = (id: number, species: Critter['species'], x: number, y: number): Critter => ({ id, species, herd: 0, leader: false, x, y, tx: x, ty: y, heading: 0, flee: 0, hidden: false, phase: 0, farm: 0, mode: 0 });
const pos = (v: NatureView, sp: string, i = 0): THREE.Vector3 => { const m = new THREE.Matrix4(); v.meshes.get(sp as never)!.getMatrixAt(i, m); return new THREE.Vector3().setFromMatrixPosition(m); };

describe('animal flee (render only)', () => {
  it('fleeOffset: away from the walker, 0 beyond the radius, strongest up close, timid species only, deterministic', () => {
    expect(fleeOffset(20, 10, 10, 10)).toEqual(expect.objectContaining({ z: 0 }));
    const near = fleeOffset(12, 10, 10, 10), mid = fleeOffset(15, 10, 10, 10);
    expect(near.x).toBeGreaterThan(mid.x); expect(mid.x).toBeGreaterThan(0); expect(near.x).toBeLessThanOrEqual(FLEE.maxPush);
    expect(fleeOffset(10 + FLEE.radius + 0.01, 10, 10, 10)).toEqual({ x: 0, z: 0 });
    expect(fleeOffset(12, 10, 10, 10, 0)).toEqual({ x: 0, z: 0 }); // eagle (timid 0)
    expect(fleeOffset(12, 10, 10, 10, 0.35).x).toBeCloseTo(near.x * 0.35, 8); // cows barely care
    const up = fleeOffset(10, 8, 10, 10); expect(up.z).toBeLessThan(0); // north of the walker: pushed north
    expect(fleeOffset(10, 10, 10, 10).x).toBeGreaterThan(0); // exactly on top: some direction, no NaN
  });
  it('the displayed animal drifts away from the walker over ~1 s, comes back when it leaves, and the Critter (sim) data is never modified', () => {
    const view = new NatureView(() => 0);
    const a = critter(1, 'deer', 12, 10), before = { ...a };
    for (let i = 0; i < 90; i++) view.update(1 / 60, [a], 12, 10, 10);
    const rest = pos(view, 'deer');
    expect(rest.x).toBeCloseTo(12, 1);
    for (let i = 0; i < 120; i++) view.update(1 / 60, [a], 12, 10, 10, { x: 10, z: 10 });
    const fled = pos(view, 'deer');
    expect(fled.x - rest.x).toBeGreaterThan(1); expect(Math.hypot(fled.z - rest.z, 0)).toBeLessThan(0.2);
    expect(a).toEqual(before); // visual only
    for (let i = 0; i < 240; i++) view.update(1 / 60, [a], 12, 10, 10, null);
    expect(pos(view, 'deer').x).toBeCloseTo(12, 1);
    // an eagle and a far deer stay put
    const e = critter(2, 'eagle', 12, 10), far = critter(3, 'deer', 40, 40);
    const v2 = new NatureView(() => 0);
    for (let i = 0; i < 120; i++) v2.update(1 / 60, [e, far], 12, 10, 60, { x: 10, z: 10 });
    expect(pos(v2, 'eagle').x).toBeCloseTo(12, 1); expect(pos(v2, 'deer').x).toBeCloseTo(40, 1);
  });
  it('stateHash is identical after 3 sim days with the view fleeing from a walker next to the animals vs without', () => {
    const go = (flee: boolean): string => {
      const sim = createSim({ size: 64, seed: 21, now: () => 0 }); buildStarterResort(sim);
      const view = new NatureView(() => 0);
      for (let t = 0; t < 720; t++) {
        sim.tick(1);
        const an = [...sim.nature.fauna.animals, ...sim.nature.livestock.animals], w = an[0];
        if (t % 4 === 0) view.update(1 / 15, an, 32, 32, 20, flee && w ? { x: w.x + 1, z: w.y } : null);
      }
      return fullHash(sim);
    };
    expect(go(true)).toBe(go(false));
  }, 90000);
});

describe('forest wind shelter (audio probe)', () => {
  const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 12, zoom: AMB.walkZoom, altitude: 0.4, wind: 0.5, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
  it('shelterFromTrunks is linear up to SHELTER.fullTrunks and the wind bed drops by ~30 % at full shelter, nothing else changes', () => {
    expect(shelterFromTrunks(0)).toBe(0); expect(shelterFromTrunks(SHELTER.fullTrunks / 2)).toBeCloseTo(0.5); expect(shelterFromTrunks(SHELTER.fullTrunks * 3)).toBe(1);
    const open = ambienceMix(base), full = ambienceMix({ ...base, shelter: 1 }), half = ambienceMix({ ...base, shelter: 0.5 });
    expect(full.wind).toBeCloseTo(open.wind * 0.7, 6); expect(half.wind).toBeCloseTo(open.wind * 0.85, 6);
    expect({ ...full, wind: 0 }).toEqual({ ...open, wind: 0 });
    expect(ambienceMix({ ...base, shelter: undefined }).wind).toBe(open.wind); // old callers
  });
  it('countTrunks counts only tree kinds within r tiles (rocks / shrubs ignored), across chunk borders', () => {
    const mkChunk = (items: Array<[number, number, number]>): never => ({ kind: Uint8Array.from(items.map((i) => i[2])), tx: Int16Array.from(items.map((i) => Math.floor(i[0]))), ty: Int16Array.from(items.map((i) => Math.floor(i[1]))), ox: Float32Array.from(items.map((i) => i[0] % 1)), oy: Float32Array.from(items.map((i) => i[1] % 1)) }) as never;
    const chunks = [mkChunk([[30, 10, PropKind.Conifer], [31, 10, PropKind.Rock], [29, 11, PropKind.Shrub]]), mkChunk([[33, 10, PropKind.Oak], [34, 12, PropKind.Pine], [60, 60, PropKind.Conifer]]), mkChunk([]), mkChunk([])];
    const props = { chunks, chunksPerRow: 2 };
    expect(countTrunks(props, 32, 10, 6)).toBe(3);
    expect(countTrunks(props, 32, 10, 1.5)).toBe(1); // only the oak (1.0 away); the conifer is 2.0 away
  });
  it('the probe sets shelter only for the walker (near-field zoom): >= N trunks near = full; open ground / far view = 0', () => {
    const g = new Grid(64);
    let trunks = 0;
    const probe = new WorldProbe({
      grid: g, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 10, trunks: () => trunks,
      env: () => ({ season: 'summer', weather: 'clear', hour: 12, wind: 0.3 }),
    });
    const l = { x: 20, z: 20, yaw: 0 } as never;
    trunks = 14; expect(probe.sample(l, AMB.walkZoom).shelter).toBe(1);
    trunks = 5; expect(probe.sample(l, AMB.walkZoom).shelter).toBeCloseTo(0.5);
    trunks = 0; expect(probe.sample(l, AMB.walkZoom).shelter).toBe(0);
    trunks = 14; expect(probe.sample(l, 60).shelter).toBe(0); // iso view: no shelter
  });
});
