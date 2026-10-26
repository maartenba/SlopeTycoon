import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BUILDINGS } from '@/config/buildings';
import { BUILDING_BUILDERS, buildParts } from '@/render/meshes';
import { buildingTab } from '@/ui/buildInfo';
import { describeRules } from '@/sim/PlacementRules';
import { Coverage, COVERAGE_KINDS, OVERLAY_MODES, OVERLAY_LABELS, EMPTY_NETWORK, paintOverlay, type CoverageBuilding } from '@/sim/Coverage';
import { formatEvent } from '@/ui/newsFormat';
import { GAME_EVENT_NAMES } from '@/core/events';

const def = BUILDINGS.rangerStation!;

describe('Ranger Station catalog entry', () => {
  it('has the specified rules, cost, staff, coverage and lives in Safety & Ops', () => {
    expect(def.category).toBe('safety');
    expect(buildingTab(def)).toBe('safety');
    expect([def.w, def.h]).toEqual([4, 3]);
    expect(def.cost).toBe(9000);
    expect(def.upkeep).toBeGreaterThan(0);
    expect(def.staff).toBe(2);
    expect(def.requires).toEqual([]); // works alone (better with a Patrol Hub; documented)
    expect(def.access).toBe('road'); expect(def.altAccess).toContain('path');
    expect(def.pisteRule).toBe('forbid');
    expect(def.site.autoFlatten).toBe('default');
    expect(def.site.onWater).toBe('never');
    expect(def.serviceRadius).toBe(35);
    expect(def.coverageKind).toBe('wildlife');
    expect(describeRules('rangerStation').length).toBeGreaterThan(0);
  });
  it('has a mesh builder that fits the footprint, a chimney top vertex and <= 4 meshes', () => {
    expect(BUILDING_BUILDERS[def.meshBuilder]).toBeDefined();
    const p = buildParts(def.meshBuilder, def.w, def.h);
    const geos = [p.wood, p.stone, p.roof, p.sign?.geometry].filter((g): g is THREE.BufferGeometry => !!g);
    expect(geos.length).toBeLessThanOrEqual(4);
    const box = new THREE.Box3();
    for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    expect(box.min.x).toBeGreaterThanOrEqual(-def.w / 2 - 0.6); expect(box.max.x).toBeLessThanOrEqual(def.w / 2 + 0.6);
    expect(box.min.z).toBeGreaterThanOrEqual(-def.h / 2 - 0.6); expect(box.max.z).toBeLessThanOrEqual(def.h / 2 + 0.6);
    let found = false;
    for (const g of geos) { const pos = g.getAttribute('position'); for (let i = 0; i < pos.count && !found; i++) if (Math.abs(pos.getY(i) - def.chimney!.y) < 0.021 && Math.hypot(pos.getX(i) - def.chimney!.x, pos.getZ(i) - def.chimney!.z) < 0.2) found = true; }
    expect(found).toBe(true);
  });
  it('is documented (placement-rules row, models table)', () => {
    expect(readFileSync('docs/placement-rules.md', 'utf8')).toMatch(/\| Ranger Station \|/);
    expect(readFileSync('docs/models.md', 'utf8')).toMatch(/`rangerStation`/);
  });
});

describe('wildlife coverage + overlays', () => {
  const b: CoverageBuilding = { id: 1, type: 'rangerStation', x: 20, y: 20, w: 4, h: 3, active: true };
  it("'wildlife' is a coverage kind fed by active Ranger Stations only", () => {
    expect(COVERAGE_KINDS).toContain('wildlife');
    const c = new Coverage(64);
    c.refresh([b]);
    expect(c.isCovered('wildlife', 22, 21)).toBe(true);
    expect(c.isCovered('wildlife', 22 + 34, 21)).toBe(true);
    expect(c.isCovered('wildlife', 22 + 37, 21)).toBe(false);
    expect(c.nearestResponder('wildlife', 40, 40)?.id).toBe(1);
    c.refresh([{ ...b, active: false }]);
    expect(c.isCovered('wildlife', 22, 21)).toBe(false);
  });
  it("paints 'wildlife' (ranger coverage) and the 'threat' heatmap (alpha grows with the threat)", () => {
    expect(OVERLAY_MODES).toContain('threat'); expect(OVERLAY_MODES).toContain('wildlife');
    expect(OVERLAY_LABELS.threat).toBe('Wildlife threat');
    const N = 64, c = new Coverage(N), out = new Uint8Array(N * N * 4);
    c.refresh([b]);
    paintOverlay(out, N, 'wildlife', c, EMPTY_NETWORK, [b]);
    expect(out[(21 * N + 22) * 4 + 3]).toBeGreaterThan(0);
    const threat = new Uint8Array(N * N); threat[10 * N + 10] = 255; threat[10 * N + 11] = 100; threat[10 * N + 12] = 3;
    paintOverlay(out, N, 'threat', c, EMPTY_NETWORK, [], null, null, threat);
    const a = (x: number): number => out[(10 * N + x) * 4 + 3]!;
    expect(a(10)).toBeGreaterThan(a(11)); expect(a(11)).toBeGreaterThan(0); expect(a(12)).toBe(0);
    expect(out[(10 * N + 10) * 4]).toBe(255); expect(out[(10 * N + 10) * 4 + 1]).toBeLessThan(out[(10 * N + 11) * 4 + 1]!); // redder when hotter
    paintOverlay(out, N, 'threat', c, EMPTY_NETWORK, [], null, null, null);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('wildlife news', () => {
  it('formats scare / hazed / relocated at the right tiers (relocation = important only)', () => {
    const where = (): { name: string; on: string; near: string } => ({ name: 'Upper Meadow Trail', on: 'on Upper Meadow Trail', near: 'near Upper Meadow Trail' });
    const sc = formatEvent('wildlife:scare', { animal: 'bear', id: 1, x: 5, y: 5, tile: 1, guests: 6, areaName: 'Upper Meadow Trail' }, { where })!;
    expect(sc.text).toBe('A bear is roaming near Upper Meadow Trail: hikers are avoiding the area');
    expect(sc.tier).toBe('important'); expect(sc.key).toBe('wildlife:scare:1');
    expect(formatEvent('wildlife:scare', { animal: 'bear', id: 1, x: 5, y: 5, tile: 1, guests: 2, areaName: '' }, { where })!.tier).toBe('info');
    expect(formatEvent('wildlife:hazed', { animal: 'bear', id: 1, x: 5, y: 5, station: 3 })!.tier).toBe('trivial');
    const rl = formatEvent('wildlife:relocated', { animal: 'bear', id: 1, x: 5, y: 5, toX: 40, toY: 40, station: 3, cost: 600 }, { where })!;
    expect(rl.tier).toBe('important');
    expect(GAME_EVENT_NAMES).toEqual(expect.arrayContaining(['wildlife:scare', 'wildlife:hazed', 'wildlife:relocated']));
  });
});
