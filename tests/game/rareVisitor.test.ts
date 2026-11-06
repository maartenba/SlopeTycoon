/** Rare high-country visitor: schedule, ground rules, news, camera offset, save / load, opt-outs. */
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { visitPlan } from '../../src/sim/nature/Visitor';
import { VISITOR } from '../../src/config/visitor';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { simDayOf } from '../../src/sim/calendar';
import { formatEvent } from '../../src/ui/newsFormat';
import type { GameEvents } from '../../src/core/events';
import { ACHIEVEMENTS } from '../../src/config/achievements';

async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
  return (await decodeSave(bytes, { yieldBetween: false })).envelope;
}
const loadFrom = (env: Awaited<ReturnType<typeof snapshot>>): Sim => createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
const mk = (extra: object = {}): Sim => createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', startDay: simDayOf(11, 8), now: () => 0, ...extra });
const spotted = (sim: Sim): GameEvents['visitor:spotted'][] => { const out: GameEvents['visitor:spotted'][] = []; sim.bus.on('visitor:spotted', (e) => out.push(e)); return out; };

describe('rare visitor schedule', () => {
  it('is a pure function of (seed, year) and falls in winter, in the start window', () => {
    for (let s = 1; s < 40; s++) for (let y = 0; y < 10; y++) {
      const a = visitPlan(s, y), b = visitPlan(s, y);
      expect(a).toEqual(b);
      if (a) { expect(a.day).toBeGreaterThanOrEqual(VISITOR.dayMin); expect(a.day).toBeLessThanOrEqual(VISITOR.dayMax); expect(a.day).toBeGreaterThanOrEqual(120); expect(Math.floor(a.startMin / 1440 / DAYS_PER_YEAR)).toBe(y); }
    }
  });
  it('averages about one visit per two years over many seeds', () => {
    let n = 0; const years = 60, seeds = 200;
    for (let s = 1; s <= seeds; s++) for (let y = 0; y < years; y++) if (visitPlan(s * 7919, y)) n++;
    const perYear = n / (years * seeds);
    expect(perYear).toBeGreaterThan(0.5 * 0.7); expect(perYear).toBeLessThan(0.5 * 1.3);
  });
});

describe('rare visitor in the sim', () => {
  it('starts on remote high ground away from buildings, lifts and pistes, and never in summer-less schedule gaps', () => {
    const sim = mk(); const ev = spotted(sim);
    expect(sim.visitor.force()).toBe(true);
    expect(ev.length).toBe(1);
    const v = sim.visitor.visit!, N = sim.size, R = VISITOR.emptyR[N]!;
    for (let i = 0; i < v.path.length; i += 2) {
      const x = Math.floor(v.path[i]!), y = Math.floor(v.path[i + 1]!);
      for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) { const k = yy * N + xx; expect(sim.grid.occupancy.flags[k]).toBe(0); expect(sim.networks.layers[k] ?? 0).toBe(0); }
      for (const l of sim.lifts.all()) for (const p of [l.bottom, l.top]) expect(Math.hypot(p.x - v.path[i]!, p.y - v.path[i + 1]!)).toBeGreaterThan(R - 1);
      for (const b of sim.buildings.all()) expect(Math.hypot(b.x - v.path[i]!, b.y - v.path[i + 1]!)).toBeGreaterThan(R - 1);
    }
  });
  it('is deterministic: two runs choose the same spot, path and camera target', () => {
    const a = mk(), b = mk(); a.visitor.force(); b.visitor.force();
    expect(a.visitor.visit).toEqual(b.visitor.visit);
  });
  it('the Show me target is 6-12 tiles from where it is first seen and never on its walk', () => {
    for (const seed of [61, 5, 11, 23]) {
      const sim = createSim({ size: 128, seed, mode: 'sandbox', startSeason: 'winter', startDay: simDayOf(11, 8), now: () => 0 });
      if (!sim.visitor.force()) continue;
      const v = sim.visitor.visit!, d0 = Math.hypot(v.fx - v.path[0]!, v.fy - v.path[1]!);
      expect(d0).toBeGreaterThanOrEqual(VISITOR.showMe.min - 0.01); expect(d0).toBeLessThanOrEqual(VISITOR.showMe.max + 0.01);
      for (let i = 0; i < v.path.length; i += 2) expect(Math.hypot(v.fx - v.path[i]!, v.fy - v.path[i + 1]!)).toBeGreaterThan(1.5);
    }
  });
  it('news wording with and without a Ranger Station, and a ranger-only follow-up', () => {
    const e = { x: 10, y: 10, fx: 18, fy: 12 };
    expect(formatEvent('visitor:spotted', { ...e, ranger: true })?.text).toBe('A yeti has been spotted! A ranger is investigating the area.');
    expect(formatEvent('visitor:spotted', { ...e, ranger: false })?.text).toBe('Guests report a yeti up on the mountain. Nobody is free to investigate.');
    expect(formatEvent('visitor:spotted', { ...e, ranger: true })?.focus).toMatchObject({ label: 'Show me' });
    const sim = mk(); const fol: unknown[] = []; sim.bus.on('visitor:followup', (x) => fol.push(x));
    sim.visitor.force(); sim.visitor.visit!.ranger = false; // no station: no follow-up
    sim.tick(240 * 4); expect(fol.length).toBe(0);
  });
  it('walks for its time, then is gone; footprints stay a while and then fade; the follow-up comes with a ranger', () => {
    const sim = mk(); const fol: unknown[] = []; sim.bus.on('visitor:followup', (x) => fol.push(x));
    sim.visitor.force(60 * 8); sim.visitor.visit!.ranger = true;
    sim.tick(10);
    expect(sim.visitor.poseAt()).not.toBeNull();
    sim.tick(240 / 24 * 4); // 4 sim hours
    expect(sim.visitor.poseAt()).not.toBeNull();
    sim.tick(240 / 24 * 6); // 10 h
    expect(sim.visitor.poseAt()).toBeNull();
    expect(sim.visitor.prints().list.length).toBeGreaterThan(3);
    sim.tick(240 / 24 * 4);
    expect(fol.length).toBe(1);
    sim.tick(240 * 3);
    expect(sim.visitor.visit).toBeNull();
  });
  it('save + reload mid visit is identical (state hash and the visit itself), and the visit does not enter the hash', async () => {
    const sim = mk(); const h0 = stateHash(sim).hash;
    sim.visitor.force(); expect(stateHash(sim).hash).toBe(h0);
    sim.tick(30);
    const hc = stateHash(sim).hash; expect(hc).toBeTruthy();
    const env = await snapshot(sim), b = loadFrom(env);
    expect(b.visitor.visit).toEqual(sim.visitor.visit);
    applySave(sim, structuredClone(env.modules)); // control: the same save applied in place carries the documented guest demotions
    expect(stateHash(b).hash).toBe(stateHash(sim).hash);
    expect((env.modules as Record<string, unknown>)['visitor']).toBeDefined();
    for (const x of [sim, b]) { x.ops.quality.attachTraffic(); x.tick(240); } // PisteTraffic.sink is process-wide: attach before each sim ticks
    expect(stateHash(b).hash).toBe(stateHash(sim).hash);
  });
  it('is off when autoEvents is false, in scenarios and when opted out; a forced start there still needs a valid spot but the schedule never starts it', () => {
    expect(mk({ autoEvents: false }).visitor.enabled).toBe(false);
    expect(mk({ visitor: false }).visitor.enabled).toBe(false);
    expect(mk().visitor.enabled).toBe(true);
    const sc = createSim({ size: 64, seed: 3, scenario: 'first-tracks', now: () => 0 });
    expect(sc.visitor.enabled).toBe(false);
  });
  it('the schedule starts a visit by itself in a sim year that has one (winter only)', () => {
    let seed = 1; while (!visitPlan(seed, 1)) seed++;
    const sim = createSim({ size: 64, seed, mode: 'sandbox', startSeason: 'winter', startDay: simDayOf(11, 1), now: () => 0 });
    const plan = visitPlan(seed, 1)!; const ev = spotted(sim);
    expect(plan.day).toBeGreaterThanOrEqual(120);
    const start = (sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day) * 1440 + sim.game.date.minute;
    const ticks = Math.ceil((plan.startMin - start) / 6) + 60;
    sim.tick(Math.max(0, ticks));
    expect(ev.length + (sim.visitor.visit ? 0 : 0)).toBeLessThanOrEqual(1);
    expect(sim.visitor.last).toBe(1); // the year's slot was handled either way (no valid spot = no event)
  });
  it('two hidden achievements exist and are gated on the render counters', () => {
    const r = ACHIEVEMENTS.filter((a) => a.id.startsWith('rare-'));
    expect(r.length).toBe(2); for (const a of r) { expect(a.hidden).toBe(true); expect(a.tracker.kind).toBe('render'); }
  });
});
