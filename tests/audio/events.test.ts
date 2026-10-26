import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { GAME_EVENT_NAMES, type GameEvents } from '../../src/core/events';
import { ALL_EVENTS_COVERED, IGNORED_EVENTS, MAPPED_EVENTS, cueForNews, soundsForEvent } from '../../src/audio/eventSounds';
import { SFX_NAMES } from '../../src/audio/Sfx';
import { createAudio, isButtonEvent } from '../../src/audio';
import { FakeBackend, MemStorage } from './fakeBackend';
import { Grid } from '../../src/world/Grid';

describe('event -> sound mapping', () => {
  it('covers every GameEvent: mapped or explicitly ignored, never both', () => {
    expect(ALL_EVENTS_COVERED).toBe(true);
    for (const n of GAME_EVENT_NAMES) expect(MAPPED_EVENTS.includes(n) !== (IGNORED_EVENTS as readonly string[]).includes(n), n).toBe(true);
    for (const n of MAPPED_EVENTS) expect(GAME_EVENT_NAMES as readonly string[]).toContain(n);
  });
  it('key mappings', () => {
    const f = soundsForEvent;
    expect(f('building:placed', { id: 1, type: 'x', x: 0, y: 0 })[0]!.sfx).toBe('thud');
    expect(f('building:removed', { id: 1, type: 'x' })[0]!.sfx).toBe('crunch');
    expect(f('path:drawn', { kind: 'path', tiles: 3, erase: false })[0]!.sfx).toBe('tick');
    expect(f('piste:painted', { layer: 'ski', tiles: 3, erase: true })[0]!.sfx).toBe('scrape');
    expect(f('lift:opened', { id: 1, open: true }).map((c) => c.sfx)).toEqual(['clank', 'bell']);
    expect(f('lift:broken', { id: 1, kind: 'x', stranded: 2 }).map((c) => c.sfx)).toEqual(['grind', 'alarm']);
    expect(f('rating:changed', { stars: 3, previous: 2, reason: '' })[0]!.sfx).toBe('ratingUp');
    expect(f('rating:changed', { stars: 2, previous: 3, reason: '' })[0]!.sfx).toBe('ratingDown');
    expect(f('rating:changed', { stars: 2, previous: 2, reason: '' })).toEqual([]);
    expect(f('money:changed', { money: 1, delta: 50 })).toEqual([]); // ka-ching is tied to FX popups
    expect(f('money:changed', { money: 1, delta: -50 })).toEqual([]);
    expect(f('money:changed', { money: 1, delta: 5000, category: 'loan' })).toEqual([]);
    expect(f('incident:avalanche', { x: 0, y: 0, severity: 1 })[0]!.sfx).toBe('avalanche');
    expect(f('incident:created', { id: 1, kind: 'injury', severity: 0, x: 0, y: 0, guestId: 1 })).toEqual([]);
    expect(f('incident:created', { id: 1, kind: 'injury', severity: 2, x: 0, y: 0, guestId: 1 })[0]!.sfx).toBe('chimeCritical');
    expect(f('incident:escalated', { id: 1, to: 'heli' })[0]!.sfx).toBe('rescue');
    expect(f('finance:debtWarning', { money: -1, negDays: 1, level: 1 })[0]!.sfx).toBe('chimeImportant');
    expect(f('finance:declaredBankrupt', { money: -1, day: 1, reason: 'declared' })[0]!.sfx).toBe('bankruptcy');
    expect(f('season:changed', { season: 'winter', previous: 'autumn' })[0]!.sfx).toBe('season');
    expect(f('speed:changed', { speed: 2, previous: 1 })[0]!.sfx).toBe('blip');
    expect(f('guest:arrived', { id: 1 })).toEqual([]);
    for (const n of MAPPED_EVENTS) void n;
  });
  it('every cue names a real recipe; news: only critical/important chime', () => {
    const samples: Array<[keyof GameEvents, unknown]> = [['building:placed', { id: 1, type: 'x', x: 0, y: 0 }], ['lift:broken', { id: 1, kind: 'k', stranded: 0 }], ['finance:bankruptcyWarning', { money: 0, daysLeft: 1 }], ['loan:taken', { amount: 1, total: 1, rate: 1, termMonths: 1 }]];
    for (const [n, p] of samples) for (const c of soundsForEvent(n, p as never)) expect(SFX_NAMES).toContain(c.sfx);
    expect(cueForNews({ tier: 'critical' })!.sfx).toBe('chimeCritical');
    expect(cueForNews({ tier: 'important' })!.sfx).toBe('chimeImportant');
    expect(cueForNews({ tier: 'info' })).toBeNull();
    expect(cueForNews({ tier: 'trivial' })).toBeNull();
  });
});

describe('createAudio wiring (headless)', () => {
  const mk = (factory: () => FakeBackend | null) => {
    const bus = new EventBus<GameEvents>();
    const grid = new Grid(64);
    const api = createAudio({
      bus, storage: new MemStorage(), factory, rng: () => 0.5,
      camera: () => ({ x: 32, z: 32, yaw: 0, zoom: 30 }),
      probe: { grid, maxHeight: 20, heightAt: () => 5, guests: { count: () => 40 }, lifts: () => [{ x: 30, y: 30 }], buildings: () => [{ x: 31, y: 31 }], cows: () => [], cats: () => [], helis: () => [], env: () => ({ season: 'summer', weather: 'clear', hour: 7, wind: 0.2 }) },
    });
    return { bus, api };
  };
  it('bus events play sounds once unlocked; ignored before', async () => {
    const fb = new FakeBackend();
    const { bus, api } = mk(() => fb);
    bus.emit('building:placed', { id: 1, type: 'x', x: 1, y: 1 });
    expect(api.sfx.played.thud).toBeUndefined();
    await api.engine.onGesture();
    bus.emit('building:placed', { id: 1, type: 'x', x: 1, y: 1 });
    expect(api.sfx.played.thud).toBe(1);
    bus.emit('lift:broken', { id: 1, kind: 'x', stranded: 0 });
    expect(api.sfx.played.grind).toBe(1);
    api.news({ tier: 'info' });
    api.news({ tier: 'critical' });
    expect(api.sfx.played.chimeCritical).toBe(1);
    api.dispose();
  });
  it('frame() is throttled to ~10 Hz and builds ambience layers only when running', async () => {
    const fb = new FakeBackend();
    const { api } = mk(() => fb);
    api.frame(0.2); expect(api.ambience.layerCount).toBe(0);
    await api.engine.onGesture();
    api.frame(0.02); expect(api.ambience.mix).toBeNull(); // below the 0.1 s throttle
    api.frame(0.1);
    expect(api.ambience.layerCount).toBeGreaterThan(5);
    expect(api.ambience.mix!.crowd).toBeGreaterThan(0);
    api.dispose();
  });
  it('unavailable AudioContext: everything is a silent no-op', async () => {
    const { bus, api } = mk(() => null);
    await api.engine.onGesture();
    expect(api.engine.state).toBe('unsupported');
    expect(() => { bus.emit('building:placed', { id: 1, type: 'x', x: 0, y: 0 }); api.frame(1); api.news({ tier: 'critical' }); api.dispose(); }).not.toThrow();
  });
  it('isButtonEvent recognises buttons in the composed path only', () => {
    const btn = { tagName: 'BUTTON', disabled: false }, ui = { tagName: 'DIV', id: 'ui' }, canvas = { tagName: 'CANVAS' };
    expect(isButtonEvent({ composedPath: () => [btn, ui] } as unknown as Event)).toBe(true);
    expect(isButtonEvent({ composedPath: () => [canvas, ui, btn] } as unknown as Event)).toBe(false);
    expect(isButtonEvent({ composedPath: () => [{ tagName: 'BUTTON', disabled: true }] } as unknown as Event)).toBe(false);
  });
});
