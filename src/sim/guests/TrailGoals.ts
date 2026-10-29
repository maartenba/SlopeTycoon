import { Layer } from '../../world/Networks';
import type { LiftInfo } from './Decision';
import { coreOf, GuestType } from './Guest';
import { NavMode, type NavGraph } from './NavGraph';
import { EXC, plannedHours } from './Excursion';
import { VIEWPOINT } from '../../config/viewpoints';
import { Viewpoints, type ViewpointSite } from '../attractions/Viewpoint';

/**
 * Appeal-based trail goal selection (docs/hiking.md). Replaces "uniform random trail tile": a POI list is built per nav epoch (highest tile per
 * 8x8 cell = viewpoints, the overall summits, trail tiles next to a hut/restaurant, lift tops) and scored per guest: altitude appeal, hut/summit bonus,
 * fitness (skill), daylight fit (ETA vs the hour the day guests leave), safety (bear field, warning signs, storms) and an explicit pull to the top third.
 * Bikers pick descents (lift up, MTB down). Pure and deterministic (uses the sim rng only).
 */
export const TRAIL_GOALS = {
  /** Bonus for a top-third POI (rel >= topRel): hikers/adventure types / everybody else. */
  pullHiker: 1.3, pullOther: 0.5, topRel: 0.67,
  /** Share of guests that take a suitable foot lift up first. */
  liftFirstChance: 0.9, minLiftGain: 0.08,
  cell: 8, maxPois: 90,
  hutBonus: 0.3, summitBonus: 0.35, noise: 0.5,
  /** Tiles per straight-line tile of a trail route. */
  detour: 1.4,
} as const;

/** kind: 0 high ground (8x8 cell maximum), 1 summit, 2 hut, 3 lift top, 4 viewpoint building (`view` = view score x weight, `viewId` = building id). */
export interface Poi { tile: number; rel: number; kind: 0 | 1 | 2 | 3 | 4; view?: number; viewId?: number }
export interface GoalPick { tile: number; via: number; rel: number; score: number; oneWay: boolean }
export interface GoalCtx {
  hour: number; leaveHour: number; pref: number; type: number; skill: number; fatigue: number; x: number; y: number; storm: boolean;
  avoid(tile: number): number; penalty(tile: number): number; lifts: readonly LiftInfo[]; wait(liftId: number): number; mode: 'hike' | 'bike';
}

export class TrailGoals {
  pois: Poi[] = [];
  mtb: number[] = [];
  /** Tiles whose goal turned out unreachable (cleared every epoch). */
  private bad = new Set<number>();
  /** Mountain Hut building id -> nearest trail tile (trek goals). */
  readonly hutTiles = new Map<number, number>();
  /** Viewpoint buildings (scores cached per nav epoch) and their goal trail tiles (trail tile -> building id). */
  readonly viewpoints = new Viewpoints();
  readonly viewTiles = new Map<number, number>();
  private epoch = -1;
  private amin = 0; private amax = 1; private size = 0;
  picks = 0; top = 0; withLift = 0;
  /** Uncached reachability queries left (reset by the Decider's refresh). */
  queryBudget = 24;

  constructor(private nav: () => NavGraph | null) {}

  reset(): void { this.epoch = -1; this.pois = []; this.mtb = []; this.bad.clear(); this.viewTiles.clear(); this.viewpoints.reset(); }
  markBad(tile: number): void { this.bad.add(tile); }

  rel(g: NavGraph, t: number): number { return Math.max(0, Math.min(1, (g.tileAltitude(t) - this.amin) / (this.amax - this.amin || 1))); }

  /** Rebuild the POI list from the snow-free trail tiles (called when the nav epoch changes). */
  build(g: NavGraph, hike: number[], mtb: number[], huts: Array<{ id?: number; x: number; y: number }>, views: readonly ViewpointSite[] = []): void {
    this.hutTiles.clear(); this.viewTiles.clear();
    if (this.size !== g.size) {
      this.size = g.size; this.amin = Infinity; this.amax = -Infinity;
      for (let t = 0; t < g.size * g.size; t++) { const a = g.tileAltitude(t); if (a < this.amin) this.amin = a; if (a > this.amax) this.amax = a; }
    }
    this.epoch = g.epoch; this.bad.clear();
    const n = g.size, C = TRAIL_GOALS.cell, cells = new Map<number, number>();
    for (const t of hike) {
      const k = Math.floor(((t / n) | 0) / C) * 1000 + Math.floor((t % n) / C), cur = cells.get(k);
      if (cur === undefined || g.tileAltitude(t) > g.tileAltitude(cur)) cells.set(k, t);
    }
    const list: Poi[] = [...cells.values()].map((tile) => ({ tile, rel: this.rel(g, tile), kind: 0 as const }));
    list.sort((a, b) => b.rel - a.rel || a.tile - b.tile);
    for (let i = 0; i < Math.min(3, list.length); i++) list[i]!.kind = 1;
    for (const h of huts) {
      let best = -1, bd = 36;
      for (const t of hike) { const d = (t % n - h.x) ** 2 + ((t / n | 0) - h.y) ** 2; if (d < bd) { bd = d; best = t; } }
      if (best >= 0) { list.push({ tile: best, rel: this.rel(g, best), kind: 2 }); if (h.id !== undefined) this.hutTiles.set(h.id, best); }
    }
    for (const l of g.world.lifts()) {
      const top = g.stationAnchor(l, 1);
      for (const t of hike) if ((t % n - l.top.x) ** 2 + ((t / n | 0) - l.top.y) ** 2 <= 16) { list.push({ tile: t, rel: this.rel(g, t), kind: 3 }); break; }
      if (l.stations && l.stations.length > 2) for (const st of l.stations.slice(1, -1)) { // a mid-station is a trail head too
        for (const t of hike) if ((t % n - st.x) ** 2 + ((t / n | 0) - st.y) ** 2 <= 16) { list.push({ tile: t, rel: this.rel(g, t), kind: 3 }); break; }
      }
      void top;
    }
    // viewpoint buildings: score cached per nav epoch; the goal is the nearest snow-free trail tile (like huts); kept through trimming
    const vps: Poi[] = [];
    if (views.length) {
      const alt = (x: number, y: number): number => g.tileAltitude(y * n + x);
      for (const v of this.viewpoints.refresh(g.epoch, views, n, alt, this.amin, this.amax)) {
        let best = -1, bd = VIEWPOINT.trailReach * VIEWPOINT.trailReach + 1;
        for (const t of hike) { const d = (t % n - v.x) ** 2 + ((t / n | 0) - v.y) ** 2; if (d < bd) { bd = d; best = t; } }
        if (best < 0) continue;
        vps.push({ tile: best, rel: this.rel(g, best), kind: 4, view: v.score * (v.spec.weight ?? 1), viewId: v.id });
        this.viewTiles.set(best, v.id);
      }
      vps.sort((a, b) => (b.view ?? 0) - (a.view ?? 0) || a.tile - b.tile);
      vps.length = Math.min(vps.length, VIEWPOINT.maxKept);
    } else this.viewpoints.reset();
    // keep the highest ones plus an even sample of the rest (viewpoints always survive the cap)
    const cap = TRAIL_GOALS.maxPois - vps.length;
    if (list.length > cap) {
      const keep = list.slice(0, 40), rest = list.slice(40), step = rest.length / (cap - 40);
      for (let i = 0; i < cap - 40; i++) keep.push(rest[Math.floor(i * step)]!);
      this.pois = keep;
    } else this.pois = list;
    this.pois.push(...vps);
    this.mtb = mtb.length > 96 ? Array.from({ length: 96 }, (_, i) => mtb[Math.floor((i * mtb.length) / 96)]!) : mtb;
  }

  get epochNo(): number { return this.epoch; }

  private bestLift(c: GoalCtx, bike: boolean): LiftInfo | undefined {
    let best: LiftInfo | undefined, bd = Infinity;
    for (const l of c.lifts) {
      const am = l.lift.activeMode;
      if (am !== 'foot' && am !== 'mixed') continue;
      if (bike && !l.bikeDescent) continue;
      const d = Math.hypot(l.bottomX - c.x, l.bottomY - c.y) + 0.5 * c.wait(l.lift.id);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  pick(c: GoalCtx, rng: { next(): number; chance(p: number): boolean }): GoalPick | null {
    const g = this.nav();
    if (!g || this.epoch !== g.epoch) return null;
    const n = g.size, bike = c.mode === 'bike', T = TRAIL_GOALS;
    const here = this.rel(g, Math.floor(c.y) * n + Math.floor(c.x));
    const lift = c.hour + 1 < c.leaveHour ? this.bestLift(c, bike) : undefined;
    const liftTop = lift ? g.stationAnchor(lift.lift, 1) : -1;
    const topRel = lift ? this.rel(g, liftTop) : 0;
    const wantLift = !!lift && topRel - here >= T.minLiftGain && c.wait(lift.lift.id) < 80 && rng.chance(T.liftFirstChance);
    const sx = wantLift ? lift!.lift.top.x : c.x, sy = wantLift ? lift!.lift.top.y : c.y, sRel = wantLift ? topRel : here;
    const hiker = c.pref === 1 || coreOf(c.type) === GuestType.Adventure;
    const fit = 0.85 + 0.1 * c.skill - 0.2 * c.fatigue;
    const scored: GoalPick[] = [];
    // N-station lift: the hiker / biker alights at the station nearest to the goal (mid-stations are trail heads too); 2-station lifts: the top, exactly as before
    const stn = wantLift && lift!.lift.stations && lift!.lift.stations.length > 2 ? lift!.lift.stations.slice(1).filter((st) => st.alight !== false) : null;
    const stnTile = stn ? stn.map((st) => st.y * n + st.x) : [];
    const cands: Poi[] = bike ? this.mtb.map((tile) => ({ tile, rel: this.rel(g, tile), kind: 0 as const })) : this.pois;
    for (const p of cands) {
      if (this.bad.has(p.tile)) continue;
      const px = p.tile % n, py = (p.tile / n) | 0;
      let ax = sx, ay = sy, aRel = sRel, aVia = liftTop;
      if (stn) {
        let bk = stn.length - 1, bd = Infinity;
        for (let k = 0; k < stn.length; k++) { const dd = Math.hypot(px - stn[k]!.x, py - stn[k]!.y); if (dd < bd - 1e-9) { bd = dd; bk = k; } }
        ax = stn[bk]!.x; ay = stn[bk]!.y; aVia = stnTile[bk]!; aRel = this.rel(g, aVia);
      }
      const d = Math.hypot(px - ax, py - ay);
      if (d < 6) continue;
      const oneWay = bike && p.rel < aRel - 0.03;
      if (bike && wantLift && !oneWay) continue; // lift-first bikers only descend
      const total = d * T.detour * (oneWay ? 1 : 2);
      const D = plannedHours(total, n, bike ? 1 : 0, fit);
      const allowed = c.leaveHour - EXC.duskMargin - c.hour - EXC.stopH - (wantLift ? 0.4 : 0);
      if (allowed < EXC.minH * 0.8) continue;
      let sc = bike ? 0.4 + 1.2 * (aRel - p.rel) : 0.3 + 0.9 * Math.pow(p.rel, 1.2) + (p.kind === 2 ? T.hutBonus : 0) + (p.kind === 1 ? T.summitBonus : 0) + (p.kind === 3 ? 0.1 : 0) + (p.view ? VIEWPOINT.poiBonus * p.view : 0);
      if (!bike && p.rel >= T.topRel) sc += hiker ? T.pullHiker : T.pullOther;
      if (D > allowed) sc -= 0.8 * (D / allowed - 1);
      if (c.skill <= 0 && p.rel > 0.7) sc -= 0.3;
      if (c.storm && p.rel > 0.3) sc -= 0.8;
      sc -= 1.5 * c.avoid(p.tile) + c.penalty(p.tile);
      sc += T.noise * rng.next();
      scored.push({ tile: p.tile, via: wantLift ? aVia : -1, rel: p.rel, score: sc, oneWay });
    }
    scored.sort((a, b) => b.score - a.score || a.tile - b.tile);
    // reachability: the best candidates must have a hike path from where the guest starts (snow gaps cut off high trail sections)
    const mode = bike ? NavMode.Bike : NavMode.Hike;
    let best: GoalPick | null = null;
    for (let k = 0; k < Math.min(5, scored.length) && !best; k++) {
      const cand = scored[k]!;
      const from = wantLift ? cand.via : Math.floor(c.y) * n + Math.floor(c.x);
      let ok = true;
      if (g.standable(mode, from)) {
        let r = g.pf.cached(mode, from, cand.tile);
        if (r === undefined && this.queryBudget > 0) { this.queryBudget--; r = g.pf.find(mode, from, cand.tile); }
        if (r === null) ok = false;
      }
      if (ok) best = cand; else this.bad.add(cand.tile);
    }
    if (best) { this.picks++; if (best.rel >= T.topRel) this.top++; if (wantLift) this.withLift++; }
    return best;
  }
}
void Layer;
