import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIFT_KIND_IDS, LIFTS, type LiftKind } from '@/config/lifts';
import { LIFT_STATION_HEAD, LIFT_STATION_SIZE } from '@/config/balance';
import { buildStationParts } from '@/render/meshes/lifts/Station';
import { buildTowerGeometry } from '@/render/meshes/lifts/Tower';
import { buildCarrierGeometry } from '@/render/meshes/lifts';
import { geometryHash } from '@/render/meshes/lifts/geo';
import { chairWidth } from '@/render/meshes/lifts/Chair';
import { BOX_GROW_MAX } from '@/render/meshes/common';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const bbox = (g: THREE.BufferGeometry): THREE.Box3 => { g.computeBoundingBox(); return g.boundingBox!.clone(); };
const info = (kind: LiftKind): { family: string; seats: number; bubble: boolean; cabinSize: number } => buildCarrierGeometry(kind).userData.meshInfo;

describe('lift models', () => {
  it('has 12 lift kinds, each with distinct bottom and top station geometry', () => {
    expect(LIFT_KIND_IDS.length).toBe(12);
    const hashes = new Map<string, string>();
    for (const k of LIFT_KIND_IDS) {
      const bot = geometryHash(buildStationParts(k, false).geometry), top = geometryHash(buildStationParts(k, true).geometry);
      expect(bot, `${k} bottom == top`).not.toBe(top);
      for (const [h, label] of [[bot, `${k}/bottom`], [top, `${k}/top`]] as const) {
        expect(hashes.get(h), `${label} duplicates ${hashes.get(h)}`).toBeUndefined();
        hashes.set(h, label);
      }
    }
  });

  it('stations fit the 2x2 footprint (with a small overhang), stay in budget and carry a name sign', () => {
    for (const k of LIFT_KIND_IDS) for (const top of [false, true]) {
      const p = buildStationParts(k, top);
      const box = bbox(p.geometry);
      const half = LIFT_STATION_SIZE / 2 + 0.3 + BOX_GROW_MAX; // + the anti z-fight box growth
      expect(box.min.x, k).toBeGreaterThanOrEqual(-half); expect(box.max.x, k).toBeLessThanOrEqual(half);
      expect(box.min.z, k).toBeGreaterThanOrEqual(-half); expect(box.max.z, k).toBeLessThanOrEqual(half);
      expect(box.min.y, k).toBeGreaterThanOrEqual(-0.35);
      expect(box.max.y, k).toBeGreaterThan(LIFT_STATION_HEAD * 0.7);
      expect(tris(p.geometry), k).toBeLessThan(3500);
      expect(p.sign?.text, k).toBeTruthy();
      expect(p.sign!.text.length).toBeLessThanOrEqual(12);
    }
  });

  it('is deterministic', () => {
    for (const k of LIFT_KIND_IDS) {
      expect(geometryHash(buildStationParts(k, true).geometry)).toBe(geometryHash(buildStationParts(k, true).geometry));
      expect(geometryHash(buildTowerGeometry(2, k))).toBe(geometryHash(buildTowerGeometry(2, k)));
      expect(geometryHash(buildCarrierGeometry(k))).toBe(geometryHash(buildCarrierGeometry(k)));
    }
  });

  it('every kind has a distinct tower and carrier variant (except none shared by kinds of different families)', () => {
    const towers = new Map<string, string>(), carriers = new Map<string, string>();
    for (const k of LIFT_KIND_IDS) {
      const t = geometryHash(buildTowerGeometry(3, k)), c = geometryHash(buildCarrierGeometry(k));
      const fam = LIFTS[k].family;
      const tPrev = towers.get(t), cPrev = carriers.get(c);
      if (tPrev) expect(LIFTS[tPrev as LiftKind].family, `${k} tower == ${tPrev}`).toBe(fam); // tubular chair2/chair4 share a tower: same family only
      expect(cPrev, `${k} carrier duplicates ${cPrev}`).toBeUndefined();
      towers.set(t, k); carriers.set(c, k);
    }
    // towers differ across every family and across the chair sub-types
    const fam = new Set(LIFT_KIND_IDS.map((k) => geometryHash(buildTowerGeometry(3, k))));
    expect(fam.size).toBeGreaterThanOrEqual(8);
  });

  it('carriers report seat counts / bubble / cabin size and match their geometry', () => {
    const seats: Partial<Record<LiftKind, number>> = { tbar: 2, chair2: 2, chair4: 4, chair4d: 4, chair6: 6, chair6d: 6, chair6b: 6, chair8b: 8 };
    for (const [k, n] of Object.entries(seats) as Array<[LiftKind, number]>) {
      expect(info(k).seats, k).toBe(n);
      expect(info(k).bubble, k).toBe(LIFTS[k].bubble);
      if (LIFTS[k].family === 'chair') {
        const w = bbox(buildCarrierGeometry(k)).getSize(new THREE.Vector3()).x;
        expect(w).toBeGreaterThanOrEqual(chairWidth(n) - 1e-6);
        expect(w).toBeLessThan(chairWidth(n) + 0.2);
      }
    }
    expect(info('gondola6').cabinSize).toBe(6);
    expect(info('gondola10').cabinSize).toBe(10);
    expect(info('cablecar').cabinSize).toBe(40);
    expect(info('funicular').cabinSize).toBe(60);
    // wider chairs for more seats
    const widths = [2, 4, 6, 8].map((n) => chairWidth(n));
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    // bubble hoods are a separate translucent group; open chairs have none
    expect(buildCarrierGeometry('chair6b').groups.length).toBe(2);
    expect(buildCarrierGeometry('chair6').groups.length).toBe(0);
    expect(buildCarrierGeometry('chair8b').groups.length).toBe(2);
    expect(buildCarrierGeometry('gondola10').groups.length).toBe(2);
    expect(bbox(buildCarrierGeometry('gondola10')).getSize(new THREE.Vector3()).z).toBeGreaterThan(bbox(buildCarrierGeometry('gondola6')).getSize(new THREE.Vector3()).z);
  });

  it('carriers hang below the cable and clear the ground at stations (drop < station head)', () => {
    for (const k of LIFT_KIND_IDS) {
      if (LIFTS[k].family === 'funicular') continue;
      const box = bbox(buildCarrierGeometry(k));
      expect(box.min.y, k).toBeGreaterThan(-LIFT_STATION_HEAD);
      expect(box.max.y, k).toBeLessThan(0.1);
    }
  });

  it('towers reach the cable height', () => {
    for (const k of LIFT_KIND_IDS) {
      const box = bbox(buildTowerGeometry(3, k));
      expect(box.max.y, k).toBeGreaterThan(2.9);
      expect(box.max.y, k).toBeLessThan(3.2);
      expect(tris(buildTowerGeometry(8, k)), k).toBeLessThan(4000);
    }
  });
});
