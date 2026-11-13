import { FARM_WORK as F } from '../config/farmWork';
import { DAYS_PER_MONTH, type GraphicsQuality } from '../config/balance';
import type { WeatherKind } from '../core/events';
import { calendarDayOfMonth, realMonthOfDay } from '../sim/calendar';
import { buildOwner, legWaypoints } from '../sim/ops/groomPath';
import { OccFlag } from '../world/Occupancy';
import { TileType, type Grid } from '../world/Grid';
import { PropKind, type PropChunk } from '../world/Props';
import { hash01 } from './ApresNotes';

/**
 * Summer farm vehicles, the pure half (docs/farm-work.md): season / hour / weather schedule, the work-spot and route planner (building-, water-, tree- and piste-avoiding, reusing the snowcat
 * A* from sim/ops/groomPath), the trip timeline (drive out, mow two rows, drop bales, drive home, unload) and the hay-load curve. Render-only: no sim Rng, nothing saved; every choice is a stable
 * hash of (seed, day, farm id, tractor, trip), so the same inputs give the same trip. Tile coordinates: x, y (y is world z).
 */
export const BLOCK = 0x3fffffff;
const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const ease = (p: number): number => p * p * (3 - 2 * p);
/** Stable 0..1 hash of any number of ints (no RNG). */
export function hk(...xs: number[]): number { let h = 0.37; for (const x of xs) h = hash01(Math.floor(h * 1e9) | 0, x | 0); return h; }

export type FarmPhase = 'off' | 'parked' | 'work';
/** Season gate: zero outside Jun-Sep; parked (visible, no trips) in the first / last `edgeDays` days of the window, so they fade in / out by sitting in the farm. */
export function farmPhase(day: number): FarmPhase {
  const m = realMonthOfDay(day);
  if (m < F.summerMonths[0] || m > F.summerMonths[1]) return 'off';
  const d = calendarDayOfMonth(day);
  if (m === F.summerMonths[0] && d <= F.edgeDays) return 'parked';
  if (m === F.summerMonths[1] && d > DAYS_PER_MONTH - F.edgeDays) return 'parked';
  return 'work';
}
export const weatherAllowsWork = (w: WeatherKind): boolean => w === 'clear' || w === 'cloudy';
/** May tractor `idx` (0-based) leave the farm now? Morning and afternoon windows with the lunch break at the farm; the second tractor starts later. */
export function mayDepart(hour: number, idx: number, jitter = 0): boolean {
  const H = F.hours, start = H.earliest + idx * H.stagger + jitter * 0.5;
  return hour >= start && ((hour < H.lunch[0]) || (hour >= H.lunch[1] && hour < H.lastDepart));
}
/** Must a tractor on the road go home now (night, evening, rain / storm / snow)? */
export const mustBeHome = (hour: number, w: WeatherKind): boolean => hour >= F.hours.home || hour < F.hours.earliest - 0.5 || !weatherAllowsWork(w);
/** Tractors per farm for a graphics quality and an Atmosphere level (Off = none, Low = at most one). */
export function tractorCap(quality: GraphicsQuality, atmos: 'off' | 'low' | 'high'): number {
  if (atmos === 'off') return 0;
  return Math.min(F.perFarm[quality], atmos === 'low' ? 1 : 2);
}
/** Hay load (0..F.load.max) after a share `p` (0..1) of the two mown rows. */
export const hayLoadAt = (p: number): number => F.load.max * ease(clamp01(p));
/** Patch visibility 0..1 `age` seconds after the tractor left it: held, then faded. */
export const patchLevel = (age: number): number => (age <= F.patchHold ? 1 : clamp01(1 - (age - F.patchHold) / F.patchFade));

export interface WorkWorld { size: number; owner: Int32Array; flat: Uint8Array; /** Average corner height of each tile (grid units): pastures stay near the farm's own altitude. */ hgt: Int16Array }
const TREEISH = new Set<number>([PropKind.Conifer, PropKind.Deciduous, PropKind.Pine, PropKind.Larch, PropKind.Birch, PropKind.Oak, PropKind.Shrub, PropKind.Snag, PropKind.Rock]);
/** Occupancy / terrain snapshot for the planner: `owner` = building id + 1 on footprints, BLOCK on water, forest, rock, ice, steep ground, pistes, lifts, decor and tiles with trees / rocks; `flat` = gentle enough to mow. */
export function buildWorkWorld(grid: Grid, buildings: Iterable<{ id: number; x: number; y: number; w: number; h: number }>, props?: { chunks: readonly Pick<PropChunk, 'kind' | 'tx' | 'ty'>[] }): WorkWorld {
  const N = grid.size, owner = buildOwner(N, buildings), flat = new Uint8Array(N * N), hgt = new Int16Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, t = grid.tileType[i]!;
    const [a, b, c, d] = grid.getCorners(x, y), range = Math.max(a, b, c, d) - Math.min(a, b, c, d);
    const bad = (t !== TileType.Grass && t !== TileType.Dirt) || (grid.occupancy.flags[i]! & (OccFlag.Piste | OccFlag.Lift | OccFlag.Decor | OccFlag.Water)) !== 0 || range > 2;
    if (bad && owner[i] === 0) owner[i] = BLOCK;
    hgt[i] = Math.round((a + b + c + d) / 4);
    if (!bad && range <= 1 && grid.snowDepth[i]! < 0.02 && grid.occupancy.flags[i] === 0) flat[i] = 1; // mown patches only on bare pasture (never on a road, path or plaza; driving across one is fine)
  }
  if (props) for (const c of props.chunks) for (let k = 0; k < c.kind.length; k++) if (TREEISH.has(c.kind[k]!)) { const i = c.ty[k]! * N + c.tx[k]!; if (owner[i] === 0) owner[i] = BLOCK; flat[i] = 0; }
  return { size: N, owner, flat, hgt };
}

export interface FarmSite { id: number; /** Where tractors leave the farm / come back to (outside the footprint, on its front side): the planner tries them in turn when one is walled in. */ gates: ReadonlyArray<{ x: number; y: number }>; /** Parking spots inside the farm (one per tractor). */ park: ReadonlyArray<{ x: number; y: number }> }
export interface MowRow { x0: number; y0: number; x1: number; y1: number; s0: number; s1: number }
export interface TripPlan {
  pts: number[]; cum: number[]; spd: number[]; total: number;
  rows: MowRow[]; bales: Array<{ x: number; y: number; s: number }>; dwells: Array<{ s: number; dur: number }>;
  /** Carried load of a "go home" plan (an aborted trip); undefined for a work trip. */
  loadStart?: number; home?: boolean;
  /** Patch centre (work trips) for the avoid-list. */
  cx: number; cy: number;
}

const arc = (cx: number, cy: number, ax: number, ay: number, nx: number, ny: number, r: number, n = 8): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let k = 1; k < n; k++) { const t = (k / n) * Math.PI; out.push([cx + (-nx * Math.cos(t) + ax * Math.sin(t)) * r, cy + (-ny * Math.cos(t) + ay * Math.sin(t)) * r]); }
  return out;
};

function chaikin(p: Array<[number, number]>, it = 2): Array<[number, number]> {
  let pts = p;
  for (let k = 0; k < it && pts.length > 2; k++) {
    const q: Array<[number, number]> = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i]!, b = pts[i + 1]!; if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]); if (i < pts.length - 2) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    q.push(pts[pts.length - 1]!); pts = q;
  }
  return pts;
}

const MARGIN = 0.3;
const tileFree = (w: WorkWorld, x: number, y: number, own: number): boolean => { const tx = Math.floor(x), ty = Math.floor(y); if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) return false; const o = w.owner[ty * w.size + tx]!; return o === 0 || o === own + 1; };
/** Dense line check (every 0.08 tile, so a corner clip cannot slip between samples) with a body margin on all four sides. */
const legOk = (w: WorkWorld, a: [number, number], b: [number, number], own: number): boolean => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 0.08));
  for (let i = 0; i <= n; i++) { const u = i / n, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u; if (!(tileFree(w, x, y, own) && tileFree(w, x - MARGIN, y, own) && tileFree(w, x + MARGIN, y, own) && tileFree(w, x, y - MARGIN, own) && tileFree(w, x, y + MARGIN, own))) return false; }
  return true;
};
const polyOk = (w: WorkWorld, p: Array<[number, number]>, own: number): boolean => { for (let i = 0; i < p.length - 1; i++) if (!legOk(w, p[i]!, p[i + 1]!, own)) return false; return true; };
/** A drivable route a -> b around footprints (A* with line-of-sight shortcuts, corners rounded), or null when no clear way exists. */
export function driveRoute(w: WorkWorld, a: [number, number], b: [number, number], own: number): Array<[number, number]> | null {
  const wp = legWaypoints(w.owner, w.size, a[0], a[1], b[0], b[1], own), raw: Array<[number, number]> = [a];
  for (let i = 0; i < wp.length; i += 2) raw.push([wp[i]!, wp[i + 1]!]);
  raw.push(b);
  if (!polyOk(w, raw, own)) return null;
  const sm = chaikin(raw, 2);
  return polyOk(w, sm, own) ? sm : raw;
}

/** Is a mowing patch (rows + the turning room at both ends) centred at c with axis a entirely free, flat ground? */
export function patchOk(w: WorkWorld, cx: number, cy: number, ax: number, ay: number, h0?: number): boolean {
  const L = F.patch.length / 2 + 0.9, V = F.patch.rowGap / 2 + 0.55, nx = -ay, ny = ax;
  for (let u = -L; u <= L + 1e-6; u += 0.45) for (let v = -V; v <= V + 1e-6; v += 0.45) {
    const x = cx + ax * u + nx * v, y = cy + ay * u + ny * v, tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) return false;
    const i = ty * w.size + tx; if (w.owner[i] !== 0 || w.flat[i] !== 1 || (h0 !== undefined && Math.abs(w.hgt[i]! - h0) > F.patch.maxClimb)) return false;
  }
  return true;
}

function finish(pts: Array<[number, number]>, spd: number[], extra: Partial<TripPlan> & { cx: number; cy: number }): TripPlan {
  const flat: number[] = [], cum = [0];
  pts.forEach((p, i) => { flat.push(p[0], p[1]); if (i) cum.push(cum[i - 1]! + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])); });
  return { pts: flat, cum, spd, total: cum[cum.length - 1]!, rows: [], bales: [], dwells: [], ...extra };
}

/** Work trip of tractor `idx` from `site`: leave by the gate, drive to a hashed pasture patch within F.patch.maxDist, mow a row, U-turn, mow back (bales dropped behind), drive home, unload. null = no valid spot / route. */
export function planTrip(w: WorkWorld, site: FarmSite, idx: number, key: number, avoid: ReadonlyArray<{ x: number; y: number }> = []): TripPlan | null {
  const P = F.patch, own = site.id, park = site.park[idx % site.park.length]!, pk: [number, number] = [park.x, park.y], ng = site.gates.length, g0 = Math.floor(hk(key, 77) * ng), h0 = w.hgt[Math.min(w.size - 1, Math.max(0, Math.floor(site.gates[0]!.y))) * w.size + Math.min(w.size - 1, Math.max(0, Math.floor(site.gates[0]!.x)))]!;
  for (let i = 0; i < P.tries; i++) {
    const gp = site.gates[(g0 + i) % ng]!, g: [number, number] = [gp.x, gp.y];
    const r = P.minDist + hk(key, i, 1) * ((i < P.tries / 2 ? P.nearDist : P.maxDist) - P.minDist), ang = hk(key, i, 2) * TAU;
    const cx = g[0] + Math.cos(ang) * r, cy = g[1] + Math.sin(ang) * r;
    if (avoid.some((a) => Math.hypot(a.x - cx, a.y - cy) < P.avoid)) continue;
    const vertical = hk(key, i, 3) < 0.5, sgn = hk(key, i, 4) < 0.5 ? -1 : 1;
    let ax = vertical ? 0 : sgn, ay = vertical ? sgn : 0;
    if (ax * (cx - g[0]) + ay * (cy - g[1]) < 0) { ax = -ax; ay = -ay; } // the first row starts at the end nearer to the gate
    const nsg = hk(key, i, 5) < 0.5 ? -1 : 1, nx = -ay * nsg, ny = ax * nsg, L = P.length / 2, q = P.rowGap / 2;
    if (!patchOk(w, cx, cy, ax, ay, h0)) continue;
    const SA: [number, number] = [cx - ax * L - nx * q, cy - ay * L - ny * q], EA: [number, number] = [cx + ax * L - nx * q, cy + ay * L - ny * q];
    const SB: [number, number] = [cx + ax * L + nx * q, cy + ay * L + ny * q], EB: [number, number] = [cx - ax * L + nx * q, cy - ay * L + ny * q];
    const out = driveRoute(w, g, SA, own), back = driveRoute(w, EB, g, own);
    if (!out || !back) continue;
    const pts: Array<[number, number]> = [pk], spd: number[] = [];
    const push = (p: Array<[number, number]>, s: number): void => { for (const q2 of p) { pts.push(q2); spd.push(s); } };
    push(out, F.speed.drive); // park -> gate (first point of `out` is the gate) -> ... -> SA
    const iSA = pts.length - 1;
    push([EA], F.speed.mow); const iEA = pts.length - 1;
    push(arc(cx + ax * L, cy + ay * L, ax, ay, nx, ny, q), F.speed.turn); push([SB], F.speed.turn); const iSB = pts.length - 1;
    push([EB], F.speed.mow); const iEB = pts.length - 1;
    push(back.slice(1), F.speed.drive); push([pk], F.speed.turn);
    const plan = finish(pts, spd, { cx, cy }), cum = plan.cum;
    if (plan.total > P.maxPath * 2) continue;
    plan.rows = [{ x0: SA[0], y0: SA[1], x1: EA[0], y1: EA[1], s0: cum[iSA]!, s1: cum[iEA]! }, { x0: SB[0], y0: SB[1], x1: EB[0], y1: EB[1], s0: cum[iSB]!, s1: cum[iEB]! }];
    const rb = plan.rows[1]!;
    for (let k = 1; k <= F.bales.perPatch; k++) { const f = k / (F.bales.perPatch + 1); plan.bales.push({ x: rb.x0 + (rb.x1 - rb.x0) * f + (hk(key, i, 10 + k) - 0.5) * 0.12, y: rb.y0 + (rb.y1 - rb.y0) * f + (hk(key, i, 20 + k) - 0.5) * 0.12, s: rb.s0 + (rb.s1 - rb.s0) * f + 0.85 }); }
    plan.dwells = [{ s: 0, dur: F.turnSec }, { s: plan.rows[0]!.s0, dur: F.patchStop }, { s: rb.s1, dur: F.patchStop }];
    return plan;
  }
  return null;
}

/** "Go home" plan for an aborted trip (rain, evening): from the current position round footprints to the gate and into the farm, carrying `load`. */
export function planHome(w: WorkWorld, site: FarmSite, idx: number, from: { x: number; y: number }, load: number): TripPlan {
  const park = site.park[idx % site.park.length]!, a: [number, number] = [from.x, from.y];
  let route: Array<[number, number]> | null = null, g: [number, number] = [site.gates[0]!.x, site.gates[0]!.y];
  for (const gp of [...site.gates].sort((u, v) => Math.hypot(u.x - from.x, u.y - from.y) - Math.hypot(v.x - from.x, v.y - from.y))) { route = driveRoute(w, a, [gp.x, gp.y], site.id); if (route) { g = [gp.x, gp.y]; break; } }
  route ??= [a, g];
  const pts = [...route, [park.x, park.y] as [number, number]], spd = pts.slice(1).map((_, i) => (i === pts.length - 2 ? F.speed.turn : F.speed.drive));
  return finish(pts, spd, { cx: from.x, cy: from.y, home: true, loadStart: load });
}

export interface Runner { plan: TripPlan; s: number; dwellIdx: number; dwellLeft: number; dwellTotal: number; unloading: boolean; unloadT: number; done: boolean; t: number }
export const newRunner = (plan: TripPlan): Runner => ({ plan, s: 0, dwellIdx: 0, dwellLeft: 0, dwellTotal: 0, unloading: false, unloadT: 0, done: false, t: 0 });

function segAt(plan: TripPlan, s: number): number {
  const c = plan.cum; let lo = 0, hi = c.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m]! <= s) lo = m; else hi = m - 1; }
  return Math.max(0, lo);
}
/** Position (tile units) at distance `s` along the plan; before the start it extends backwards along the first segment (the trailer). */
export function posAt(plan: TripPlan, s: number): { x: number; y: number } {
  const p = plan.pts, n = p.length / 2;
  if (n < 2) return { x: p[0] ?? 0, y: p[1] ?? 0 };
  if (s <= 0) { const dx = p[2]! - p[0]!, dy = p[3]! - p[1]!, l = Math.hypot(dx, dy) || 1; return { x: p[0]! + (dx / l) * s, y: p[1]! + (dy / l) * s }; }
  if (s >= plan.total) return { x: p[(n - 1) * 2]!, y: p[(n - 1) * 2 + 1]! };
  const i = segAt(plan, s), l = plan.cum[i + 1]! - plan.cum[i]!, f = l > 1e-9 ? (s - plan.cum[i]!) / l : 0;
  return { x: p[i * 2]! + (p[i * 2 + 2]! - p[i * 2]!) * f, y: p[i * 2 + 1]! + (p[i * 2 + 3]! - p[i * 2 + 1]!) * f };
}
/** Heading (rad, atan2(dy, dx)) smoothed over 0.24 tiles. */
export function headingAt(plan: TripPlan, s: number): number {
  const a = posAt(plan, Math.max(0, s - 0.12)), b = posAt(plan, Math.min(plan.total, s + 0.12));
  return Math.hypot(b.x - a.x, b.y - a.y) < 1e-6 ? headingAt(plan, Math.min(plan.total - 0.3, Math.max(0.3, s + 0.3))) : Math.atan2(b.y - a.y, b.x - a.x);
}
export function lerpAngle(a: number, b: number, t: number): number { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; }

/** Advance a runner by `dt` real seconds (dwells at the gate / patch ends, a drive-speed per segment, the unload stop at the end). */
export function stepRunner(r: Runner, dt: number): void {
  if (r.done) return;
  r.t += dt;
  let t = dt, guard = 0;
  while (t > 1e-9 && !r.done && guard++ < 16) {
    if (r.dwellLeft > 0) { const d = Math.min(t, r.dwellLeft); r.dwellLeft -= d; t -= d; if (r.unloading) r.unloadT += d; if (r.dwellLeft <= 1e-9 && r.unloading) r.done = true; continue; }
    const nd = r.plan.dwells[r.dwellIdx], target = nd ? nd.s : r.plan.total, spd = r.plan.spd[segAt(r.plan, r.s)] ?? F.speed.drive;
    const dist = Math.min(spd * t, target - r.s);
    if (dist > 0) { r.s += dist; t -= dist / spd; }
    if (r.s >= target - 1e-9) {
      r.s = target;
      if (nd) { r.dwellIdx++; r.dwellLeft = nd.dur; r.dwellTotal = nd.dur; } else { r.unloading = true; r.dwellLeft = F.unloadSec; r.dwellTotal = F.unloadSec; }
    }
  }
}

/** Hay load on the trailer (0..F.load.max): grows over the two mown rows, stays, and empties during the unload stop. */
export function loadOf(r: Runner): number {
  const p = r.plan;
  let l = p.home ? (p.loadStart ?? 0) : p.rows.length === 2 ? hayLoadAt((r.s - p.rows[0]!.s0) / (p.rows[1]!.s1 - p.rows[0]!.s0)) : 0;
  if (r.unloading) l *= 1 - clamp01(r.unloadT / F.unloadSec);
  return l;
}
/** Share 0..1 of row `i` already mown at distance `s`. */
export const rowProgress = (plan: TripPlan, s: number, i: number): number => { const row = plan.rows[i]; return row ? clamp01((s - row.s0) / (row.s1 - row.s0)) : 0; };
