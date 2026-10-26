import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Grid } from '@/world/Grid';
import { seatOf } from '@/sim/PlaceBuilding';
import { buildParts, DEFAULT_FOUNDATION } from '@/render/meshes';
import { tileLines, NET_NIGHT_GLSL } from '@/render/meshes/Paths';
import { Conn } from '@/world/Networks';
import { lightingAt, standardLights, luminance } from '@/render/Lighting';
import { readFileSync } from 'node:fs';

/** Tilted footprint: corner height = base + slope * (vx - x0). */
function slopedGrid(slope: number): Grid {
  const g = new Grid(64);
  for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, 20 + Math.round(slope * (vx - 10)));
  return g;
}
const minY = (geo: THREE.BufferGeometry | undefined): number => { if (!geo) return Infinity; geo.computeBoundingBox(); return geo.boundingBox!.min.y; };

describe('building seat on slopes', () => {
  it('flat footprints keep the default plinth and the corner height', () => {
    const s = seatOf(slopedGrid(0), 10, 10, 2, 2);
    expect(s.depth).toBe(DEFAULT_FOUNDATION);
    expect(s.y).toBe(20 * 0.5);
  });
  it('sloped footprints sit on the HIGHEST corner and the plinth reaches the lowest corner (nothing buried)', () => {
    for (const [slope, w] of [[0.5, 2], [1, 2], [0.5, 4], [1, 2]] as const) {
      const g = slopedGrid(slope);
      const s = seatOf(g, 10, 10, w, 2);
      const lowest = Math.min(...[10, 10 + w].map((vx) => g.getCorner(vx, 10))) * 0.5;
      expect(s.y).toBeGreaterThanOrEqual(g.getCorner(10 + w, 10) * 0.5);
      expect(s.y - s.depth).toBeLessThanOrEqual(lowest - 0.05 + 1e-9); // plinth bottom is below the lowest corner
      expect(s.depth).toBeLessThanOrEqual(w * slope * 0.5 + 0.12 + 1e-9 + DEFAULT_FOUNDATION);
    }
  });
  it('spread <= 2 half-steps (placement limit) gives a plinth <= 1.12', () => {
    expect(seatOf(slopedGrid(1), 10, 10, 2, 2).depth).toBeLessThanOrEqual(1.12 + 1e-9);
  });
  it('foundation and non-foundation (farm, cannon) meshes both extend down by the requested depth', () => {
    for (const id of ['firstAid', 'alpineFarm', 'snowCannon', 'rangerStation']) {
      const sizes: Record<string, [number, number]> = { firstAid: [2, 2], alpineFarm: [6, 5], snowCannon: [1, 1], rangerStation: [4, 3] };
      const [w, h] = sizes[id]!;
      const p = buildParts(id, w, h, 1.0);
      const lo = Math.min(minY(p.stone), minY(p.wood), minY(p.roof));
      expect(lo).toBeLessThanOrEqual(-0.95);
    }
    const flat = buildParts('alpineFarm', 6, 5);
    expect(Math.min(minY(flat.stone), minY(flat.wood))).toBeGreaterThan(-0.4); // flat farm keeps no deep plinth (fence posts dip a little)
  });
});

describe('road / path continuity', () => {
  it('centre-lines of adjacent tiles meet at the shared edge midpoint (no lateral jog)', () => {
    for (let m1 = 1; m1 < 16; m1++) for (let m2 = 1; m2 < 16; m2++) {
      if (!(m1 & Conn.E) || !(m2 & Conn.W)) continue;
      const a = tileLines(4, 4, m1, 64, 0.2), b = tileLines(5, 4, m2, 64, 0.2);
      const ends = (ls: ReturnType<typeof tileLines>): Array<[number, number]> => ls.flatMap((l) => [l.pts[0]!, l.pts[l.pts.length - 1]!]);
      const onEdge = (pts: Array<[number, number]>): Array<[number, number]> => pts.filter((p) => Math.abs(p[0] - 5) < 1e-9);
      const ea = onEdge(ends(a)), eb = onEdge(ends(b));
      expect(ea.length).toBeGreaterThan(0); expect(eb.length).toBeGreaterThan(0);
      for (const p of [...ea, ...eb]) expect(p[1]).toBeCloseTo(4.5, 9); // edge midpoint
    }
  });
});

describe('night look constants', () => {
  it('road night floor: asphalt (albedo 0.07) gets >= 20% of its noon radiance at midnight', () => {
    const p = lightingAt(0), L = standardLights(p), p12 = lightingAt(12), L12 = standardLights(p12);
    const rad = (l: typeof L, pp: typeof p): number => 0.07 * (luminance(l.hemiSky) * l.hemiIntensity + luminance(l.sunColor) * l.sunIntensity * 0.5) / Math.PI * (1 - 0 * pp.night);
    const floor = (0.07 * 0.06 + (0.2126 * 0.010 + 0.7152 * 0.013 + 0.0722 * 0.026)) * p.night;
    expect(NET_NIGHT_GLSL).toContain('uNetNight');
    expect((rad(L, p) + floor) / rad(L12, p12)).toBeGreaterThan(0.2);
  });
  it('terrain shader damps drift/contour variation at night', () => {
    const src = readFileSync('src/render/TerrainMesh.ts', 'utf8');
    expect(src).toContain('float dayK = smoothstep(0.25, 0.55, uSkyColor.b)');
    expect(src).toContain('mix(0.3, 1.0, dayK)');
    // the night shader sky blue (0.22) is below the damping threshold, the day value (0.68) above it
    expect(lightingAt(0).shaderSky[2]).toBeLessThan(0.25);
    expect(lightingAt(12).shaderSky[2]).toBeGreaterThan(0.55);
  });
});
