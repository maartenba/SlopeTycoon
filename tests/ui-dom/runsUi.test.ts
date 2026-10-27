// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { PisteInspectorInfo } from '../../src/ui/components/StPisteInspector';
import type { RunRow } from '../../src/ui/components/StOperations';

registerComponents();
const root = (e: HTMLElement): ShadowRoot | HTMLElement => (e.shadowRoot ?? e);

describe('run controls', () => {
  it('inspector shows traffic and toggles closed / grooming order', () => {
    const e = el('st-piste-inspector');
    const calls: string[] = [];
    e.bind({ rename: () => {}, highlight: () => {}, setClosed: (c) => calls.push(`closed:${c}`), setGroom: (m) => calls.push(`groom:${m}`) });
    document.body.append(e);
    const i: PisteInspectorInfo = { id: 1, name: 'Black Run 1', autoName: 'Black Run 1', difficultyLabel: 'Black', difficultyColor: '#222222', lengthM: 500, dropM: 200, openLengthM: 500, open: true, avgQuality: 'Icy', skiersToday: 3, warnings: [], highlighted: false, passesToday: 7, passesWeek: 40, groomedDaysAgo: 2, closedByPlayer: false, groomMode: 'auto', avgSlopePct: 40, maxSlopePct: 60 };
    e.show(i);
    const r = root(e);
    expect(r.textContent).toContain('7 passes today');
    expect(r.textContent).toContain('groomed 2 d ago');
    (r.querySelector('.run-toggle') as HTMLButtonElement).click();
    (r.querySelector('.run-groom') as HTMLButtonElement).click();
    expect(calls).toEqual(['closed:true', 'groom:first']);
  });
  it('operations Runs tab lists runs, focuses, toggles', () => {
    const e = el('st-operations');
    const calls: string[] = [];
    const row = (id: number, o: Partial<RunRow> = {}): RunRow => ({ id, name: `Blue Run ${id}`, difficultyLabel: 'Blue', difficultyColor: '#3b82f6', lengthM: 300, dropM: 50, passesToday: 4, passesWeek: 20, quality: 'Groomed', open: true, closedByPlayer: false, groomMode: 'auto', groomedDaysAgo: 0, ...o });
    e.bind({
      rows: () => [], setMode: () => {}, setHours: () => {}, setEco: () => {}, setSeason: () => {}, keepOnly: () => {}, projected: () => 0,
      runs: { rows: () => [row(1), row(2, { open: false, closedByPlayer: true })], setClosed: (id, c) => calls.push(`closed:${id}:${c}`), setGroom: (id, m) => calls.push(`groom:${id}:${m}`), focus: (id) => calls.push(`focus:${id}`) },
    });
    document.body.append(e);
    const r = root(e);
    (r.querySelector('button[data-tab="runs"]') as HTMLButtonElement).click();
    expect(r.querySelectorAll('tr[data-run]').length).toBe(2);
    (r.querySelector('button[data-focus="2"]') as HTMLButtonElement).click();
    (r.querySelector('button[data-toggle="1"]') as HTMLButtonElement).click();
    (r.querySelector('button[data-toggle="2"]') as HTMLButtonElement).click();
    (r.querySelector('button[data-groom="1"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['focus:2', 'closed:1:true', 'closed:2:false', 'groom:1:first']);
  });
});
