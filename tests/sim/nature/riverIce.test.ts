import { describe, expect, it } from 'vitest';
import { makeResort } from '../../game/harness';
import { FlowModel } from '../../../src/sim/nature/Flow';
import type { RiverRec } from '../../../src/world/Rivers';
import { applyRiver, planRiver } from '../../../src/world/RiverPlanner';
import { decodeSave, encodeSave, makeMeta } from '../../../src/persist/Serializer';
import { createSim, type Sim } from '../../../src/game/createSim';
import { stateHash } from '../../../src/game/saveState';
import { simDayOf } from '../../../src/sim/calendar';

const model = (): FlowModel => new FlowModel({ natural: () => [], rivers: () => ({ rivers: [] as RiverRec[], version: 0 }) });

describe('river ice (hysteresis)', () => {
  it('freezes after 3 days below -2 C, not after 2; a mild day resets the count', () => {
    const m = model();
    m.onDay(0, -3); m.onDay(1, -3); expect(m.frozen).toBe(false);
    m.onDay(2, -1); expect(m.frozen).toBe(false); // -1 is not cold enough: count resets
    m.onDay(3, -3); m.onDay(4, -3); expect(m.frozen).toBe(false);
    m.onDay(5, -3); expect(m.frozen).toBe(true);
  });
  it('thaws after 2 days above +1 C; a cold or near-zero day in between resets; no flapping around 0', () => {
    const m = model();
    for (let d = 0; d < 3; d++) m.onDay(d, -4);
    expect(m.frozen).toBe(true);
    m.onDay(3, 2); expect(m.frozen).toBe(true);
    m.onDay(4, 0); m.onDay(5, 2); expect(m.frozen).toBe(true);
    m.onDay(6, 2); expect(m.frozen).toBe(false);
    for (const t of [0, -1, 0.5, -1.5, 0]) m.onDay(10, t); // grey zone: stays thawed
    expect(m.frozen).toBe(false);
  });
  it('settle() jumps straight to the state of the temperature; the grey zone keeps the previous state; ice round-trips', () => {
    const m = model();
    m.settle(0, -6); expect(m.frozen).toBe(true);
    m.settle(1, 0); expect(m.frozen).toBe(true);
    const copy = model(); copy.loadIce(JSON.parse(JSON.stringify(m.serializeIce()))); expect(copy.frozen).toBe(true);
    m.settle(2, 5); expect(m.frozen).toBe(false);
    copy.resetIce(); expect(copy.frozen).toBe(false);
  });
});

function dig(sim: Sim): Array<{ x: number; y: number }> {
  const env = sim.riverEnv(), N = sim.size;
  for (const s of sim.rivers.natural) {
    for (const l of sim.terrainInfo.lakes) {
      const t = l.tileIdx[0]!, p = planRiver(env, s, { x: t % N, y: (t / N) | 0 });
      if (p.ok && p.cost > 0 && applyRiver(env, sim.rivers, p).ok) return p.path;
    }
    const p = planRiver(env, s);
    if (p.ok && applyRiver(env, sim.rivers, p).ok) return p.path;
  }
  throw new Error('no river');
}

describe('river ice across a real season', () => {
  it('a dug river freezes in winter (flow 0, tours closed) and thaws in spring; natural streams are never frozen by the model; saves keep the ice', async () => {
    const { sim } = makeResort(64, 61); // new games start 1 December
    const path = dig(sim);
    const id = `r${sim.rivers.rivers[0]!.id}`;
    const log: Array<{ day: number; frozen: boolean; speed: number; temp: number }> = [];
    sim.bus.on('day:changed', () => { const w = sim.flow.get(id)!; log.push({ day: sim.game.date.day, frozen: sim.flow.frozen, speed: w.speed[Math.floor(path.length / 2)]!, temp: sim.weather.current.valleyT }); });
    sim.tick(240 * 150); // Dec .. into spring
    const first = log.findIndex((l) => l.frozen), last = log.map((l) => l.frozen).lastIndexOf(true);
    expect(first, JSON.stringify(log.slice(0, 5))).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);
    expect(log[log.length - 1]!.frozen).toBe(false); // thawed again by the time spring is well on its way
    // while frozen: no flow, and every frozen day had a hysteresis cause
    for (const l of log.slice(first, last + 1)) if (l.frozen) expect(l.speed).toBe(0);
    for (const l of log.filter((x) => !x.frozen)) expect(l.speed).toBeGreaterThan(0);
    // freezing took at least 3 days of the cold run; the first frozen day had 3 mean temps below -2 C right before it
    const cold = log.slice(Math.max(0, first - 2), first + 1).map((l) => l.temp);
    expect(cold.every((t) => t < -2)).toBe(true);
    // natural streams: never "frozen" by the model
    for (const w of sim.flow.all().values()) if (w.kind === 'natural') expect(w.frozen).toBe(false);
  });

  it('save / load keeps the ice (inside the rivers module); no rivers: nothing saved, hash untouched by the ice state', async () => {
    const { sim } = makeResort(64, 61);
    sim.flow.settle(0, -8);
    expect(stateHash(sim).parts.rivers).toBeUndefined();
    const { sim: s2 } = makeResort(64, 61);
    dig(s2);
    s2.flow.settle(0, -8);
    expect(s2.flow.frozen).toBe(true);
    const { bytes } = await encodeSave(s2, makeMeta(s2, 't'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const loaded = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(loaded.flow.frozen).toBe(true);
    expect(stateHash(loaded).parts.rivers).toBe(stateHash(s2).parts.rivers);
    expect(loaded.flow.get(`r${loaded.rivers.rivers[0]!.id}`)!.frozen).toBe(true);
  });

  it('jumpToDay settles the ice from the weather of that day', () => {
    const { sim } = makeResort(64, 61);
    dig(sim);
    sim.jumpToDay(simDayOf(0, 8)); // mid January
    const jan = sim.flow.frozen, t = sim.weather.current.valleyT;
    if (t < -2) expect(jan).toBe(true); // deep cold => frozen
    sim.jumpToDay(simDayOf(6, 8)); // mid July
    expect(sim.flow.frozen).toBe(false);
  });
});
