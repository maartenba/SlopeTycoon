import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { stationAnchor, validateLift } from '../../src/sim/Lift';
import { KINDS, sampleRoutes } from './liftSampler';

const ROUTE_OF: Partial<Record<LiftKind, LiftKind>> = { chair6: 'chair4', gondola10: 'gondola6' };

export interface TowerSample { kind: LiftKind; size: number; seed: number; route: { bx: number; by: number; tx: number; ty: number }; h: number; ratio: number; span: number; n: number; lane: boolean; ok: boolean }

const pct = (a: number[], p: number): number => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : 0);

/** Tower height (head - ground) stats per kind over many routes (forest on). Returns every route's tallest tower. */
export function measureHeights(sizes: Array<64 | 128 | 256>, seeds: number, perKind: number, clearLane: boolean, kinds: LiftKind[] = KINDS): TowerSample[] {
  const out: TowerSample[] = [];
  for (const size of sizes) for (let seed = 1; seed <= seeds; seed++) {
    const s = sampleRoutes(size, seed, perKind, true);
    for (const kind of kinds) for (const r of s.routes[ROUTE_OF[kind] ?? kind]) {
      const c = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { autoFlatten: true, skipFunds: true, clearLane });
      if (!c.data || c.data.towers.length === 0) continue;
      let h = 0;
      for (const t of c.data.towers) h = Math.max(h, t.headY - t.groundY);
      const ns = c.data.nodes;
      let span = 0;
      for (let i = 1; i < ns.length; i++) span = Math.max(span, Math.hypot(ns[i]!.x - ns[i - 1]!.x, ns[i]!.z - ns[i - 1]!.z));
      out.push({ kind, size, seed, route: r, h, ratio: h / span, span, n: c.data.towers.length, lane: clearLane, ok: c.ok });
    }
  }
  return out;
}

export function summarize(s: TowerSample[], kinds: LiftKind[] = KINDS): string {
  const lines: string[] = [];
  for (const k of kinds) {
    const a = s.filter((x) => x.kind === k && x.ok);
    const h = a.map((x) => x.h).sort((p, q) => p - q);
    const r = a.map((x) => x.ratio).sort((p, q) => p - q);
    lines.push(`${k.padEnd(9)} n=${String(a.length).padStart(4)} cap-ish h p50=${pct(h, 0.5).toFixed(2)} p90=${pct(h, 0.9).toFixed(2)} p99=${pct(h, 0.99).toFixed(2)} max=${pct(h, 1).toFixed(2)} | h/span p50=${pct(r, 0.5).toFixed(2)} p99=${pct(r, 0.99).toFixed(2)} max=${pct(r, 1).toFixed(2)} | maxLen ${LIFTS[k].maxLength}`);
  }
  return lines.join('\n');
}
