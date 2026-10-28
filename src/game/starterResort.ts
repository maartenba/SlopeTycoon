import { BUILDINGS } from '../config/buildings';
import { TileType } from '../world/Grid';
import { OccFlag } from '../world/Occupancy';
import { Layer, NetKind, interpolateStroke, sweepBrush, type Rect } from '../world/Networks';
import { placeBuilding } from '../sim/PlaceBuilding';
import { placeLift, type LiftData, type StationSite } from '../sim/Lift';
import { snapLift } from '../sim/LiftAssist';
import { autoFlattenDefault } from '../sim/PlacementRules';
import type { PlacedBuilding } from '../sim/Buildings';
import type { LiftKind } from '../config/lifts';
import type { Sim } from './createSim';

type Pt = { x: number; y: number };

export interface StarterOptions {
  /** Demo towns: footpaths / roads branch off existing ones with gentle diagonal steps (Networks.routeFrom) instead of one strip per building. Off for the bot / tests (keeps their economy identical). */
  curvedPaths?: boolean;
  /** Number of lifts (default: 1 / 1 / 2 by map size). */
  lifts?: number;
  /** Ski-lift kind (default chairlift). */
  liftKind?: LiftKind;
  /** Snowmaking cannons (default 3 / 5 / 8). */
  cannons?: number;
  /** Extra attractions (default 2 / 3 / 4). */
  attractions?: number;
  /** Per-lift kinds (cycled; each falls back to chair4 when the kind has no valid line). Overrides `liftKind`. */
  liftKinds?: LiftKind[];
  /** Per-piste difficulty override (0 green .. 3 black), indexed like the lifts. */
  pisteDifficulties?: number[];
  /** Skip the village services / snowmaking / attractions (re-runs on a resort that already has them). */
  skipCore?: boolean;
  /** Called after lifts + pistes, before the village services (reserve sites that need special access, e.g. the train station). */
  pre?: (kit: ResortKit) => void;
  /** Called at the very end with the builder toolkit (used by buildDemoResort to add more on top). */
  extra?: (kit: ResortKit) => void;
  /** Free toilet beside the village footpath (comfort need). Default: placed when the sim has the comfort need ON; false = none (before/after rating probes). */
  toilet?: boolean;
  /** Funds the resort is topped up to before building (so placement never fails on money). */
  funds?: number;
}

export interface StarterReport {
  lifts: LiftData[];
  pisteTiles: number;
  /** building type -> count placed */
  placed: Record<string, number>;
  /** Things the helper could not place (should be empty on the standard seeds). */
  failures: string[];
}

/** Toolkit handed to `StarterOptions.extra`. */
/** Types whose rule allows a footpath but which the generated resorts still connect by road. */
const ROAD_SERVED = new Set(['shop', 'chalet', 'apartment']);

export interface ResortKit {
  sim: Sim;
  report: StarterReport;
  lodge: PlacedBuilding;
  lc: Pt;
  roadTile: Pt;
  pisteStroke: Pt[][];
  place(type: string, ax: number, ay: number, rmax: number, autoFlatten?: boolean, rot?: number, avoidPiste?: boolean): PlacedBuilding | null;
  placeConnected(type: string, ax: number, ay: number, rmax: number, autoFlatten?: boolean): PlacedBuilding | null;
  ensurePath(r: Rect): boolean;
  ensureRoad(r: Rect): boolean;
  settle(): void;
  fail(msg: string): void;
}

const ringOf = (r: Rect): Pt[] => {
  const out: Pt[] = [];
  for (let x = r.x; x < r.x + r.w; x++) { out.push({ x, y: r.y - 1 }, { x, y: r.y + r.h }); }
  for (let y = r.y; y < r.y + r.h; y++) { out.push({ x: r.x - 1, y }, { x: r.x + r.w, y }); }
  return out;
};

/**
 * Sim-only helper: builds a standard, scaled starter resort through the REAL placement / network / lift APIs (no renderer).
 * Used by smoke tests, benchmarks and (later) the tutorial. Deterministic in the sim's seed.
 */
/** Builds the pre-made starter chain; the Career unlock gate is bypassed (`bypassUnlocks`: it is a free gift, tutorial chain and balance bot included). */
export function buildStarterResort(sim: Sim, opt: StarterOptions = {}): StarterReport {
  return sim.progression.withBypass(() => buildStarter(sim, opt));
}

function buildStarter(sim: Sim, opt: StarterOptions): StarterReport {
  const { grid, props, env, networks, buildings, economy, size } = sim;
  const scale = size >= 256 ? 2 : size >= 128 ? 1 : 0;
  const nLifts = opt.lifts ?? (scale === 2 ? 2 : 1);
  const nCannons = opt.cannons ?? [3, 5, 8][scale]!;
  const nAttr = opt.attractions ?? [2, 3, 4][scale]!;
  const report: StarterReport = { lifts: [], pisteTiles: 0, placed: {}, failures: [] };
  const fail = (m: string): void => { report.failures.push(m); };
  const topUp = opt.funds ?? 5_000_000;
  if (sim.game.money < topUp) sim.game.money = topUp;

  const lodge = buildings.all().find((b) => b.type === 'baseLodge');
  if (!lodge) { fail('no base lodge'); return report; }
  const lc: Pt = { x: lodge.x + lodge.w / 2, y: lodge.y + lodge.h / 2 };
  const settle = (): void => { buildings.reevaluate(); sim.refreshCoverage(undefined, true); };

  /** Footpath from the lodge to (a tile adjacent to) `r`; no-op when already served. */
  const ensurePath = (r: Rect): boolean => {
    if (networks.serves('path', r)) return true;
    const goalSet = new Set(ringOf(r).map((t) => networks.idxOf(t.x, t.y)));
    const starts = ringOf(lodge).filter((s) => networks.inBounds(s.x, s.y));
    // branch off the nearest existing footpath (or the lodge ring) with gentle diagonal steps: no parallel "barcode" strips
    const route = !opt.curvedPaths ? [] : networks.routeFrom(NetKind.Path, starts, (x, y) => goalSet.has(networks.idxOf(x, y)));
    if (route.length) { for (const t of route) networks.build(NetKind.Path, t.x, t.y); if (networks.serves('path', r)) return true; }
    for (const s of starts) {
      const route2 = networks.route(NetKind.Path, s, s, 0, (x, y) => goalSet.has(networks.idxOf(x, y)));
      if (route2.length) { for (const t of route2) networks.build(NetKind.Path, t.x, t.y); if (networks.serves('path', r)) return true; }
    }
    return networks.serves('path', r);
  };
  /** Road from the road entry to `r`. */
  const ensureRoad = (r: Rect): boolean => {
    if (networks.serves('road', r)) return true;
    const e = networks.roadEntry;
    if (!e) return false;
    const goalSet = new Set(ringOf(r).map((t) => networks.idxOf(t.x, t.y)));
    let route = !opt.curvedPaths ? [] : networks.routeFrom(NetKind.Road, [e], (x, y) => goalSet.has(networks.idxOf(x, y)), 'straight');
    if (!route.length) route = networks.route(NetKind.Road, e, e, 0, (x, y) => goalSet.has(networks.idxOf(x, y)));
    for (const t of route) networks.build(NetKind.Road, t.x, t.y);
    return networks.serves('road', r);
  };

  const touchesPiste = (x: number, y: number, w: number, h: number): boolean => {
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (networks.pisteAt(i, j)) return true;
    return false;
  };
  /** Spiral search for a valid site around (ax, ay). */
  const place = (type: string, ax: number, ay: number, rmax: number, autoFlatten = autoFlattenDefault(type), rot = 0, avoidPiste = false): PlacedBuilding | null => {
    const def = BUILDINGS[type]!;
    for (let r = 0; r <= rmax; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (let rr = 0; rr < (def.w === def.h ? 1 : 4); rr++) {
        const rotn = (rot + rr) % 4;
        const fw = rotn % 2 ? def.h : def.w, fh = rotn % 2 ? def.w : def.h;
        if (avoidPiste && touchesPiste(Math.round(ax) - (fw >> 1) + dx, Math.round(ay) - (fh >> 1) + dy, fw, fh)) continue;
        const out = placeBuilding(env, props, type, Math.round(ax) - (fw >> 1) + dx, Math.round(ay) - (fh >> 1) + dy, rotn, autoFlatten, false);
        if (out.ok && out.building) {
          report.placed[type] = (report.placed[type] ?? 0) + 1;
          sim.refreshCoverage(out.building, out.changed.length > 0);
          return out.building;
        }
        }
      }
    }
    return null;
  };
  /** Place and connect with the access it asks for. */
  const placeConnected = (type: string, ax: number, ay: number, rmax: number, autoFlatten?: boolean): PlacedBuilding | null => {
    const b = place(type, ax, ay, rmax, autoFlatten);
    if (!b) { fail(`cannot place ${type}`); return null; }
    const access = BUILDINGS[type]!.access;
    // Shop / chalet / apartment accept a footpath now, but the built resorts keep serving them by road (the vetted layouts and goldens stay put; the village road is the better-looking choice).
    if (access === 'road' || ROAD_SERVED.has(type)) ensureRoad(b); else if (access === 'path' || access === 'pisteEdge') ensurePath(b);
    settle();
    return b;
  };

  // ---- core services around the lodge (road stub ends beside the lodge) ----
  const roadTile = ((): Pt => {
    const e = networks.roadEntry!;
    return { x: Math.round((e.x + lc.x) / 2), y: Math.round((e.y + lc.y) / 2) };
  })();

  // ---- lifts + pistes ----
  const bottoms: Pt[] = [];
  const baseKind = opt.liftKind ?? 'chair4';
  const planEnv = { grid, lifts: sim.lifts, economy, props, buildings: sim.buildings };
  const radii: number[] = [8, 11, 14, 17];
  for (let r = 22; r <= size * 0.45; r += 5) radii.push(r);
  const pisteLines: Array<{ top: Pt; bottom: Pt; side: 1 | -1 }> = [];
  /** Piste beside a lift: from the top station's edge, `off` tiles to one side of the line, down to the bottom station. */
  const pisteGeom = (top: Pt, bottom: Pt, side: 1 | -1): { full: Pt[]; stroke: Pt[]; b: Pt } => {
    const dx = bottom.x - top.x, dy = bottom.y - top.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * side, ny = (dx / len) * side; // perpendicular
    const off = 3;
    const ax = top.x + 1 + nx * off, ay = top.y + 1 + ny * off;
    const head = ringOf({ x: top.x, y: top.y, w: 2, h: 2 }).filter((t) => t.x >= 1 && t.y >= 1 && t.x < size - 1 && t.y < size - 1)
      .reduce((bst, t) => (Math.hypot(t.x - ax, t.y - ay) < Math.hypot(bst.x - ax, bst.y - ay) ? t : bst));
    const a = { x: Math.round(ax), y: Math.round(ay) };
    const b = { x: Math.round(bottom.x + 1 + nx * off), y: Math.round(bottom.y + 1 + ny * off) };
    const full = interpolateStroke([head, a, b]);
    return { full, stroke: sweepBrush(full, 2, size), b };
  };
  /** A piste is "clean" when it avoids water/streams/buildings and (strict) never climbs. */
  const pisteClean = (g: { full: Pt[]; stroke: Pt[] }, strict: boolean): boolean => {
    for (const t of g.stroke) {
      const i = grid.tileIndex(t.x, t.y);
      if (grid.tileType[i] === TileType.Water || grid.tileType[i] === TileType.Stream) return false;
      if (grid.occupancy.flags[grid.occupancy.index(t.x, t.y)]! & (OccFlag.Water | OccFlag.Building | OccFlag.Lift)) return false;
    }
    let up = 0;
    for (let k = 3; k < g.full.length; k++) if (sim.cond.altitude(g.full[k]!.x, g.full[k]!.y) > sim.cond.altitude(g.full[k - 1]!.x, g.full[k - 1]!.y) + 1e-6) up++;
    return strict ? up === 0 : up <= 3;
  };
  for (let n = 0; n < nLifts; n++) {
    const wanted = opt.liftKinds ? opt.liftKinds[n % opt.liftKinds.length]! : baseKind;
    const kindTry: LiftKind[] = wanted === 'chair4' ? ['chair4'] : [wanted, 'chair4'];
    let kind: LiftKind = wanted;
    type Cand = { b: StationSite; t: StationSite; gain: number; side: 1 | -1 };
    let best: Cand | null = null;
    for (const kt of kindTry) {
    kind = kt;
    search: for (const strict of [true, false]) for (const frac of [0.2, 0.14, 0.1, 0.07]) for (const rad of radii) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const bx = Math.round(lc.x + Math.cos(ang) * rad) - 1, by = Math.round(lc.y + Math.sin(ang) * rad) - 1;
        if (bx < 3 || by < 3 || bx > size - 6 || by > size - 6) continue;
        if (bottoms.some((p) => Math.hypot(p.x - bx, p.y - by) < 7)) continue;
        // uphill direction from a coarse height sample around the station
        let gx = 0, gy = 0;
        for (let k = 1; k <= 8; k++) {
          const sa = (k / 8) * Math.PI * 2, sx = Math.round(bx + Math.cos(sa) * 12), sy = Math.round(by + Math.sin(sa) * 12);
          if (sx < 0 || sy < 0 || sx > size || sy > size) continue;
          const h = grid.getCorner(sx, sy) - grid.getCorner(bx, by);
          gx += Math.cos(sa) * h; gy += Math.sin(sa) * h;
        }
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-6) continue;
        const len = Math.max(10, Math.round(size * frac));
        const t0 = { x: Math.round(bx + (gx / gl) * len), y: Math.round(by + (gy / gl) * len) };
        const clamp = (v: number): number => Math.max(3, Math.min(size - 6, v));
        const top = { x: clamp(t0.x), y: clamp(t0.y) };
        const snap = snapLift(planEnv, kind, { x: bx, y: by }, top, { adjust: 'top', radius: 3, autoFlatten: true });
        if (!snap) continue;
        const gain = grid.getCorner(snap.top.x, snap.top.y) - grid.getCorner(snap.bottom.x, snap.bottom.y);
        if (gain < 4) continue;
        const side = ([1, -1] as const).find((sd) => pisteClean(pisteGeom(snap.top, snap.bottom, sd), strict));
        if (!side) continue;
        if (!best || gain > best.gain) best = { b: snap.bottom, t: snap.top, gain, side };
      }
      if (best) break search;
    }
    if (best) break;
    }
    if (!best) { fail(`no lift line ${n}`); continue; }
    const bRect: Rect = { x: best.b.x, y: best.b.y, w: 2, h: 2 };
    // place first (paths built onto the site beforehand would veto the station flattening), connect afterwards
    const out = placeLift(planEnv, props, kind, best.b, best.t, true);
    if (!out.ok || !out.lift) { fail(`placeLift ${n}: ${out.reasons.join('; ')}`); continue; }
    if (out.touchedChunks.length) sim.nature.cover.rebuild(); // lane clearing removed trees: keep forest cover (avalanche protection, scenery) in step with the props
    ensurePath(bRect);
    sim.bus.emit('lift:built', { id: out.lift.id, kind: out.lift.kind });
    report.lifts.push(out.lift);
    bottoms.push(best.b);
    pisteLines.push({ top: { x: best.t.x, y: best.t.y }, bottom: { x: best.b.x, y: best.b.y }, side: best.side });
  }
  settle();
  const pisteStroke: Pt[][] = [];
  for (const { top, bottom, side } of pisteLines) {
    const { full, stroke, b } = pisteGeom(top, bottom, side);
    const res = networks.paint(Layer.Ski, stroke, opt.pisteDifficulties?.[pisteStroke.length]);
    report.pisteTiles += res.painted;
    pisteStroke.push(full);
    // join the piste foot to the village footpaths and the top station to the piste head
    ensurePath({ x: b.x, y: b.y, w: 1, h: 1 });
  }
  settle();

  const kit: ResortKit = { sim, report, lodge, lc, roadTile, pisteStroke, place, placeConnected, ensurePath, ensureRoad, settle, fail };
  opt.pre?.(kit);
  if (!opt.skipCore) {
  // ---- services (after the pistes, so nothing is built across a run) ----
  placeConnected('parking', roadTile.x, roadTile.y, 14);
  placeConnected('ticketOffice', lc.x, lc.y, 12);
  placeConnected('chalet', roadTile.x, roadTile.y, 18); // overnight guests (Sleeping state)
  const mid = pisteStroke[0]?.[Math.floor(pisteStroke[0].length / 2)] ?? lc;
  placeConnected('lodge', lc.x - 6, lc.y + 6, 14); // restaurant
  /** Try several points along the first piste (terrain/streams can veto one spot). */
  const alongPiste = (type: string, rmax: number): PlacedBuilding | null => {
    const st = pisteStroke[0];
    if (!st) return null;
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const t = st[Math.floor(st.length * f)]!;
      const b = place(type, t.x, t.y, rmax);
      if (b) { const acc = BUILDINGS[type]!.access; if (acc === 'path' || acc === 'pisteEdge') ensurePath(b); settle(); return b; }
    }
    fail(`cannot place ${type}`);
    return null;
  };
  alongPiste('mountainHut', 6);
  const hq = placeConnected('skiSchoolHQ', lc.x + 6, lc.y, 12);
  if (hq) {
    // gentle slope near the piste foot (the village itself can be dead flat on big maps), else beside the school
    const foot = pisteStroke[0]?.[Math.floor((pisteStroke[0]?.length ?? 0) * 0.85)] ?? { x: hq.x, y: hq.y };
    const cp = place('magicCarpet', foot.x, foot.y, 12, false, 0, true) ?? place('magicCarpet', hq.x + 2, hq.y + 2, 16, false, 0, true);
    if (cp) { ensurePath(cp); settle(); } else fail('cannot place magicCarpet');
  }
  placeConnected('patrolHub', roadTile.x, roadTile.y, 16);
  alongPiste('firstAid', 7);
  placeConnected('groomerGarage', roadTile.x, roadTile.y, 18);
  alongPiste('snowcatOutpost', 10);

  // ---- snowmaking: reservoir + cannons along the first piste ----
  const line = pisteStroke[0] ?? [];
  const resv = place('reservoir', mid.x, mid.y, 18);
  if (!resv) fail('cannot place reservoir');
  if (resv) {
    let made = 0;
    for (let k = 1; k <= nCannons * 3 && made < nCannons; k++) {
      const ln = pisteStroke[k % Math.max(1, pisteStroke.length)] ?? line;
      const t = ln[Math.min(ln.length - 1, Math.floor((ln.length * (Math.floor(k / Math.max(1, pisteStroke.length)) % (nCannons + 1) + 1)) / (nCannons + 2)))];
      if (t && place('snowCannon', t.x, t.y, 2)) made++;
    }
    if (made < nCannons) fail(`only ${made}/${nCannons} cannons`);
  }

  // ---- attractions ----
  const kinds = ['iceRink', 'heatedTerrace', 'cafe', 'shop', 'kidsGround'];
  for (let i = 0; i < nAttr + 1; i++) placeConnected(kinds[i % kinds.length]!, lc.x + ((i % 2) * 2 - 1) * (8 + i * 2), lc.y - 4 - i * 2, 16);
  if (opt.toilet ?? sim.guestSim.comfortNeed) placeConnected('toilets', lc.x - 3, lc.y + 4, 10, undefined); // the one free toilet (owner decision R2-6): a facilities cushion, docs/comfort.md
  settle();
  }
  opt.extra?.(kit);
  settle();
  sim.openStatus.evaluate();
  return report;
}
