import { Layer } from '../../world/Networks';
import type { GuestStore } from './Guest';
import type { NavGraph } from './NavGraph';
import { NEEDS } from './Needs';

/**
 * Excursion model (docs/hiking.md). A hiker/biker commits to a ROUTE (tile polyline from the planning tile to the goal, then back or one-way down)
 * whose progress is simulated in compressed game time: a planned duration D (hours, 1.5-4.5 for hikers, independent of the map scale) and a fraction
 * that advances 1/D per game hour, plus a stop at the goal. Position = interpolation along the polyline (O(1) per tick, no pathfinding).
 * Guards (every CHECK_EVERY ticks): trail closure ahead, bear threat, dusk; all turn the guest back along the same route.
 */
export const EXC = {
  /** Minimum remaining route (tiles) for the compressed model; shorter walks use NavMovement. */
  minTiles: 12,
  /** Active duration bounds (hours) for a hiker; D = clamp(base + tilesPer64 * perTile). */
  minH: 1.5, maxH: 4.5, baseH: 0.5, perTileH: 0.035,
  /** Bikers are faster. */
  bikeFactor: 0.65, bikeMinH: 1.0,
  /** Stop at the goal (hours): viewpoint 0.25, + lunch at a hut. */
  stopH: 0.25, lunchH: 0.4,
  /** Hours per tick (6 game minutes). */
  hourPerTick: 0.1,
  /** Safety margin before day guests head home (hours). */
  duskMargin: 0.25,
  checkEvery: 4, lookahead: 5, bearAvoid: 0.35,
  /** Hunger care (docs/hiking.md 'Hunger audit'): food stops count within `foodRadius` tiles of ANY route tile (not only the goal); the planner shortens a route (or refuses it) whose
   *  predicted hunger at the goal exceeds `maxGoalHunger` when there is no food stop and no packed lunch; `packShare` % of guests bring a lunch from home (free, eaten once when hunger passes `snackAt`, hunger drops to `snackTo`). */
  foodRadius: 8, maxGoalHunger: 0.7, packShare: 40, snackAt: 0.45, snackTo: 0.15,
} as const;

export interface Exc {
  key: string; route: Int32Array; kind: 0 | 1; oneWay: boolean;
  /** Active hours (out + back), stop hours, elapsed hours, out-leg hours. */
  D: number; S: number; e: number; tOut: number;
  goal: number; start: number; lunch: boolean; stopped: boolean; turned: boolean;
  /** Food stop: route fraction (0..1 of the whole route) where the lunch is eaten, -1 = none; `ate` once eaten; `packed` = still carrying a packed lunch. */
  fa: number; ate: boolean; packed: boolean;
  /** Trek leg (overnight hut): ends on arrival at the goal; `ok` is reported to the host. */
  trek: boolean;
}

export interface ExcHost {
  graph(): NavGraph | null;
  groundAt(x: number, y: number): number;
  moveSlot(slot: number, x: number, y: number, z: number): void;
  hour(): number;
  leaveHour(): number;
  avoid(tile: number): number;
  /** Guest reached the goal (trail fee, visits). */
  reachedGoal(slot: number, kind: 0 | 1): void;
  /** A food building (hut / cafe / lodge / farm shop) within `EXC.foodRadius` tiles of this tile? (hut lunch). */
  foodNear(x: number, y: number): boolean;
  lunch(slot: number): void;
  /** Viewpoint building next to this goal tile: extra stop in hours (0 / absent = none). Phase 6 Task 6. */
  viewDwellH?(goal: number): number;
  /** Guest reached the goal tile of a viewpoint (happiness, photo, visit counter). */
  viewed?(slot: number, goal: number): void;
  /** Excursion over: guest is idle at its final position. */
  finished(slot: number, ok: boolean, trek: boolean): void;
}

/** Planned active duration in hours for a route of `tiles` tiles walked in total (out + back), on a map of `mapSize`. Scale independent. */
export function plannedHours(totalTiles: number, mapSize: number, kind: 0 | 1, fitness: number): number {
  const norm = totalTiles / (mapSize / 64);
  const h = Math.min(EXC.maxH, Math.max(EXC.minH, EXC.baseH + norm * EXC.perTileH)) / fitness;
  return kind === 1 ? Math.max(EXC.bikeMinH, h * EXC.bikeFactor) : Math.min(EXC.maxH, Math.max(EXC.minH, h));
}

export class Excursions {
  readonly map = new Map<number, Exc>();
  /** Route table shared between guests: key -> tiles. */
  readonly routes = new Map<string, Int32Array>();
  /** Slot -> final goal tile waiting behind a lift-first leg. */
  readonly pending = new Map<number, number>();
  /** Guest ids that already ate their packed lunch (once per visit). */
  readonly packedUsed = new Set<number>();
  snacks = 0; plannerShort = 0; plannerRefused = 0;
  /** Diagnostics: why excursions were cut short. */
  why: Record<string, number> = {};
  started = 0; finishedCount = 0; aborted = 0; turnedBack = 0; liftFirst = 0;
  enabled = true;
  private tickNo = 0;

  constructor(private s: GuestStore, private h: ExcHost) {}

  get active(): number { return this.map.size; }
  has(slot: number): boolean { return this.map.has(slot); }
  clear(): void { this.map.clear(); this.routes.clear(); this.pending.clear(); this.packedUsed.clear(); }
  /** Does this guest carry a packed lunch (a stable share of guests, until eaten)? */
  packedFor(slot: number): boolean { const id = this.s.id[slot]!; return (Math.imul(id + 91, 2654435761) >>> 0) % 100 < EXC.packShare && !this.packedUsed.has(id); }
  /** First route fraction (0..1) with a food stop in reach (sampled every 3 tiles + the goal), or -1. */
  foodAlong(route: Int32Array, n: number): number {
    const L = route.length;
    for (let k = 0; k < L; k += 3) { const t = route[k]!; if (this.h.foodNear(t % n, Math.floor(t / n))) return k / (L - 1); }
    const g = route[L - 1]!; return this.h.foodNear(g % n, Math.floor(g / n)) ? 1 : -1;
  }
  drop(slot: number): void { this.map.delete(slot); this.pending.delete(slot); }

  /** Shared route cache keyed by (start, goal, mode, network version). Returns the cached array for identical plans. */
  shareRoute(start: number, goal: number, mode: number, version: number, tiles: Int32Array): { key: string; route: Int32Array } {
    const key = `${start}:${goal}:${mode}:${version}`;
    const hit = this.routes.get(key);
    if (hit && hit.length === tiles.length) return { key, route: hit };
    if (this.routes.size > 400) this.routes.clear();
    this.routes.set(key, tiles);
    return { key, route: tiles };
  }

  /**
   * Plan an excursion for `slot` along `tiles` (planning tile .. goal). Returns false when it should not be committed (too short, no daylight).
   * Fits the remaining daylight by shortening the route; one-way descents do not return.
   */
  begin(slot: number, tiles: Int32Array, kind: 0 | 1, version: number, mapSize: number, oneWay: boolean, trek = false, fixed = false): boolean {
    const hour = this.h.hour(), s = this.s;
    if (!this.enabled || tiles.length < EXC.minTiles) return false;
    let route = tiles;
    const fit = 0.85 + 0.1 * Math.min(3, s.skill[slot]!) + 0.15 * (((Math.imul(s.id[slot]!, 2654435761) >>> 0) % 100) / 100) - 0.2 * s.fatigue[slot]!;
    let lunch = false, fa = -1;
    const rate = NEEDS.hungerHike / EXC.hourPerTick, hunger0 = s.hunger[slot]!, packed = this.packedFor(slot);
    const outH = (d: number): number => (oneWay ? d : d / 2);
    let D = plannedHours(route.length * (oneWay ? 1 : 2), mapSize, kind, fit);
    const stopFor = (r: Int32Array): number => { fa = this.foodAlong(r, mapSize); lunch = fa >= 0 && hunger0 + rate * fa * outH(D) > 0.3; if (!lunch) fa = -1; return EXC.stopH + (lunch ? EXC.lunchH : 0) + (this.h.viewDwellH?.(r[r.length - 1]!) ?? 0); };
    let S = stopFor(route);
    // food check: no food stop on the way and no packed lunch -> keep the predicted hunger at the goal below maxGoalHunger (shorten, or refuse so the guest eats first)
    if (!trek && !lunch && !packed && hunger0 + rate * outH(D) > EXC.maxGoalHunger) {
      const keep = Math.floor(route.length * ((EXC.maxGoalHunger - hunger0) / rate / outH(D)));
      if (keep < EXC.minTiles) { this.plannerRefused++; return false; }
      route = route.slice(0, keep); D = plannedHours(route.length * (oneWay ? 1 : 2), mapSize, kind, fit); S = stopFor(route); this.plannerShort++;
    }
    const allowed = this.h.leaveHour() - EXC.duskMargin - hour - S;
    if (fixed) { /* trek legs are never truncated */ if (trek && D > allowed) return false; } else if (D > allowed) {
      if (allowed < EXC.minH * 0.8) return false;
      const frac = allowed / D;
      const keep = Math.max(EXC.minTiles, Math.floor(route.length * frac));
      if (keep < route.length) { route = route.slice(0, keep); S = stopFor(route); }
      D = Math.min(D, allowed);
    }
    const sh = this.shareRoute(route[0]!, route[route.length - 1]!, kind, version, route);
    const e: Exc = {
      key: sh.key, route: sh.route, kind, oneWay, D, S, e: 0, tOut: oneWay ? D : D / 2, goal: route[route.length - 1]!, start: route[0]!, lunch, stopped: false, turned: false, trek, fa, ate: false, packed,
    };
    this.map.set(slot, e);
    this.pending.delete(slot);
    s.act[slot] = 7; // Act.Excursion
    this.started++;
    return true;
  }

  /** Position of an excursion at elapsed hours `t`: [fraction along route 0..1, phase 0 out / 1 stop / 2 back]. */
  static locate(x: Exc, t: number): [number, number] {
    if (t < x.tOut) return [t / x.tOut, 0];
    if (t < x.tOut + x.S) return [1, 1];
    const back = x.D - x.tOut;
    return [back <= 0 ? 1 : Math.max(0, 1 - (t - x.tOut - x.S) / back), 2];
  }
  static total(x: Exc): number { return x.D + x.S; }
  progress(slot: number): { pct: number; etaHours: number; goal: number; kind: 0 | 1; phase: number } | null {
    const x = this.map.get(slot);
    if (!x) return null;
    const T = Excursions.total(x);
    return { pct: Math.min(1, x.e / T), etaHours: Math.max(0, T - x.e), goal: x.goal, kind: x.kind, phase: Excursions.locate(x, x.e)[1] };
  }

  /** Turn back at the current point (mirror along the same route); one-way routes and return legs simply end. Returns false when it ended instead. */
  turnBack(slot: number): boolean {
    const x = this.map.get(slot);
    if (!x) return false;
    const [, ph] = Excursions.locate(x, x.e);
    if (ph === 0 && !x.oneWay && !x.turned) {
      x.e = x.tOut + x.S + (x.tOut - x.e); x.turned = true; x.stopped = true; this.turnedBack++;
      return true;
    }
    this.end(slot);
    this.aborted++;
    return false;
  }

  end(slot: number, ok = false): void {
    const x = this.map.get(slot);
    if (!x || !this.map.delete(slot)) return;
    this.pending.delete(slot);
    this.finishedCount++;
    this.h.finished(slot, ok, x.trek);
  }

  private place(slot: number, x: Exc, f: number): void {
    const s = this.s, r = x.route, n = this.h.graph()?.size ?? 1;
    const pos = f * (r.length - 1), i0 = Math.min(r.length - 1, Math.floor(pos)), i1 = Math.min(r.length - 1, i0 + 1), k = pos - i0;
    const a = r[i0]!, b = r[i1]!;
    const ax = (a % n) + 0.5, ay = Math.floor(a / n) + 0.5, bx = (b % n) + 0.5, by = Math.floor(b / n) + 0.5;
    const px = ax + (bx - ax) * k, py = ay + (by - ay) * k;
    s.px[slot] = s.x[slot]!; s.py[slot] = s.y[slot]!; s.pz[slot] = s.z[slot]!;
    this.h.moveSlot(slot, px, py, this.h.groundAt(px, py));
  }

  /** Advance one excursionist by one tick (O(1) except every checkEvery ticks: O(lookahead)). */
  step(slot: number): void {
    const x = this.map.get(slot);
    if (!x) return;
    this.tickNo++;
    const s = this.s;
    x.e += EXC.hourPerTick;
    const [f, ph] = Excursions.locate(x, x.e);
    if (x.lunch && !x.ate && (ph >= 1 || f >= x.fa)) { x.ate = true; this.h.lunch(slot); }
    if (x.packed && !x.ate && s.hunger[slot]! > EXC.snackAt) { x.packed = false; s.hunger[slot] = Math.min(s.hunger[slot]!, EXC.snackTo); this.packedUsed.add(s.id[slot]!); this.snacks++; }
    if (ph === 1 && !x.stopped) { x.stopped = true; this.h.reachedGoal(slot, x.kind); this.h.viewed?.(slot, x.goal); if (x.trek) { this.place(slot, x, 1); this.end(slot, true); return; } }
    this.place(slot, x, f);
    if (x.e >= Excursions.total(x)) { this.end(slot, !x.turned && x.stopped); return; }
    if ((this.tickNo + slot) % EXC.checkEvery !== 0 || ph === 1) return;
    const g = this.h.graph();
    if (!g) return;
    // dusk: still heading out when the day guests leave -> turn back
    if (ph === 0 && !x.turned && this.h.hour() >= this.h.leaveHour() - EXC.duskMargin - (x.tOut - x.e) - 0.1 && !x.oneWay) { this.why.dusk = (this.why.dusk ?? 0) + 1; this.turnBack(slot); return; }
    // bear / closure look-ahead along the direction of travel
    const r = x.route, pos = f * (r.length - 1), dir = ph === 0 ? 1 : -1;
    const w = g.world, base = Math.floor(pos);
    for (let k = 0; k <= EXC.lookahead; k++) {
      const idx = base + dir * k;
      if (idx < 0 || idx >= r.length) break;
      const t = r[idx]!;
      const onTrail = (w.layers[t]! & (Layer.Hike | Layer.Mtb)) !== 0, bad = (onTrail ? w.hikeOk[t] === 0 : w.kind[t] === 0 && w.layers[t] === 0 && !g.isStation(t)) || (k === 0 && this.h.avoid(t) > EXC.bearAvoid);
      if (bad) { const why = k === 0 && this.h.avoid(t) > EXC.bearAvoid ? 'bear' : onTrail ? 'closed' : 'noTrail'; this.why[why] = (this.why[why] ?? 0) + 1; if (ph === 0) this.turnBack(slot); else { this.end(slot); this.aborted++; } return; }
    }
    void s;
  }

  serialize(): { routes: Array<[string, number[]]>; list: Array<Record<string, number | string | boolean>>; pending: Array<[number, number]>; used?: number[] } {
    const s = this.s, used = new Set<string>(), list: Array<Record<string, number | string | boolean>> = [];
    for (const [slot, x] of [...this.map].sort((a, b) => a[0] - b[0])) {
      used.add(x.key);
      list.push({ id: s.id[slot]!, key: x.key, kind: x.kind, ow: x.oneWay, D: x.D, S: x.S, e: x.e, tOut: x.tOut, goal: x.goal, start: x.start, lunch: x.lunch, st: x.stopped, tn: x.turned, trek: x.trek, fa: x.fa, ate: x.ate, pk: x.packed });
    }
    return { routes: [...used].sort().map((k) => [k, Array.from(this.routes.get(k)!)] as [string, number[]]), list, pending: [...this.pending].map(([slot, t]) => [s.id[slot]!, t] as [number, number]), used: [...this.packedUsed].filter((id) => s.slotOf(id) >= 0).sort((a, b) => a - b) };
  }

  load(d: ReturnType<Excursions['serialize']> | undefined): void {
    this.clear();
    if (!d) return;
    const s = this.s;
    for (const [k, a] of d.routes) this.routes.set(k, Int32Array.from(a));
    for (const o of d.list) {
      const slot = s.slotOf(o.id as number), route = this.routes.get(o.key as string);
      if (slot < 0 || !route) continue;
      this.map.set(slot, { key: o.key as string, route, kind: o.kind as 0 | 1, oneWay: !!o.ow, D: o.D as number, S: o.S as number, e: o.e as number, tOut: o.tOut as number, goal: o.goal as number, start: o.start as number, lunch: !!o.lunch, stopped: !!o.st, turned: !!o.tn, trek: !!o.trek, fa: (o.fa as number | undefined) ?? (o.lunch ? 1 : -1), ate: (o.ate as boolean | undefined) ?? (!!o.lunch && !!o.st), packed: !!o.pk });
    }
    for (const id of d.used ?? []) this.packedUsed.add(id);
    for (const [id, t] of d.pending ?? []) { const slot = s.slotOf(id); if (slot >= 0) this.pending.set(slot, t); }
  }
}
