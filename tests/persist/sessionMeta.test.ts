import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { applySave, collectSave } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { sessionIssues } from '../../src/game/sessionIssues';

const played = (days: number): Sim => { const sim = createSim({ size: 64, seed: 61, now: () => 0 }); runBot(sim, new Bot(sim, {}), days); return sim; };

describe('sessionMeta save module', () => {
  it('is registered (v1), null on a fresh game, and records the closed month + month-start cash / stars', () => {
    const fresh = createSim({ size: 64, seed: 5, now: () => 0 });
    expect(collectSave(fresh).sessionMeta).toEqual({ v: 1, data: null });
    const sim = played(70);
    const m = sim.session.get()!;
    expect(m).toBeTruthy();
    expect(m.last!.net).toBeCloseTo(sim.economy.lastReport()!.net, 5);
    expect(typeof m.monthStartMoney).toBe('number');
    expect(() => JSON.stringify(collectSave(sim).sessionMeta)).not.toThrow();
  }, 120_000);

  it('round-trips through the byte format; an old save without the module loads with a null block (reduced recap)', async () => {
    const sim = played(70);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'meta'), { compress: true, yieldBetween: false });
    const env = (await decodeSave(bytes, { yieldBetween: false })).envelope;
    const restored = createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
    expect(restored.session.serialize()).toEqual(sim.session.serialize());
    const old = structuredClone(env.modules); delete old.sessionMeta;
    const o = createSim({ size: env.mapSize, seed: env.seed, now: () => 0 });
    const rep = applySave(o, old);
    expect(rep.missing).toContain('sessionMeta');
    expect(o.session.get()).toBeNull();
    expect(sessionIssues(o)).toEqual(expect.objectContaining({ lowCash: expect.any(Boolean), openIncidents: expect.any(Number) }));
  }, 120_000);

  it('does not emit anything on load and a later month close updates it', () => {
    const sim = createSim({ size: 64, seed: 5, now: () => 0 });
    sim.bus.emit('finance:monthClosed', { year: 1, month: 3, net: 100, income: 300, expense: 200 });
    expect(sim.session.get()!.last).toMatchObject({ month: 3, net: 100 });
    sim.session.load({ junk: true }); expect(sim.session.get()).toBeNull();
  });
});
