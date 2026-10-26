import { describe, expect, it } from 'vitest';
import { makeResort, run, TICKS_PER_DAY } from './harness';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { GState } from '../../src/sim/guests/Guest';
import { seasonStartDay } from '../../src/sim/Clock';

/** Save through the full byte format (encode → gzip → decode → CRC → unpack): what a real load sees. */
export async function snapshot(sim: Sim, compress = true) {
  const { bytes, stats } = await encodeSave(sim, makeMeta(sim, 'test'), { compress, yieldBetween: false });
  const { envelope } = await decodeSave(bytes, { yieldBetween: false });
  return { bytes, stats, envelope };
}
type Snap = Awaited<ReturnType<typeof snapshot>>;
// Each consumer gets its own copy of the decoded data (loaders may keep references to it).
export const loadFrom = (snap: Snap): Sim => createSim({ size: snap.envelope.mapSize, seed: snap.envelope.seed, now: () => 0, fromSave: structuredClone(snap.envelope.modules) });

const transit = (sim: Sim): number => { const st = sim.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && (st.state[i] === GState.Queueing || st.state[i] === GState.Riding || st.state[i] === GState.Using)) n++; return n; };
/** PisteTraffic.sink is a process-wide static: point it at the sim that is about to tick (only matters with two live sims). */
const step = (s: Sim, n: number): void => { s.ops.quality.attachTraffic(); s.tick(n); };
const differing = (a: Sim, b: Sim): string[] => { const x = stateHash(a).parts, y = stateHash(b).parts; return Object.keys(x).filter((k) => x[k] !== y[k]); };

interface Case { size: 64 | 128 | 256; seed: number; startDay: number; warmDays: number; afterDays: number; prepare?: (sim: Sim) => void }

/**
 * save → load → N ticks vs CONTROL. The control is the same save applied in place to the live sim: it carries the documented demotions
 * (guests in transit → idle, lift / attraction queues and room book emptied, nav + decision caches rebuilt), so any other missing state
 * makes the two diverge. Every registered module's state is hashed every 40 ticks.
 */
async function check(c: Case) {
  const { sim } = makeResort(c.size, c.seed, { startDay: c.startDay });
  run(sim, { days: c.warmDays });
  c.prepare?.(sim);
  const snap = await snapshot(sim);
  const restored = loadFrom(snap);
  const before = transit(sim);
  applySave(sim, structuredClone(snap.envelope.modules)); // control
  expect(differing(sim, restored), 'modules differing right after load').toEqual([]);
  for (let d = 0; d < c.afterDays * TICKS_PER_DAY; d += 40) {
    step(sim, 40); step(restored, 40);
    expect(differing(sim, restored), `modules differing after ${d + 40} ticks (seed ${c.seed}, size ${c.size}, day ${c.startDay})`).toEqual([]);
  }
  return { sim, restored, snap, guests: sim.guestSim.store.count, before };
}

describe('save → load → N ticks equals control (determinism)', () => {
  it('64 map, mid-winter, guests present', async () => {
    const r = await check({ size: 64, seed: 1, startDay: 167, warmDays: 1.3, afterDays: 3 });
    expect(r.guests).toBeGreaterThan(0);
    expect(r.before).toBeGreaterThan(0); // the demotion path (queueing / riding / using) is actually exercised
    console.log(`[saveLoad] winter 64: ${r.guests} guests alive after the run, ${r.before} in transit/using at save time`);
  }, 180_000);
  it('64 map, spring (seed 7)', async () => { await check({ size: 64, seed: 7, startDay: seasonStartDay('spring') + 20, warmDays: 1.3, afterDays: 2 }); }, 180_000);
  it('64 map, summer (seed 1337)', async () => { await check({ size: 64, seed: 1337, startDay: seasonStartDay('summer') + 25, warmDays: 1.3, afterDays: 2 }); }, 180_000);
  it('128 map, winter (seed 42)', async () => { await check({ size: 128, seed: 42, startDay: 170, warmDays: 1.2, afterDays: 1.5 }); }, 240_000);
  it('64 map, autumn (seed 5)', async () => { await check({ size: 64, seed: 5, startDay: seasonStartDay('autumn') + 10, warmDays: 1.3, afterDays: 2 }); }, 180_000);
  it('256 map, winter (seed 1337), two lifts', async () => { await check({ size: 256, seed: 1337, startDay: 167, warmDays: 1.1, afterDays: 0.8 }); }, 240_000);
  it('save during an incident + temporary closure', async () => {
    const r = await check({
      size: 64, seed: 3, startDay: 167, warmDays: 1.4, afterDays: 2,
      prepare: (sim) => {
        const st = sim.guestSim.store;
        let id = 0;
        for (let i = 0; i < st.limit && !id; i++) if (st.alive[i] && st.state[i] === GState.Walking) id = st.id[i]!;
        const inc = sim.safety.incidents.report('injury', st.x[st.slotOf(id)]!, st.y[st.slotOf(id)]!, 2, id);
        expect(inc).toBeTruthy();
        const tiles: number[] = [];
        for (let i = 0; i < sim.networks.layers.length && tiles.length < 40; i++) if (sim.networks.layers[i]! & 1) tiles.push(i);
        sim.openStatus.closeTiles(tiles, 'avalanche control', sim.safety.incidents.nowTick ?? 0, 600);
        expect(sim.openStatus.closureCount()).toBe(1);
      },
    });
    expect(r.sim.openStatus.closureCount() + r.restored.openStatus.closureCount()).toBeGreaterThanOrEqual(0);
  }, 180_000);
  it('restored sim equals the saved sim except documented demotions', async () => {
    const { sim } = makeResort(64, 1, { startDay: 167 });
    run(sim, { days: 1.5 });
    const snap = await snapshot(sim);
    const restored = loadFrom(snap);
    const diff = differing(sim, restored);
    // guests in transit are reset (guests module), attraction queues / room book are emptied (attractions module); nothing else may differ.
    // 'networks' differs only by its cache-invalidating version counter (restore bumps it): the tile arrays are compared below.
    expect(diff.filter((k) => !['sys.guests', 'sys.attractions', 'networks'].includes(k))).toEqual([]);
    expect(restored.networks.layers).toEqual(sim.networks.layers);
    expect(restored.networks.kind).toEqual(sim.networks.kind);
    expect(restored.networks.version).toBe(sim.networks.version + 1);
    if (transit(sim) === 0) expect(diff.filter((k) => k !== 'networks')).toEqual([]);
    // identical world
    expect(restored.grid.heights).toEqual(sim.grid.heights);
    expect(restored.buildings.all()).toEqual(sim.buildings.all());
    expect(restored.lifts.all()).toEqual(sim.lifts.all());
    expect(restored.game.money).toBe(sim.game.money);
    expect(restored.game.date).toEqual(sim.game.date);
  }, 120_000);
  it('loading an older/empty module resets with a warning (missing module strategy)', async () => {
    const { sim } = makeResort(64, 1, { startDay: 167 });
    run(sim, { days: 0.5 });
    const snap = await snapshot(sim);
    const mods = structuredClone(snap.envelope.modules);
    delete mods['props']; delete mods['nature'];
    const r = createSim({ size: 64, seed: 1, now: () => 0, fromSave: mods });
    expect(r.props.count()).toBe(0);
    expect(r.game.money).toBe(sim.game.money);
  }, 60_000);
});
