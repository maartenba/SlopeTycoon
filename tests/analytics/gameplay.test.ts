import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameBus, GameEvents } from '../../src/core/events';
import { appStartParams, attachGameplayAnalytics, onceTracker, profitBucket, startHeartbeat, viewportClass } from '../../src/analytics/gameplay';
import { sanitizeEvent } from '../../src/analytics/events';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { stateHash } from '../../src/game/saveState';

const rec = () => { const got: Array<[string, Record<string, unknown>]> = []; return { got, track: (n: string, p: Record<string, unknown> = {}) => { got.push([n, p]); return true; } }; };

describe('gameplay analytics subscriber', () => {
  it('maps bus events to whitelisted analytics events', () => {
    const bus: GameBus = new EventBus<GameEvents>(); const r = rec();
    attachGameplayAnalytics(bus, r, { stars: () => 3.5 });
    bus.emit('milestone', { id: 'level:3', title: 'Level 3: Whatever', major: true });
    bus.emit('milestone', { id: 'goal:first-lift', title: 'secret title', major: false });
    bus.emit('milestone', { id: 'chapter:one', title: 'x', major: true });
    bus.emit('scenario:finished', { id: 'sc-a', result: 'won', medal: 'gold', score: 1234, reason: 'free text' });
    bus.emit('finance:monthClosed', { year: 1, month: 0, net: 30_000, income: 1, expense: 1 });
    bus.emit('finance:monthClosed', { year: 1, month: 1, net: 40_000, income: 1, expense: 1 });
    bus.emit('year:report', { year: 1 });
    expect(r.got).toEqual([
      ['level_up', { level: 3 }], ['goal_done', { id: 'first-lift' }],
      ['scenario_result', { id: 'sc-a', result: 'won', medal: 'gold' }],
      ['year_end', { year: 1, stars: 3, profit: 'medium' }],
    ]);
    for (const [n, p] of r.got) expect(sanitizeEvent(n, p), n).not.toBeNull();
    expect(JSON.stringify(r.got)).not.toMatch(/secret|free text|1234/);
  });
  it('unsubscribe detaches', () => {
    const bus: GameBus = new EventBus<GameEvents>(); const r = rec();
    attachGameplayAnalytics(bus, r)(); bus.emit('milestone', { id: 'level:2', title: '', major: true });
    expect(r.got).toEqual([]);
  });
  it('helpers: buckets, once-per-session, app_start params', () => {
    expect([-1, 0, 49_999, 50_000, 500_000].map(profitBucket)).toEqual(['loss', 'small', 'small', 'medium', 'large']);
    const r = rec(); const once = onceTracker(r);
    expect(once('view_mode_used', { mode: 'ride' })).toBe(true); expect(once('view_mode_used', { mode: 'ride' })).toBe(false); expect(once('view_mode_used', { mode: 'walk' })).toBe(true);
    expect([500, 800, 1400].map(viewportClass)).toEqual(['phone', 'tablet', 'desktop']);
    const p = appStartParams({ version: '0.2.2', page: 'menu', standalone: true, touch: false, width: 1280 });
    expect(p).toEqual({ version: '0.2.2', page: 'menu', display: 'standalone', touch: 'no', viewport: 'desktop' });
    expect(sanitizeEvent('app_start', p)!.params).toEqual(p);
  });
  it('heartbeat: one engaged event per 5 visible minutes, none while hidden', () => {
    const r = rec(); let fn = (): void => {}; let vis = true; let cleared = false;
    const stop = startHeartbeat(r, { visible: () => vis, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => { cleared = true; } });
    for (let i = 0; i < 5; i++) fn(); vis = false; for (let i = 0; i < 20; i++) fn(); vis = true; for (let i = 0; i < 5; i++) fn();
    expect(r.got.map((g) => g[1])).toEqual([{ minutes: 5 }, { minutes: 10 }]);
    stop(); expect(cleared).toBe(true);
  });
  it('determinism: stateHash is identical with the analytics subscriber attached', () => {
    const run = (attach: boolean) => {
      const sim = createSim({ size: 64, seed: 5, starterResort: true, now: () => 0 });
      if (attach) attachGameplayAnalytics(sim.bus, rec(), { stars: () => sim.rating.stars });
      runBot(sim, new Bot(sim), 60);
      return stateHash(sim).hash;
    };
    expect(run(true)).toBe(run(false));
  }, 120_000);
});
