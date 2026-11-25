// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { PisteInspectorInfo } from '../../src/ui/components/StPisteInspector';
import type { RunRow } from '../../src/ui/components/StOperations';

registerComponents();
const root = (e: HTMLElement): ShadowRoot | HTMLElement => (e.shadowRoot ?? e);
const base: PisteInspectorInfo = { id: 1, name: 'Blue Run 1', autoName: 'Blue Run 1', difficultyLabel: 'Blue', difficultyColor: '#2255cc', lengthM: 300, dropM: 90, openLengthM: 300, open: true, avgQuality: 'Groomed', skiersToday: 3, warnings: [], highlighted: false, closedByPlayer: false, groomMode: 'auto' };

describe('snow park controls', () => {
  it('inspector: a 44 px button toggles the park; the reason shows inline and disables it; a shape bar shows while it is a park', () => {
    const e = el('st-piste-inspector'); const calls: boolean[] = [];
    e.bind({ rename: () => {}, highlight: () => {}, setClosed: () => {}, setPark: (on) => calls.push(on) });
    document.body.append(e);
    e.show({ ...base, park: { on: false, can: false, text: 'Needs a run of at least 100 m', shape: 0 } });
    let r = root(e);
    expect(r.textContent).toContain('Needs a run of at least 100 m');
    const b = r.querySelector('button[data-role="run-park"]') as HTMLButtonElement;
    expect(b.disabled).toBe(true); expect(b.style.minHeight).toBe('44px');
    e.show({ ...base, park: { on: false, can: true, text: 'Can be a snow park', shape: 0 } });
    (root(e).querySelector('button[data-role="run-park"]') as HTMLButtonElement).click();
    e.show({ ...base, park: { on: true, can: true, text: 'Snow park · 4 riders today · shape 80 %', shape: 0.8 } });
    r = root(e);
    expect(r.textContent).toContain('shape 80 %'); expect(r.querySelector('[data-role="run-park-shape"]')).not.toBeNull();
    (r.querySelector('button[data-role="run-park"]') as HTMLButtonElement).click();
    expect(calls).toEqual([true, false]);
  });
  it('runs tab: a Park column with a toggle per run', () => {
    const e = el('st-operations'); const calls: string[] = [];
    const row = (id: number, o: Partial<RunRow> = {}): RunRow => ({ id, name: `Run ${id}`, difficultyLabel: 'Blue', difficultyColor: '#23c', lengthM: 300, dropM: 80, passesToday: 4, passesWeek: 20, quality: 'Groomed', open: true, closedByPlayer: false, groomMode: 'auto', groomedDaysAgo: 0, ...o });
    e.bind({
      rows: () => [], setMode: () => {}, setHours: () => {}, setEco: () => {}, setSeason: () => {}, keepOnly: () => {}, projected: () => 0,
      runs: { rows: () => [row(1, { park: { on: true, can: true, text: 'Snow park', shape: 1 } }), row(2, { park: { on: false, can: false, text: 'Unlocks at level 3', shape: 0 } })], setClosed: () => {}, setGroom: () => {}, setPark: (id: number, on: boolean) => calls.push(`${id}:${on}`), focus: () => {} },
    } as never);
    document.body.append(e);
    const r = root(e);
    (r.querySelector('button[data-tab="runs"]') as HTMLButtonElement).click();
    const b1 = r.querySelector('button[data-park="1"]') as HTMLButtonElement, b2 = r.querySelector('button[data-park="2"]') as HTMLButtonElement;
    expect(b1.textContent).toContain('Park'); expect(b2.disabled).toBe(true); expect(b2.title).toBe('Unlocks at level 3');
    b1.click(); expect(calls).toEqual(['1:false']);
  });
});
