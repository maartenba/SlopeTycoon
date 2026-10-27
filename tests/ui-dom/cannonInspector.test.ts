// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { CannonInfo } from '../../src/sim/ops/Snowmaking';

registerComponents();
const info = (o: Partial<CannonInfo> = {}): CannonInfo => ({ status: 'running', headline: 'Running', tiles: 111, pisteTiles: 59, gainCm: 14.8, waterLast: 410, reservoirs: 1, level: 7585, capacity: 20000, radius: 10, offPisteRadius: 5, switchedOff: false, mode: 'on', ...o });

describe('snowmaking cannon inspector', () => {
  it('shows state, covered tiles, last night gain + water and the reservoir level', () => {
    const e = el('st-inspector'); document.body.append(e);
    e.show({ id: 1, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info() } } as never);
    const t = (e as unknown as { root: ShadowRoot }).root.textContent ?? '';
    expect(t).toContain('Running'); expect(t).toContain('Covers 111 tiles (59 piste)'); expect(t).toContain('+14.8 cm'); expect(t).toContain('410 water'); expect(t).toContain('7585 / 20000 (38%)');
  });
  it('explains why it is idle', () => {
    const e = el('st-inspector'); document.body.append(e);
    e.show({ id: 1, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info({ status: 'warm', headline: 'Idle: too warm (needs ≤ -2 °C at 1,450 m; 0 °C at half rate; now 3.0 °C)' }) } } as never);
    expect((e as unknown as { root: ShadowRoot }).root.querySelector('[data-role=cannon-status]')?.textContent).toMatch(/too warm.*1,450 m/);
    e.show({ id: 1, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info({ status: 'noReservoir', headline: 'Not connected to a reservoir: build one within 24 tiles' }) } } as never);
    expect((e as unknown as { root: ShadowRoot }).root.querySelector('[data-role=cannon-status]')?.textContent).toMatch(/Not connected to a reservoir/);
  });
  it('a reservoir lists the cannons it feeds', () => {
    const e = el('st-inspector'); document.body.append(e);
    e.show({ id: 2, type: 'reservoir', active: true, refund: 100, ops: { kind: 'reservoir', level: 100, capacity: 20000, cannons: 6 } } as never);
    expect((e as unknown as { root: ShadowRoot }).root.textContent).toContain('Feeds 6 cannons');
  });
  it('per-cannon switch: button wording follows the state, click reports the new state, and it is locked while the global mode is Off', () => {
    const e = el('st-inspector'); document.body.append(e);
    const calls: Array<[number, boolean]> = [];
    (e as unknown as { bindCannon(f: (id: number, on: boolean) => void): void }).bindCannon((id, on) => calls.push([id, on]));
    const root = (e as unknown as { root: ShadowRoot }).root;
    e.show({ id: 5, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info() } } as never);
    const b = root.querySelector('[data-role=cannon-toggle]') as HTMLButtonElement;
    expect(b.textContent).toBe('Turn this cannon off'); b.click(); expect(calls).toEqual([[5, false]]);
    e.show({ id: 5, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info({ status: 'off', headline: 'Off by you: mothballed', switchedOff: true }) } } as never);
    const b2 = root.querySelector('[data-role=cannon-toggle]') as HTMLButtonElement;
    expect(b2.textContent).toBe('Turn this cannon on'); b2.click(); expect(calls[1]).toEqual([5, true]);
    e.show({ id: 5, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info({ status: 'off', headline: 'Off', mode: 'off' }) } } as never);
    expect((root.querySelector('[data-role=cannon-toggle]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows the Auto pause reason', () => {
    const e = el('st-inspector'); document.body.append(e);
    e.show({ id: 1, type: 'snowCannon', active: true, refund: 400, ops: { kind: 'cannon', info: info({ status: 'paused', headline: 'Paused: snowline above this piste (1,420 m)', mode: 'auto' }) } } as never);
    expect((e as unknown as { root: ShadowRoot }).root.querySelector('[data-role=cannon-status]')?.textContent).toBe('Paused: snowline above this piste (1,420 m)');
  });
});
