// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { PisteInspectorInfo } from '../../src/ui/components/StPisteInspector';
import type { RunRow } from '../../src/ui/components/StOperations';

registerComponents();
const root = (e: HTMLElement): ShadowRoot | HTMLElement => (e.shadowRoot ?? e);
const base: PisteInspectorInfo = { id: 1, name: 'Black Run 1', autoName: 'Black Run 1', difficultyLabel: 'Black', difficultyColor: '#222222', lengthM: 500, dropM: 200, openLengthM: 500, open: true, avgQuality: 'Groomed', skiersToday: 3, warnings: [], highlighted: false, closedByPlayer: false, groomMode: 'auto' };

describe('race course controls', () => {
  it('inspector: a button (44 px, data-role) toggles the course; the reason shows inline and the button is disabled while it cannot be marked', () => {
    const e = el('st-piste-inspector'); const calls: boolean[] = [];
    e.bind({ rename: () => {}, highlight: () => {}, setClosed: () => {}, setCourse: (on) => calls.push(on) });
    document.body.append(e);
    e.show({ ...base, course: { on: false, can: false, text: 'Needs a Start Hut at the top' } });
    let r = root(e);
    expect(r.textContent).toContain('Needs a Start Hut at the top');
    const b = r.querySelector('button[data-role="run-course"]') as HTMLButtonElement;
    expect(b.disabled).toBe(true); expect(b.style.minHeight).toBe('44px');
    e.show({ ...base, course: { on: false, can: true, text: 'Can be a race course' } });
    r = root(e);
    (r.querySelector('button[data-role="run-course"]') as HTMLButtonElement).click();
    e.show({ ...base, course: { on: true, can: true, text: 'Race course · 4 racers today · best 1:02.3' } });
    r = root(e);
    expect(r.textContent).toContain('best 1:02.3');
    (r.querySelector('button[data-role="run-course"]') as HTMLButtonElement).click();
    expect(calls).toEqual([true, false]);
  });
  it('runs tab: a Course column with a flag toggle per run', () => {
    const e = el('st-operations'); const calls: string[] = [];
    const row = (id: number, o: Partial<RunRow> = {}): RunRow => ({ id, name: `Run ${id}`, difficultyLabel: 'Red', difficultyColor: '#d33', lengthM: 300, dropM: 80, passesToday: 4, passesWeek: 20, quality: 'Groomed', open: true, closedByPlayer: false, groomMode: 'auto', groomedDaysAgo: 0, ...o });
    e.bind({
      rows: () => [], setMode: () => {}, setHours: () => {}, setEco: () => {}, setSeason: () => {}, keepOnly: () => {}, projected: () => 0,
      runs: { rows: () => [row(1, { course: { on: true, can: true, text: 'Race course' } }), row(2, { course: { on: false, can: false, text: 'Needs a red or black run' } })], setClosed: () => {}, setGroom: () => {}, setCourse: (id: number, on: boolean) => calls.push(`${id}:${on}`), focus: () => {} },
    } as never);
    document.body.append(e);
    const r = root(e);
    (r.querySelector('button[data-tab="runs"]') as HTMLButtonElement).click();
    const b1 = r.querySelector('button[data-course="1"]') as HTMLButtonElement, b2 = r.querySelector('button[data-course="2"]') as HTMLButtonElement;
    expect(b1.textContent).toContain('Course'); expect(b2.disabled).toBe(true); expect(b2.title).toBe('Needs a red or black run');
    b1.click(); expect(calls).toEqual(['1:false']);
  });
});
