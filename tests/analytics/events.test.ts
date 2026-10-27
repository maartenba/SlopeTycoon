import { describe, expect, it } from 'vitest';
import { EVENT_NAMES, EVENT_SPECS, sanitizeEvent } from '../../src/analytics/events';

describe('analytics event whitelist + sanitiser', () => {
  it('unknown events are rejected (incl. prototype names)', () => {
    for (const n of ['nope', 'toString', '__proto__', 'constructor', '']) expect(sanitizeEvent(n, {})).toBeNull();
  });
  it('drops unknown params and free text, keeps whitelisted ones', () => {
    const r = sanitizeEvent('goal_done', { id: 'First-Lift', name: 'Ann Smith', email: 'a@b.c' })!;
    expect(r.params).toEqual({ id: 'first-lift' });
    expect(sanitizeEvent('goal_done', { id: 'my resort name' })).toBeNull(); // spaces = free text, required id invalid
    expect(sanitizeEvent('goal_done', { id: 'x'.repeat(41) })).toBeNull();
    expect(sanitizeEvent('goal_done', { id: '<script>' })).toBeNull();
    expect(sanitizeEvent('goal_done', {})).toBeNull();
  });
  it('enums and numbers are validated and clamped', () => {
    expect(sanitizeEvent('scenario_result', { id: 'a', result: 'won', medal: 'gold' })!.params).toEqual({ id: 'a', result: 'won', medal: 'gold' });
    expect(sanitizeEvent('scenario_result', { id: 'a', result: 'maybe' })).toBeNull();
    expect(sanitizeEvent('scenario_result', { id: 'a', result: 'lost', medal: 'platinum' })!.params).toEqual({ id: 'a', result: 'lost' });
    expect(sanitizeEvent('level_up', { level: 3.6 })!.params).toEqual({ level: 4 });
    expect(sanitizeEvent('level_up', { level: 9999 })!.params).toEqual({ level: 50 });
    expect(sanitizeEvent('level_up', { level: NaN })).toBeNull();
    expect(sanitizeEvent('level_up', { level: '3' })).toBeNull();
  });
  it('no event can carry a seed, name, coordinates, money or any free-form key', () => {
    const keys = new Set(EVENT_NAMES.flatMap((n) => Object.keys(EVENT_SPECS[n])));
    for (const bad of ['seed', 'name', 'text', 'message', 'stack', 'x', 'y', 'money', 'save', 'guest', 'email']) expect(keys.has(bad), bad).toBe(false);
    for (const n of EVENT_NAMES) for (const s of Object.values(EVENT_SPECS[n]) as Array<{ t: string }>) expect(['enum', 'id', 'num']).toContain(s.t);
  });
});
