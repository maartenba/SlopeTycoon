import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, collectSave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { GOALS } from '../../src/config/goals';

async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'goals'), { compress: true, yieldBetween: false });
  return (await decodeSave(bytes, { yieldBetween: false })).envelope;
}
const loadFrom = (env: Awaited<ReturnType<typeof snapshot>>, modules = env.modules): Sim => createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(modules) });
const played = (days: number): Sim => { const sim = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(sim, new Bot(sim, {}), days); return sim; };

describe('goals save module v1', () => {
  it('is registered as module "goals" (version 1) and serialises plain data', () => {
    const sim = played(2);
    const m = collectSave(sim).goals!;
    expect(m.v).toBe(1);
    expect(Object.keys(m.data as object).sort()).toEqual(['chapters', 'done', 'facts', 'granted']);
    expect(() => JSON.stringify(m.data)).not.toThrow();
  });

  it('round-trips through the full byte format: same done goals, facts, grants, ledger and state hash; no events fire on load', async () => {
    const sim = played(40);
    expect(sim.goals.completedCount).toBeGreaterThan(0);
    const env = await snapshot(sim);
    const fired: string[] = [];
    const restored = loadFrom(env);
    restored.bus.on('milestone', (e) => fired.push(e.id));
    expect(restored.goals.serialize()).toEqual(sim.goals.serialize());
    expect(restored.goals.view()).toEqual(sim.goals.view());
    expect(restored.economy.ledger.grant).toBe(sim.economy.ledger.grant);
    expect(stateHash(restored).parts.goals).toBe(stateHash(sim).parts.goals);
    expect(fired).toEqual([]);
    // keeps running identically (control = same save applied in place)
    applySave(sim, structuredClone(env.modules));
    // PisteTraffic.sink is a process-wide static: re-attach it to the sim that is about to tick (see tests/game/saveLoad.test.ts)
    for (let i = 0; i < 12; i++) { sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40); }
    expect(stateHash(restored).parts.goals).toBe(stateHash(sim).parts.goals);
  }, 120_000);

  it('an old save without the module (and without the "grant" ledger bucket) loads: fresh chain, satisfied goals auto-completed silently', async () => {
    const sim = played(40);
    const env = await snapshot(sim);
    const old = structuredClone(env.modules) as Record<string, { v: number; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
    delete old.goals;
    // strip the new ledger category like a save written before M5.1
    const strip = (b: any): void => { if (b?.income) delete b.income.grant; };  // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = old['sys.economy']!.data.economy;
    for (const k of ['total', 'day', 'month', 'year']) strip(e[k]);
    for (const r of e.history) strip(r);
    const fired: string[] = [];
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: old as never });
    restored.bus.on('milestone', (x) => fired.push(x.id));
    for (const id of ['firstLift', 'greenRun', 'patrol']) expect(restored.goals.isDone(id), id).toBe(true); // the resort already has them
    expect(restored.goals.granted).toBe(0);
    expect(restored.economy.ledger.grant).toBe(0);
    expect(fired).toEqual([]); // no toast, no confetti on load
    // bookkeeping still works (no NaN from the missing bucket) and the chain carries on
    restored.tick(480);
    const led = restored.economy.ledger;
    for (const v of Object.values(led)) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(restored.economy.monthBuckets().income.grant)).toBe(true);
    expect(restored.goals.view().active.length).toBeGreaterThan(0);
  }, 120_000);

  it('unknown / removed goal ids in a save are ignored, a newer module version is rejected by the registry', () => {
    const sim = createSim({ size: 64, seed: 3, now: () => 0 });
    sim.goals.load({ done: ['firstLift', 'doesNotExist'], chapters: ['s1', 'nope'], facts: { bestDay: 7 }, granted: 100 });
    expect(sim.goals.isDone('firstLift')).toBe(true);
    expect(sim.goals.completedCount).toBe(1);
    expect(sim.goals.facts.bestDay).toBe(7);
    expect(sim.goals.facts.lifetime).toBe(0); // missing fields default
    const mods = collectSave(sim); mods.goals = { v: 2, data: {} };
    expect(() => applySave(sim, mods)).toThrow(/newer game version/);
  });

  it('a pre-built (sandbox) starter resort ticks off its goals quietly at game start', () => {
    const fired: string[] = [];
    // autoEvents off: with them on (the default) a day-one arrival bump can legitimately reach 'Welcome 30 guests in a day' and close chapter s1 inside this window; this test only pins the gift-resort ticking.
    const sim = createSim({ size: 64, seed: 61, starterResort: true, autoEvents: false, now: () => 0 });
    sim.bus.on('milestone', (e) => fired.push(e.id));
    expect(sim.goals.isDone('firstLift')).toBe(true);
    expect(sim.goals.granted).toBe(0);
    expect(GOALS.length).toBe(20);
    sim.tick(240);
    expect(fired.filter((id) => id.startsWith('chapter:'))).toEqual([]); // no burst on the first day of a gift resort
  }, 60_000);
});
