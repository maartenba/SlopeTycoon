/**
 * Ski exploration measurement (docs/ski-exploration.md). Sim-only: builds a winter starter resort (1-2 lifts) or a bot-expanded one (4-6 lifts, each
 * with its own piste), runs N winter days at the real tick/clock and measures how guests spread over the pistes: runs per guest-day, distinct pistes
 * per guest-day, Gini of per-piste skiers and per-tile traffic, the share of pistes ridden by >= 10 % of skiers, ridden share of the piste length,
 * and the time budget (minutes per run / per 100 m of drop, queue minutes, arrival -> first lift).
 */
import { createSim, type Sim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { Act } from '../../src/sim/guests/Decision';
import { GState } from '../../src/sim/guests/Guest';
import { GAME_MINUTES_PER_TICK, TICKS_PER_DAY, TILE_METRES } from '../../src/config/balance';

export type Size = 64 | 128 | 256;
export interface SkiMetrics {
  size: Size; seed: number; lifts: number; pistes: number; guests: number; skiers: number;
  runsPerGuestDay: number; distinctPistes: number; piste1Share: number; giniPiste: number; giniTile: number; shareRidden10: number;
  coverage: number; minPerRun: number; minPer100mDrop: number; queueMinPerRide: number; firstLiftMin: number; meanDropM: number; ridesPerLift: number[]; timeShare: Record<string, number>; presenceH: number; runsFull: number; fullSkiers: number;
}

export function buildSkiResort(size: Size, seed: number, lifts: number, o: { day?: number } = {}): { sim: Sim; lifts: number } {
  const sim = createSim({ size, seed, startDay: o.day ?? 135, now: () => 0 });
  const rep = buildStarterResort(sim, { lifts });
  return { sim, lifts: rep.lifts.length };
}

export const gini = (v: number[]): number => {
  const a = [...v].sort((x, y) => x - y), n = a.length, s = a.reduce((p, c) => p + c, 0);
  if (!n || s <= 0) return 0;
  let w = 0; for (let i = 0; i < n; i++) w += (i + 1) * a[i]!;
  return (2 * w) / (n * s) - (n + 1) / n;
};

export function measureSki(sim: Sim, days: number, size: Size, seed: number): SkiMetrics {
  const st = sim.guestSim.store, n = sim.size;
  const comps = sim.networks.pisteComponents().filter((c) => c.count >= 4);
  const pisteOf = new Map<number, number>(); comps.forEach((c, k) => { for (const t of c.tiles) pisteOf.set(t, k); });
  const totalTiles = comps.reduce((a, c) => a + c.count, 0);
  const perGuestPistes = new Map<number, Set<number>>(), perGuestRuns = new Map<number, number>(), first = new Map<number, number>(), firstRide = new Map<number, number>();
  const last = new Map<number, number>();
  const pisteSkiers = new Array<number>(comps.length).fill(0);
  const tileDay = new Map<number, number>(); // tile -> total guest-tick visits
  const ridden = new Set<number>(); let coverSum = 0, coverDays = 0;
  let runTicks = 0, runCount = 0, queueTicks = 0, rides = 0;
  const runStart = new Map<number, number>(), qStart = new Map<number, number>(), lastRuns = new Map<number, number>();
  const liftRides = new Map<number, number>(); const prevRide = sim.guestWorld.onLiftRide;
  sim.guestWorld.onLiftRide = (l, id) => { liftRides.set(l, (liftRides.get(l) ?? 0) + 1); prevRide?.(l, id); };
  const share: Record<string, number> = {}; const bump = (k: string): void => { share[k] = (share[k] ?? 0) + 1; }; const names = ['None', 'ToBuilding', 'ToLift', 'Queue', 'Ride', 'SkiDown', 'ToTrail']; const sn = Object.keys(GState).filter((k) => Number.isNaN(Number(k)));
  const total = days * TICKS_PER_DAY, t0 = sim.game.date.tick;
  for (let t = 1; t <= total; t++) {
    sim.tick(1);
    const now = sim.game.date.tick - t0;
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i]) continue;
      const id = st.id[i]!;
      if (!first.has(id)) first.set(id, now);
      last.set(id, now);
      const s = st.state[i]!;
      if ((st.runs[i] ?? 0) > 0 || st.act[i] === Act.SkiDown || st.act[i] === Act.ToLift) bump(`${sn[s] ?? s}/${names[st.act[i]!] ?? st.act[i]}`);
      if (s === GState.Queueing && st.rideRun[i]) { if (!qStart.has(id)) qStart.set(id, now); }
      else if (qStart.has(id)) { queueTicks += now - qStart.get(id)!; rides++; qStart.delete(id); if (!firstRide.has(id)) firstRide.set(id, now); }
      if (st.act[i] === Act.SkiDown && s !== GState.Riding) {
        if (!runStart.has(id)) runStart.set(id, now);
        const tile = (st.y[i]! | 0) * n + (st.x[i]! | 0), k = pisteOf.get(tile);
        if (k !== undefined) {
          let ps = perGuestPistes.get(id); if (!ps) perGuestPistes.set(id, ps = new Set());
          ps.add(k); ridden.add(tile); tileDay.set(tile, (tileDay.get(tile) ?? 0) + 1);
        }
      }
      const r = st.runs[i]!, lr = lastRuns.get(id) ?? 0;
      if (r > lr) { lastRuns.set(id, r); perGuestRuns.set(id, r); const rs = runStart.get(id); if (rs !== undefined) { runTicks += now - rs; runCount++; } runStart.delete(id); }
      else if (st.act[i] !== Act.SkiDown && s !== GState.Riding) runStart.delete(id); // aborted / finished without a counted run
    }
    if (t % TICKS_PER_DAY === 0) { coverSum += ridden.size / Math.max(1, totalTiles); coverDays++; ridden.clear(); }
  }
  sim.guestWorld.onLiftRide = prevRide;
  const skiers = [...perGuestRuns.entries()].filter(([, r]) => r > 0);
  for (const [id] of skiers) for (const k of perGuestPistes.get(id) ?? []) pisteSkiers[k]!++;
  const nSk = Math.max(1, skiers.length);
  const full = skiers.filter(([id]) => st.overnightCount >= 0 && (last.get(id)! - first.get(id)!) >= 40 && (last.get(id)! - first.get(id)!) <= TICKS_PER_DAY * 0.7); // day guests present >= 4 h
  const meanDrop = comps.length ? comps.reduce((a, c) => a + Math.max(0, c.topAlt - c.bottomAlt) * TILE_METRES, 0) / comps.length : 0;
  const minPerRun = runCount ? (runTicks / runCount) * GAME_MINUTES_PER_TICK : 0;
  const tiles = [...pisteOf.keys()].map((t) => tileDay.get(t) ?? 0);
  return {
    size, seed, lifts: sim.lifts.all().length, pistes: comps.length, guests: first.size, skiers: skiers.length,
    runsPerGuestDay: skiers.reduce((a, [, r]) => a + r, 0) / nSk,
    distinctPistes: skiers.reduce((a, [id]) => a + (perGuestPistes.get(id)?.size ?? 0), 0) / nSk,
    piste1Share: skiers.filter(([id]) => (perGuestPistes.get(id)?.size ?? 0) <= 1).length / nSk,
    giniPiste: gini(pisteSkiers), giniTile: gini(tiles), shareRidden10: comps.length ? pisteSkiers.filter((c) => c / nSk >= 0.1).length / comps.length : 0,
    coverage: coverDays ? coverSum / coverDays : 0, minPerRun, minPer100mDrop: meanDrop > 0 ? (minPerRun / meanDrop) * 100 : 0,
    queueMinPerRide: rides ? (queueTicks / rides) * GAME_MINUTES_PER_TICK : 0, meanDropM: meanDrop,
    firstLiftMin: firstRide.size ? ([...firstRide.entries()].reduce((a, [id, t]) => a + (t - (first.get(id) ?? t)), 0) / firstRide.size) * GAME_MINUTES_PER_TICK : 0,
    ridesPerLift: [...liftRides.values()], timeShare: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, v / Math.max(1, Object.values(share).reduce((a, b) => a + b, 0))])), presenceH: 0, runsFull: full.length ? full.reduce((a, [, r]) => a + r, 0) / full.length : 0, fullSkiers: full.length,
  };
}
