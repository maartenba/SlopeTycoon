import { EXPLORE } from '../../config/balance';
import type { GuestStore } from './Guest';
import { NavMode, type NavGraph } from './NavGraph';
import { Layer } from '../../world/Networks';
import { liftStations, type LiftData } from '../Lift';

/**
 * Skier exploration (docs/ski-exploration.md). Before this module every run was "lift -> cheapest path back to the same lift's bottom": all skiers of a
 * skill followed one single-tile line per lift. Now
 *  - each guest remembers the last EXPLORE.memory lifts it rode (GuestStore.recA/B/C, saved) and `noveltyPenalty` makes Decider prefer a lift/line it
 *    has not ridden lately (stronger for intermediates / experts);
 *  - at the top of a lift the guest picks a *via* tile on the downhill side (candidates = tiles skiable straight down from the lift top AND straight on to its bottom, found by a pure flood fill per lift & difficulty (so the choice is a function of the world, identical after a save/load))
 *    scored by today's tile traffic (crowd avoidance, unridden lines first), personal novelty (far from the previous via), difficulty variety by skill
 *    and noise; the run is top -> via -> bottom (both legs are cached paths);
 *  - per-tile "runs today" counters feed the piste inspector (`runsAt`).
 * Pure sim; deterministic (selection uses the sim rng); candidate lists are rebuilt after every nav epoch change (reset on load).
 */
/** What the routing needs to know about the run a tile belongs to (hook set by createSim; absent = tile-level behaviour as before runs existed). */
export interface RunChoice { /** 1 green .. 4 black */ diff: number; /** log1p of the run's mean passes today */ crowd: number; /** surface preference of this skier on the tile, 0..1 (0.5 = neutral) */ like: number; /** false = closed run: never chosen */ open: boolean }

interface LiftCands { epoch: number; pool: number[]; ok: Array<number[] | undefined> }

export class Exploration {
  /** Today's pass counter per tile (hook, set by createSim: PisteQuality traffic + trafficDay). */
  usage: (tile: number) => number = () => 0;
  /** Run-aware scoring (phase 3 of docs/runs.md): at a lift top the guest picks among the RUNS it can reach by difficulty fit, run crowding, surface and mood. */
  runChoice: ((tile: number, skill: number) => RunChoice | null) | null = null;
  /** Off = the pre-exploration behaviour (A/B in analysis & tests). */
  enabled = true;
  /** Runs through a via tile today, per tile (reset daily; display only - never read by the simulation, so it needs no saving). */
  readonly runsToday: Uint16Array;
  private cands = new Map<number, LiftCands>();
  private day = -1;
  /** Diagnostics. */
  picks = 0; withVia = 0;

  constructor(private nav: () => NavGraph | null, mapSize: number) { this.runsToday = new Uint16Array(mapSize * mapSize); }

  reset(): void { this.cands.clear(); }
  beginTick(day: number): void {
    if (day !== this.day) { this.day = day; this.runsToday.fill(0); }
  }

  /** Penalty (>= 0) for riding `liftId` again: grows with how often it is in the guest's memory; skill 0 barely cares. */
  noveltyPenalty(s: GuestStore, slot: number, liftId: number): number {
    if (!this.enabled) return 0;
    const key = liftId + 1;
    const n = (s.recA[slot] === key ? 1.5 : 0) + (s.recB[slot] === key ? 1 : 0) + (s.recC[slot] === key ? 0.5 : 0);
    return n * EXPLORE.noveltyWeight * EXPLORE.skillBoost[Math.max(0, Math.min(3, s.skill[slot]!))]!;
  }

  remember(s: GuestStore, slot: number, liftId: number): void {
    s.recC[slot] = s.recB[slot]!; s.recB[slot] = s.recA[slot]!; s.recA[slot] = liftId + 1;
  }

  /** `k` = index of the station the run starts at (default the top; a mid-station of an N-station lift: the stretch from there down to the bottom). */
  private poolFor(g: NavGraph, l: LiftData, k?: number): number[] {
    const w = g.world, n = g.size, top = k === undefined ? l.top : liftStations(l)[k]!, bot = l.bottom;
    const dx = bot.x - top.x, dy = bot.y - top.y, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2);
    const corridor = Math.max(EXPLORE.corridorMin, len * EXPLORE.corridorFrac);
    const topA = g.tileAltitude(top.y * n + top.x), botA = g.tileAltitude(bot.y * n + bot.x);
    const out: number[] = [];
    const x0 = Math.max(0, Math.floor(Math.min(top.x, bot.x) - corridor)), x1 = Math.min(n - 1, Math.ceil(Math.max(top.x, bot.x) + corridor));
    const y0 = Math.max(0, Math.floor(Math.min(top.y, bot.y) - corridor)), y1 = Math.min(n - 1, Math.ceil(Math.max(top.y, bot.y) + corridor));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = y * n + x;
      if ((w.layers[t]! & Layer.Ski) === 0 || w.kind[t] !== 0 || w.skiOpen[t] !== 1) continue;
      const a = g.tileAltitude(t);
      if (a >= topA - 1e-6 || a <= botA + 1e-6) continue;
      const u = ((x - top.x) * dx + (y - top.y) * dy) / len2;
      const px = top.x + u * dx, py = top.y + u * dy;
      if (Math.hypot(x - px, y - py) > corridor) continue;
      out.push(t);
    }
    // deterministic thinning: roughly every `thin`-th tile (lateral and longitudinal spread), capped
    const step = Math.max(1, Math.floor(out.length / EXPLORE.poolMax));
    return out.filter((_, i) => i % step === 0);
  }

  /** Tiles a skier of mode `mode` reaches from `from` by plain downhill steps (forward), or that reach `from` (backward). Pure flood fill over NavGraph.step. */
  private flood(g: NavGraph, mode: number, from: number, forward: boolean, limit: number): Set<number> {
    const n = g.size, seen = new Set<number>([from]), q = [from];
    for (let h = 0; h < q.length && seen.size < limit; h++) {
      const a = q[h]!, ax = a % n, ay = (a / n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = ax + dx, y = ay + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const b = y * n + x;
        if (seen.has(b)) continue;
        if ((forward ? g.step(mode, a, b) : g.step(mode, b, a)) < 0) continue;
        seen.add(b); q.push(b);
      }
    }
    return seen;
  }

  /** Candidate via tiles for (lift, difficulty): in the corridor pool, skiable from the top and on to the bottom. Cached per nav epoch. */
  private valid(g: NavGraph, l: LiftData, d: number, k?: number): number[] {
    const ck = k === undefined || k === liftStations(l).length - 1 ? l.id : l.id + 1_000_000 * (k + 1); // (per start station)
    let c = this.cands.get(ck);
    if (!c || c.epoch !== g.epoch) { c = { epoch: g.epoch, pool: this.poolFor(g, l, k), ok: [undefined, undefined, undefined, undefined] }; this.cands.set(ck, c); }
    let ok = c.ok[d];
    if (!ok) {
      const mode = NavMode.Ski0 + d, top = k === undefined ? g.stationAnchor(l, 1) : g.stationAnchorAt(l, k), bottom = g.stationAnchor(l, 0);
      const down = this.flood(g, mode, top, true, 6000), up = this.flood(g, mode, bottom, false, 6000);
      ok = c.ok[d] = c.pool.filter((t) => down.has(t) && up.has(t));
    }
    return ok;
  }

  /**
   * Pick the via tile for a run starting at the top of `lift` (returns tile + 1, 0 = none: plain cheapest path).
   * Guests at SkiOff skip it (they free-ride).
   */
  pickVia(s: GuestStore, slot: number, lift: LiftData, rng: { next(): number }, fromStation?: number): number {
    const g = this.nav();
    this.picks++;
    if (!this.enabled || !g || s.moveMode[slot] === NavMode.SkiOff) return 0;
    const d = Math.max(0, Math.min(3, s.moveMode[slot]! - NavMode.Ski0));
    const list = this.valid(g, lift, d, fromStation);
    if (list.length === 0) return 0;
    const n = g.size, skill = s.skill[slot]!, lv = s.via[slot]!, last = lv !== 0 ? Math.abs(lv) - 1 : -1;
    let best = -1, bs = -Infinity;
    const mood = Math.max(0, Math.min(1, 1 - s.happiness[slot]! / 100));
    for (const t of list) {
      let diff = g.difficultyAt(t);
      const crowd = Math.log1p(this.usage(t));
      const rc = this.runChoice?.(t, skill) ?? null;
      if (rc && !rc.open) continue; // a closed run is never chosen
      let sc = -EXPLORE.crowdWeight * crowd + EXPLORE.noise * rng.next();
      if (rc) {
        diff = rc.diff; // the run's own difficulty, not the tile's
        sc += -EXPLORE.runCrowdWeight * rc.crowd + EXPLORE.runQualityWeight * (rc.like - 0.5) - EXPLORE.moodEase * mood * (diff - 2.5) * 0.5;
      }
      if (last >= 0) sc += EXPLORE.farWeight * Math.min(1, Math.hypot((t % n) - (last % n), ((t / n) | 0) - ((last / n) | 0)) / EXPLORE.farTiles);
      // difficulty variety: experts/advanced like the harder lines, beginners the easy ones (a piste at their limit is fine)
      sc += EXPLORE.skillDiff[Math.max(0, Math.min(3, skill))]! * (diff - 1.5);
      if (sc > bs) { bs = sc; best = t; }
    }
    if (best < 0) return 0;
    this.withVia++;
    return best + 1;
  }

  /** The guest reached its via tile: count the run on that tile. */
  recordVia(tile: number): void { if (this.runsToday[tile]! < 65535) this.runsToday[tile]!++; }
  /** Runs counted through the given tiles today (piste inspector). */
  runsAt(tiles: readonly number[]): number { let m = 0; for (const t of tiles) m += this.runsToday[t]!; return m; }
}
