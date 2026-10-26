// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { PISTE_NAME_MAX, type PisteInspectorInfo } from '../../src/ui/components/StPisteInspector';
import { formatSeasonProgress } from '../../src/ui/format';

registerComponents();

const info = (o: Partial<PisteInspectorInfo> = {}): PisteInspectorInfo => ({
  id: 1, name: 'Blue Run 1', autoName: 'Blue Run 1', difficultyLabel: 'Blue', difficultyColor: '#3b82f6',
  lengthM: 640, dropM: 120, openLengthM: 400, open: true, avgQuality: 'Groomed', skiersToday: 12, warnings: [], highlighted: false, ...o,
});
const root = (e: HTMLElement): ShadowRoot | HTMLElement => (e.shadowRoot ?? e);

describe('st-piste-inspector', () => {
  it('createElement adds no attributes/children; hidden until shown', () => {
    const e = document.createElement('st-piste-inspector');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
  });

  it('renders stats + warnings and commits renames (Enter, clamp, empty = auto)', () => {
    const e = el('st-piste-inspector');
    const renames: string[] = [], hl: boolean[] = [];
    e.bind({ rename: (n) => renames.push(n), highlight: (on) => hl.push(on) });
    document.body.append(e);
    e.show(info({ open: false, warnings: ['Not connected to a lift: guests cannot reach it'] }));
    const r = root(e);
    expect(r.textContent).toContain('640 m');
    expect(r.textContent).toContain('drop 120 m');
    expect(r.textContent).toContain('Closed');
    expect(r.textContent).toContain('Not connected to a lift');
    const input = r.querySelector('input[type=text]') as HTMLInputElement;
    expect(input.maxLength).toBe(PISTE_NAME_MAX);
    input.value = '  Eagle   Run  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(renames).toEqual(['Eagle Run']);
    input.dispatchEvent(new Event('change')); // no duplicate commit
    expect(renames).toEqual(['Eagle Run']);
    input.value = 'x'.repeat(40);
    input.dispatchEvent(new Event('change'));
    expect(renames[1]!.length).toBe(PISTE_NAME_MAX);
    input.value = '   ';
    input.dispatchEvent(new Event('change'));
    expect(renames[2]).toBe('');
    const cb = r.querySelector('input[type=checkbox]') as HTMLInputElement;
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    expect(hl).toEqual([true]);
    e.show(null);
    e.remove();
  });
});

describe('season progress text', () => {
  it('formats', () => {
    expect(formatSeasonProgress({ season: 'Winter', day: 23, length: 120, next: 'Spring', daysLeft: 98 })).toBe('Winter · day 23/120 · next: Spring in 98 days');
    expect(formatSeasonProgress({ season: 'Winter', day: 120, length: 120, next: 'Spring', daysLeft: 1 })).toContain('in 1 day');
  });
});

describe('lift rename + start season', () => {
  it('lift inspector name input commits via api.rename', () => {
    const e = el('st-lift-inspector');
    const calls: Array<[number, string]> = [];
    e.bind({ setOpen: () => {}, setSpeed: () => {}, demolish: () => {}, rename: (id, n) => calls.push([id, n]) });
    document.body.append(e);
    e.show({ id: 4, kind: 'chair4', name: 'Chairlift 1', open: true, speed: 1, lengthM: 500, rideTimeS: 120, throughputPerHour: 900, upkeepPerDay: 10, refund: 100 });
    const input = root(e).querySelector('input[type=text]') as HTMLInputElement;
    input.value = 'Sunrise Express';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(calls).toEqual([[4, 'Sunrise Express']]);
    e.remove();
  });
  it('top bar new map passes the chosen start season', () => {
    const e = el('st-topbar');
    const got: unknown[][] = [];
    e.bind({ rotate: () => {}, help: () => {}, newMap: (...a) => got.push(a), initial: { size: 64, seed: 1 } });
    document.body.append(e);
    const sel = [...root(e).querySelectorAll('st-select')].find((s) => (s as unknown as { options: Array<{ value: string }> }).options.some((o) => o.value === 'summer')) as unknown as { value: string };
    sel.value = 'summer';
    const btn = [...root(e).querySelectorAll('button')].find((b) => b.textContent === 'New map') as HTMLButtonElement;
    btn.click();
    expect(got[0]![2]).toBe('summer');
    e.remove();
  });
});
