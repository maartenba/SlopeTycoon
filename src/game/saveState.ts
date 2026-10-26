/**
 * Save registry (Task 33): every stateful sim module registers `{key, version, serialize, load}`; `collectSave` / `applySave` walk the list.
 * Derived state (coverage, spatial hash, nav graph, piste index, forest cover, open/closed verdicts) is NOT saved but rebuilt in `finishLoad`.
 *
 * Documented demotions (identical for the control run of the determinism test, see docs/saves.md):
 *  - guests Queueing / Riding a lift become Idle (lift queues are rebuilt empty);
 *  - guests Using an attraction stay `Using` but attraction queues/slots are empty (released by the next membership check);
 *  - overnight room bookings (RoomBook) are cleared;
 *  - navigation graph, guest paths and decision caches restart (they are rebuilt lazily from the restored world).
 */
import type { Sim } from './createSim';
import { CHUNK_SIZE } from '../world/Grid';
import type { PropChunk } from '../world/Props';
import { pack } from '../persist/codec';

export interface ModuleData { v: number; data: unknown }
export type SaveModules = Record<string, ModuleData>;

export interface SaveModule {
  key: string;
  version: number;
  serialize(sim: Sim): unknown;
  load(sim: Sim, data: unknown, version: number): void;
  /** Pure observer state (achievements): saved, but not part of `stateHash` (it can never change a simulation outcome). */
  observer?: boolean;
  /** Called when the save has no data for this module (older save): put the module in a sane default state. */
  reset?(sim: Sim): void;
}

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const sysModule = (id: string): SaveModule => ({
  key: `sys.${id}`, version: 1,
  serialize: (sim) => sim.registry.get(id)?.serialize?.() ?? null,
  load: (sim, d) => { if (d !== null) sim.registry.get(id)?.load?.(d); },
});

const TAU = Math.PI * 2;
const emptyProps = (): PropChunk => ({ kind: [], tx: [], ty: [], ox: [], oy: [], scale: [], rot: [], seed: [], born: [] });

/** Load order matters: world first, then stores, then the registry systems (which read them), then derived-state consumers. */
export const SAVE_MODULES: SaveModule[] = [
  {
    key: 'core', version: 1,
    serialize: (sim) => ({ seed: sim.seed, size: sim.size, date: { ...sim.game.date }, money: sim.game.money, rng: sim.game.rng.getState(), ids: sim.game.ids.getState(), loop: sim.loop.serialize(), simTick: sim.getSimTick(), locked: sim.economy.locked }),
    load: (sim, d) => {
      const s = d as Obj;
      Object.assign(sim.game.date, s.date); sim.game.money = s.money; sim.game.rng.setState(s.rng); sim.game.ids.setState(s.ids);
      sim.loop.load(s.loop); sim.setSimTick(s.simTick);
    },
  },
  // New-game options (size / seed / preset / difficulty / start season / money / loan / radius / sandbox / hints). Read by createSim BEFORE terrain generation.
  { key: 'config', version: 1, serialize: (sim) => ({ ...sim.config }), load: () => { /* consumed by createSim (terrain, difficulty, radius are derived from it) */ } },
  {
    key: 'grid', version: 1,
    serialize: (sim) => { const g = sim.grid; return { heights: g.heights.slice(), tileType: g.tileType.slice(), snow: g.snowDepth.slice(), flags: g.flags.slice(), occId: g.occupancy.entityId.slice(), occFlags: g.occupancy.flags.slice() }; },
    load: (sim, d) => {
      const s = d as Obj, g = sim.grid;
      g.heights.set(s.heights); g.tileType.set(s.tileType); g.snowDepth.set(s.snow); g.flags.set(s.flags); g.occupancy.entityId.set(s.occId); g.occupancy.flags.set(s.occFlags);
      for (let cy = 0; cy < g.chunksPerRow; cy++) for (let cx = 0; cx < g.chunksPerRow; cx++) g.markDirty(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      g.markAllSnowDirty();
    },
  },
  {
    key: 'props', version: 1,
    // Props dominate save size (~100k on a 256 map): sub-tile jitter / scale / rotation are quantised (8-16 bit, idempotent: re-saving a
    // loaded prop store yields the same bytes). Position inside the tile (1/255), rotation (1.4°) and scale (0.001) are cosmetic; kind, tile
    // and growth (`born`) are exact and are the only fields the sim reads.
    serialize: (sim) => ({
      now: sim.props.now,
      chunks: sim.props.chunks.map((c) => ({
        kind: Uint8Array.from(c.kind), tx: Uint16Array.from(c.tx), ty: Uint16Array.from(c.ty),
        ox: Uint8Array.from(c.ox, (v) => Math.round(v * 255)), oy: Uint8Array.from(c.oy, (v) => Math.round(v * 255)),
        scale: Uint16Array.from(c.scale, (v) => Math.min(65535, Math.round(v * 1000))), rot: Uint8Array.from(c.rot, (v) => Math.round((((v % TAU) + TAU) % TAU) / TAU * 256) & 255),
        seed: Uint8Array.from(c.seed), born: Int32Array.from(c.born),
      })),
    }),
    load: (sim, d) => {
      const s = d as { now: number; chunks: Array<Record<string, ArrayLike<number>>> };
      s.chunks.forEach((c, i) => {
        if (i >= sim.props.chunks.length) return;
        const f = (a: ArrayLike<number>, k = 1): number[] => Array.from(a, (v) => v / k);
        sim.props.chunks[i] = {
          kind: f(c.kind!), tx: f(c.tx!), ty: f(c.ty!), ox: f(c.ox!, 255), oy: f(c.oy!, 255), scale: f(c.scale!, 1000),
          rot: Array.from(c.rot!, (v) => (v / 256) * TAU), seed: f(c.seed!), born: f(c.born!),
        };
        sim.props.chunkVersion[i]!++;
      });
      sim.props.now = s.now;
    },
    reset: (sim) => { sim.props.chunks.forEach((_, i) => { sim.props.chunks[i] = emptyProps(); }); },
  },
  {
    key: 'networks', version: 1,
    serialize: (sim) => { const n = sim.networks; return { kind: n.kind.slice(), conn: n.conn.slice(), bridge: n.bridge.slice(), layers: n.layers.slice(), difficulty: n.difficulty.slice(), quality: n.quality.slice(), roadEntry: n.roadEntry, railEntry: n.railEntry, version: n.version }; },
    load: (sim, d) => sim.networks.restoreAll(d as Parameters<Sim['networks']['restoreAll']>[0]),
  },
  {
    key: 'buildings', version: 1,
    serialize: (sim) => ({ items: sim.buildings.serialize(), nextId: sim.buildings.nextIdValue() }),
    load: (sim, d) => { const s = d as Obj; sim.buildings.restore(s.items, s.nextId); sim.buildings.reevaluate(); /* networks load first: never trust a saved status */ },
  },
  {
    key: 'lifts', version: 1,
    serialize: (sim) => ({ items: sim.lifts.serialize(), nextId: sim.lifts.nextIdValue() }),
    load: (sim, d) => { const s = d as Obj; sim.lifts.restore(s.items, s.nextId); },
  },
  {
    key: 'cond', version: 1,
    serialize: (sim) => ({ skiOpen: sim.cond.skiOpen.slice(), hikeOk: sim.cond.hikeOk.slice() }),
    load: (sim, d) => { const s = d as Obj; sim.cond.skiOpen.set(s.skiOpen); sim.cond.hikeOk.set(s.hikeOk); },
  },
  { key: 'names', version: 1, serialize: (sim) => sim.names.serialize(), load: (sim, d) => sim.names.load(d as Parameters<Sim['names']['load']>[0]) },
  { key: 'nature', version: 1, serialize: (sim) => sim.nature.serialize(), load: (sim, d) => sim.nature.load(d) },
  { key: 'leavers', version: 1, serialize: (sim) => sim.leavers.serialize(), load: (sim, d) => sim.leavers.load(d as { v: number }) },
  ...(['clock', 'season', 'weather', 'spawner', 'guests', 'attractions', 'ops', 'economy', 'rating'] as const).map(sysModule),
  { key: 'families', version: 1, serialize: (sim) => sim.guestSim.families.serialize(), load: (sim, d) => sim.guestSim.families.load(d) },
  { key: 'openStatus', version: 1, serialize: (sim) => sim.openStatus.serialize(), load: (sim, d) => sim.openStatus.load(d) },
  // Welcome-back recap data (M5.1). Additive: old saves have none -> reduced recap.
  { key: 'sessionMeta', version: 1, serialize: (sim) => sim.session.serialize(), load: (sim, d) => sim.session.load(d), reset: (sim) => sim.session.reset() },
  // Resort goal chain. Keep LAST: reset() (old saves without it) silently completes goals the restored world already satisfies.
  { key: 'goals', version: 1, serialize: (sim) => sim.goals.serialize(), load: (sim, d) => sim.goals.load(d), reset: (sim) => sim.goals.reset() },
  // Daily stats ring + Resort of the Year reports (M5.3). Additive: old saves have none -> empty history / no reports.
  { key: 'stats', version: 1, serialize: (sim) => sim.stats.serialize(), load: (sim, d) => sim.stats.load(d), reset: (sim) => sim.stats.reset() },
  { key: 'yearReports', version: 1, serialize: (sim) => sim.yearReports.serialize(), load: (sim, d) => sim.yearReports.load(d), reset: (sim) => sim.yearReports.reset() },
  // Advisor snooze timers (Ranger Rudi). Additive: old saves have none -> nothing snoozed.
  { key: 'advisor', version: 1, serialize: (sim) => sim.advisor.serialize(), load: (sim, d) => sim.advisor.load(d), reset: (sim) => sim.advisor.reset() },
  // Game mode + latched resort level + unlocked-item snapshot + level-up history (M5.3). Old saves have none -> Sandbox (everything unlocked).
  {
    key: 'progression', version: 1,
    serialize: (sim) => sim.progression.serialize(),
    load: (sim, d) => { sim.progression.load(d); sim.config.mode = sim.progression.mode; },
    reset: (sim) => { sim.progression.reset(); sim.config.mode = 'sandbox'; },
  },
  // Scenario progress (M5.3 Task 15): def id + version + objective states + start day. Additive: old saves have none -> no scenario. Rules (modifiers) are re-applied from `config.scenario`.
  {
    key: 'scenario', version: 1,
    serialize: (sim) => sim.scenario?.serialize() ?? null,
    load: (sim, d) => {
      const sc = sim.scenario;
      if (!sc || d === null) return;
      if (!sc.load(d)) sc.begin();
      if (sc.sandbox) { sim.progression.unlockAll = true; sim.goals.paused = false; }
    },
  },
  // Per-game achievement tracker state (windows, streaks, distinct sets; M5.3 Task 16). Observer: excluded from stateHash. Profile-wide unlocks live in the ProfileStore, not here.
  { key: 'achievementsRun', version: 1, observer: true, serialize: (sim) => sim.achievements.serializeRun(), load: (sim, d) => sim.achievements.loadRun(d), reset: (sim) => sim.achievements.resetRun() },
];

export { SAVE_FORMAT_VERSION as SAVE_VERSION } from '../persist/migrations';

/** Plain (un-packed) module data of the whole sim. Typed arrays are copies. */
export function collectSave(sim: Sim): SaveModules {
  const out: SaveModules = {};
  for (const m of SAVE_MODULES) out[m.key] = { v: m.version, data: m.serialize(sim) };
  return out;
}

/** Collect one module at a time (the async saver yields in between). */
export function collectModule(sim: Sim, m: SaveModule): ModuleData { return { v: m.version, data: m.serialize(sim) }; }

export interface LoadReport { warnings: string[]; missing: string[] }

/** Restore every module, then rebuild derived state. Missing modules are reset with a warning. Throws on a newer module version. */
export function applySave(sim: Sim, modules: SaveModules): LoadReport {
  const report: LoadReport = { warnings: [], missing: [] };
  for (const m of SAVE_MODULES) {
    const entry = modules[m.key];
    if (!entry || entry.data === undefined) {
      report.missing.push(m.key); report.warnings.push(`Save has no '${m.key}' data (older save): using defaults.`);
      m.reset?.(sim);
      continue;
    }
    if (entry.v > m.version) throw new Error(`Module '${m.key}' was saved by a newer game version (${entry.v} > ${m.version}).`);
    m.load(sim, entry.data, entry.v);
  }
  finishLoad(sim);
  return report;
}

/** Rebuild everything derived from the restored state. */
export function finishLoad(sim: Sim): void {
  sim.refreshCoverage(undefined, true);
  sim.guestSim.resetRuntime();
  sim.economy.locked = sim.finance.ended;
  sim.nature.cover.rebuild();
}

/** FNV-1a over every registered module's saved form (typed arrays included). Returns the total plus per-module hashes (debugging). */
export function stateHash(sim: Sim): { hash: string; parts: Record<string, string> } {
  const parts: Record<string, string> = {};
  let total = 0x811c9dc5;
  for (const m of SAVE_MODULES) {
    if (m.observer) continue;
    const text = JSON.stringify(pack(m.serialize(sim)));
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    parts[m.key] = h.toString(16).padStart(8, '0');
    total ^= h; total = Math.imul(total, 0x01000193) >>> 0;
  }
  return { hash: total.toString(16).padStart(8, '0'), parts };
}
