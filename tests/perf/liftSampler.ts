import { Grid, TileType } from '../../src/world/Grid';
import { generateTerrain, terrainRelief } from '../../src/world/TerrainGen';
import { generateProps } from '../../src/world/Props';
import { Economy } from '../../src/sim/Economy';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { LiftStore, stationAnchor, validateLift, type LiftEnv } from '../../src/sim/Lift';

export const KINDS: LiftKind[] = ['tbar', 'chair4', 'gondola6', 'cablecar', 'funicular'];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Route { bx: number; by: number; tx: number; ty: number; len: number }
export interface Sampled { grid: Grid; env: LiftEnv; routes: Record<LiftKind, Route[]> }

const tileAvg = (g: Grid, x: number, y: number): number => { const c = g.getCorners(x, y); return (c[0] + c[1] + c[2] + c[3]) / 4; };
const wet = (g: Grid, x: number, y: number): boolean => { const t = g.tileType[g.tileIndex(x, y)]; return t === TileType.Water || t === TileType.Stream; };

/**
 * "Reasonable" routes: bottom on a non-water tile in the lower 60% of the relief, top on dry land in a random direction at a
 * length within [30%,100%] of the kind's range (capped at 60 tiles / 600 m so chosen lines stay local), with a drop >= max(20% of
 * relief * len/maxLen, 12% of the length) so the lift actually climbs. Both stations must be dry.
 */
export function sampleRoutes(size: 64 | 128 | 256, seed: number, perKind = 40, withProps = false): Sampled {
  const grid = new Grid(size);
  const info = generateTerrain(grid, seed);
  const env: LiftEnv = { grid, lifts: new LiftStore(grid.occupancy), economy: new Economy({ money: 1e12 }) };
  if (withProps) env.props = generateProps(grid, info.forestDensity, seed);
  const rand = rng(seed * 7919 + size);
  const relief = terrainRelief(size) * 0.5; // world units
  const routes = {} as Record<LiftKind, Route[]>;
  for (const kind of KINDS) {
    const def = LIFTS[kind];
    const out: Route[] = [];
    const maxLen = Math.min(def.maxLength, 60);
    let guard = 0;
    while (out.length < perKind && guard++ < 20000) {
      const L = maxLen * (0.3 + 0.7 * rand());
      if (L < 6) continue;
      const bx = 3 + Math.floor(rand() * (size - 6)), by = 3 + Math.floor(rand() * (size - 6));
      const a = rand() * Math.PI * 2;
      const tx = Math.round(bx + Math.cos(a) * L), ty = Math.round(by + Math.sin(a) * L);
      if (tx < 3 || ty < 3 || tx > size - 4 || ty > size - 4) continue;
      if (wet(grid, bx, by) || wet(grid, tx, ty)) continue;
      const hb = tileAvg(grid, bx, by) * 0.5, ht = tileAvg(grid, tx, ty) * 0.5;
      const minDrop = Math.max(0.2 * relief * (L / maxLen) * 0.5, 0.12 * L);
      if (ht - hb < minDrop) continue;
      out.push({ bx, by, tx, ty, len: L });
    }
    routes[kind] = out;
  }
  return { grid, env, routes };
}

export function normalise(r: string): string {
  return r.replace(/\([^)]*\)/g, '').replace(/\$?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
}

export interface KindTally { n: number; ok: number; reasons: Map<string, number>; firstReason: Map<string, number> }

export function runAll(sizes: Array<64 | 128 | 256> = [64, 128, 256], seeds = 20, perKind = 40, withProps = false, clearLane = true): Record<LiftKind, KindTally> {
  const tally = {} as Record<LiftKind, KindTally>;
  for (const k of KINDS) tally[k] = { n: 0, ok: 0, reasons: new Map(), firstReason: new Map() };
  for (const size of sizes) for (let seed = 1; seed <= seeds; seed++) {
    const s = sampleRoutes(size, seed, perKind, withProps);
    for (const kind of KINDS) for (const r of s.routes[kind]) {
      const c = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { autoFlatten: true, skipFunds: true, clearLane });
      const t = tally[kind];
      t.n++;
      if (c.ok) t.ok++;
      else {
        const ns = [...new Set(c.reasons.map(normalise))];
        ns.forEach((x, i) => { t.reasons.set(x, (t.reasons.get(x) ?? 0) + 1); if (i === 0) t.firstReason.set(x, (t.firstReason.get(x) ?? 0) + 1); });
      }
    }
  }
  return tally;
}

export function report(t: Record<LiftKind, KindTally>): string {
  const lines: string[] = [];
  for (const k of KINDS) {
    const x = t[k];
    lines.push(`${k.padEnd(10)} ${x.ok}/${x.n} = ${((100 * x.ok) / Math.max(1, x.n)).toFixed(1)}%`);
    for (const [r, c] of [...x.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) lines.push(`    ${String(c).padStart(5)}  ${r}`);
  }
  return lines.join('\n');
}
