// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { modalStack } from '../../src/ui/modal';
import { SCENARIOS } from '../../src/config/scenarios';
import { mountMainMenu } from '../../src/ui/menuHost';
import { ProfileStore, emptyRecord } from '../../src/persist/ProfileStore';
import type { ScenarioResult, ScenarioView } from '../../src/sim/scenario/ScenarioRunner';
import { sortObjectives } from '../../src/ui/scenarioFormat';
import { PANELS } from '../../src/ui/layout';

registerComponents();
const q = (e: HTMLElement, sel: string): HTMLElement[] => Array.from(e.shadowRoot!.querySelectorAll<HTMLElement>(sel));
afterEach(() => { modalStack.clear(); localStorage.clear(); document.body.replaceChildren(); });

const obj = (id: string, over: Partial<ScenarioView['objectives'][number]> = {}): ScenarioView['objectives'][number] => ({ id, title: `Objective ${id}`, description: '', progress: 0.4, met: false, failed: false, mandatory: true, weight: 10, value: 4, target: 10, op: '>=', valueText: '4', targetText: '10', unit: 'count', ...over });
const view = (over: Partial<ScenarioView> = {}): ScenarioView => ({
  id: 'first-tracks', name: 'First Tracks', sandbox: false, finished: null, ready: false, medalNow: 'none', elapsed: 41, total: 180, daysLeft: 139, timeLabel: 'Year 1, Month 3 \u00B7 139 days left', score: 40,
  objectives: [obj('a', { met: true, progress: 1 }), obj('b'), obj('c', { mandatory: false }), obj('d', { failed: true })], ...over,
});

describe('st-scenarios (picker)', () => {
  it('constructor adds no attributes / children; closed = no open layer, a 0x0 host', () => {
    const e = document.createElement('st-scenarios');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove(); document.body.append(e); e.remove();
    const x = el('st-scenarios'); document.body.append(x);
    expect(q(x, '.layer.open').length).toBe(0);
    const sheets = (x.shadowRoot as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const css = [...sheets.flatMap((sh) => Array.from(sh.cssRules).map((r) => r.cssText)), ...Array.from(x.shadowRoot!.querySelectorAll('style')).map((s) => s.textContent ?? '')].join('\n').replace(/\s+/g, '');
    expect(css).toMatch(/:host\{display:block;width:0(px)?;height:0(px)?;?\}/); expect(css).toMatch(/\.layer\{display:none;/);
  });

  it('shows one card per scenario with name, tagline, difficulty stars, map size, season, objectives, best medal and a Play button; nothing is locked', () => {
    const e = el('st-scenarios'); document.body.append(e);
    const played: string[] = [];
    const rec = { ...emptyRecord(), bestMedal: 'gold' as const, bestScore: 190, bestDays: 77, attempts: 3, wins: 2 };
    e.bind({ list: () => SCENARIOS, record: (id) => (id === 'family-valley' ? rec : emptyRecord()), play: (id) => played.push(id) });
    e.open();
    expect(e.isOpen).toBe(true); expect(modalStack.dialogs).toBe(1);
    const cards = q(e, '.card'); expect(cards.length).toBe(6);
    for (const [i, s] of SCENARIOS.entries()) {
      const c = cards[i]!; expect(c.dataset.scenario).toBe(s.id);
      expect(c.textContent).toContain(s.name); expect(c.textContent).toContain(s.tagline); expect(c.textContent).toContain(`Map ${s.mapSize}`);
      expect(c.querySelector('.diff')?.getAttribute('aria-label')).toBe(`Difficulty ${s.stars} of 5`);
      expect(c.querySelectorAll('ul.obj li').length).toBeGreaterThanOrEqual(1);
      expect(c.querySelector('svg'), 'medal icon').toBeTruthy();
      const play = c.querySelector<HTMLButtonElement>('button.play')!; expect(play.disabled).toBe(false);
    }
    expect(cards[0]!.textContent).toMatch(/Winter start/); expect(cards[3]!.textContent).toMatch(/Summer start/);
    const fv = q(e, '[data-scenario="family-valley"]')[0]!;
    expect(fv.querySelector<HTMLElement>('.medal')!.dataset.medal).toBe('gold'); expect(fv.textContent).toContain('Best: Gold \u00B7 190 pts \u00B7 77 days'); expect(fv.querySelector('button.play')!.textContent).toBe('Play again');
    expect(q(e, '[data-scenario="first-tracks"] .best')[0]!.textContent).toBe('Not played yet');
    expect(e.play('powder-dreams')).toBe(true); expect(played).toEqual(['powder-dreams']);
    e.close(); expect(e.isOpen).toBe(false); expect(modalStack.dialogs).toBe(0);
  });

  it('has no import / export / share controls', () => {
    const e = el('st-scenarios'); document.body.append(e);
    e.bind({ list: () => SCENARIOS, record: () => emptyRecord(), play: () => {} }); e.open();
    const text = (e.shadowRoot!.textContent ?? '') + q(e, 'button').map((b) => b.title + b.textContent).join(' ');
    expect(/\b(import|export|share|upload|download|copy link|code)\b/i.test(text)).toBe(false);
    expect(q(e, 'input[type=file]').length).toBe(0);
  });

  it('re-renders when the profile changes while open', async () => {
    const store = new ProfileStore(new IDBFactory(), { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const e = el('st-scenarios'); document.body.append(e);
    e.bind({ list: () => SCENARIOS, record: (id) => store.record(id), play: () => {}, onChange: (fn) => store.subscribe(fn) }); e.open();
    expect(q(e, '[data-scenario="first-tracks"] .medal')[0]!.dataset.medal).toBe('none');
    await store.recordResult('first-tracks', { result: 'won', medal: 'silver', score: 150, days: 70 });
    expect(q(e, '[data-scenario="first-tracks"] .medal')[0]!.dataset.medal).toBe('silver');
  });
});

describe('main menu + new game entries', () => {
  it('the main menu has a Scenarios button that opens the picker; the New Game dialog has a Scenarios tab that hands over to it; picking starts ?scenario=<id>', () => {
    const ui = document.createElement('div'); document.body.append(ui);
    const go = vi.fn();
    const store = new ProfileStore(new IDBFactory(), { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const h = mountMainMenu({ ui, saves: null, go, version: '0.1.0', profile: store, random: () => 0.5 });
    const btn = [...h.menu.shadowRoot!.querySelectorAll('button')].find((b) => b.dataset.action === 'scenarios')!;
    expect(btn).toBeTruthy(); expect(btn.textContent).toContain('Scenarios');
    btn.click(); expect(h.scenarios.isOpen).toBe(true);
    h.scenarios.play('safe-slopes'); expect(go).toHaveBeenCalledWith('scenario=safe-slopes');
    h.scenarios.close();
    h.newGame.open();
    const tab = [...h.newGame.shadowRoot!.querySelectorAll<HTMLElement>('.tab')].find((t) => t.dataset.tab === 'scenarios')!;
    expect(tab.textContent).toBe('Scenarios'); expect(h.newGame.shadowRoot!.querySelector<HTMLElement>('.tab.active')!.dataset.tab).toBe('custom');
    tab.click(); expect(h.newGame.isOpen).toBe(false); expect(h.scenarios.isOpen).toBe(true);
    h.dispose();
    expect(ui.children.length).toBe(0);
  });
});

describe('st-scenario-card', () => {
  it('constructor adds no attributes / children', () => {
    const e = document.createElement('st-scenario-card'); expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove(); document.body.append(e); e.remove();
  });

  it('title, deadline countdown in the game calendar, objectives sorted (unmet required first) with progress bars; no full-screen host', () => {
    const bus = new EventBus<GameEvents>();
    const c = el('st-scenario-card'); document.body.append(c);
    let v = view();
    c.bind(bus, { view: () => v, finish: () => {} });
    expect(c.hidden).toBe(false);
    expect(q(c, '.t')[0]!.textContent).toBe('First Tracks'); expect(q(c, '.sub')[0]!.textContent).toBe('Year 1, Month 3 \u00B7 139 days left');
    expect(q(c, '.n')[0]!.textContent).toBe('1/4');
    expect(q(c, '[data-objective]').map((r) => r.dataset.objective)).toEqual(['b', 'c', 'd', 'a']);
    const bar = q(c, '[data-objective="b"] [role=progressbar]')[0]!; expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(q(c, '[data-objective="a"]')[0]!.className).toContain('met'); expect(q(c, '[data-objective="d"]')[0]!.className).toContain('failed');
    expect(q(c, '[data-objective="c"]')[0]!.className).toContain('opt');
    expect(q(c, 'button[data-action=finish]').length).toBe(0);
    const sheets = (c.shadowRoot as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const css = [...sheets.flatMap((sh) => Array.from(sh.cssRules).map((r) => r.cssText)), ...Array.from(c.shadowRoot!.querySelectorAll('style')).map((s) => s.textContent ?? '')].join('\n').replace(/\s+/g, '');
    expect(css).toMatch(/:host\{display:block;box-sizing:border-box;width:100%;max-width:260px;?\}/); // a normal block in the right column, not a fixed overlay
    // updates on the calendar events
    v = view({ timeLabel: 'Year 1, Month 4 \u00B7 120 days left', daysLeft: 120 }); bus.emit('day:changed', { year: 1, day: 60 });
    expect(q(c, '.sub')[0]!.textContent).toBe('Year 1, Month 4 \u00B7 120 days left');
  });

  it("'Finish now' appears once every required objective is met and calls finish(); a finished scenario shows the result line and a Results button; sandbox hides the card", () => {
    const bus = new EventBus<GameEvents>();
    const c = el('st-scenario-card'); document.body.append(c);
    const finish = vi.fn(), results = vi.fn();
    let v = view({ ready: true, medalNow: 'silver' });
    c.bind(bus, { view: () => v, finish, results });
    const b = q(c, 'button[data-action=finish]')[0] as HTMLButtonElement; expect(b.textContent).toBe('Finish now (Silver)'); b.click(); expect(finish).toHaveBeenCalledTimes(1);
    v = view({ finished: { result: 'won', medal: 'gold', score: 180, days: 100, reason: 'x', objectives: [] } }); bus.emit('scenario:finished', { id: 'first-tracks', result: 'won', medal: 'gold', score: 180, reason: 'x' });
    expect(q(c, '.sub')[0]!.textContent).toBe('Won \u00B7 Gold \u00B7 180 pts');
    (q(c, 'button[data-action=results]')[0] as HTMLButtonElement).click(); expect(results).toHaveBeenCalled();
    v = view({ sandbox: true }); bus.emit('day:changed', { year: 1, day: 61 }); expect(c.hidden).toBe(true);
  });

  it('collapses (remembered) and hides the list', () => {
    const bus = new EventBus<GameEvents>();
    const c = el('st-scenario-card'); document.body.append(c);
    c.bind(bus, { view: () => view(), finish: () => {} });
    (q(c, 'button.head')[0] as HTMLButtonElement).click();
    expect(q(c, '.list')[0]!.hidden).toBe(true); expect(localStorage.getItem('slopetycoon.scenarioCollapsed')).toBe('1');
    const c2 = el('st-scenario-card'); document.body.append(c2); c2.bind(bus, { view: () => view(), finish: () => {} });
    expect(q(c2, '.list')[0]!.hidden).toBe(true);
  });

  it('sortObjectives: unmet required, unmet bonus, failed, then met; stable', () => {
    expect(sortObjectives(view().objectives).map((o) => o.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('st-scenario-result', () => {
  const res = (over: Partial<ScenarioResult> = {}): ScenarioResult => ({ result: 'won', medal: 'silver', score: 142, days: 90, reason: 'Finished early.', objectives: [obj('a', { met: true, weight: 40 }), obj('b', { mandatory: false, failed: true }), obj('c', { progress: 0.2 })], ...over });

  it('constructor rules, closed = nothing open', () => {
    const e = document.createElement('st-scenario-result'); expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    const x = el('st-scenario-result'); document.body.append(x); expect(x.isOpen).toBe(false); expect(q(x, '.layer.open').length).toBe(0);
  });

  it('win: medal, score, breakdown, previous best, and Continue (sandbox) / Retry / Back to menu', () => {
    const e = el('st-scenario-result'); document.body.append(e);
    const acts = { continueSandbox: vi.fn(), retry: vi.fn(), menu: vi.fn() };
    e.bind(acts);
    e.show('First Tracks', res(), { ...emptyRecord(), bestMedal: 'bronze', bestScore: 100, bestDays: 120, attempts: 2, wins: 1 });
    expect(e.isOpen).toBe(true); expect(modalStack.dialogs).toBe(1);
    expect(q(e, 'h2')[0]!.textContent).toBe('First Tracks: complete'); expect(q(e, '.hero h3')[0]!.textContent).toBe('Silver medal');
    expect(q(e, '.m')[0]!.dataset.medal).toBe('silver'); expect(q(e, '.m svg').length).toBe(1);
    expect(q(e, '.score .v').map((x) => x.textContent)).toEqual(['142', '90']);
    expect(q(e, '[data-best]')[0]!.textContent).toBe('Previous best: Bronze \u00B7 100 pts \u00B7 120 days \u2014 new best score!');
    expect(q(e, 'ul.rows li').map((l) => l.className)).toEqual(['ok', 'no', 'pend']); expect(q(e, 'li[data-objective=b] .opt').length).toBe(1);
    const labels = q(e, 'footer button').map((b) => b.textContent);
    expect(labels).toEqual(['Back to menu', 'Retry', 'Continue playing (sandbox mode)']);
    expect(e.clickAction('continue')).toBe(true); expect(acts.continueSandbox).toHaveBeenCalled(); expect(e.isOpen).toBe(false);
    e.show('First Tracks', res()); e.clickAction('retry'); expect(acts.retry).toHaveBeenCalled();
    e.show('First Tracks', res()); e.clickAction('menu'); expect(acts.menu).toHaveBeenCalled();
  });

  it('lose: no Continue button, Retry is primary, no medal, the reason is shown; Esc dismisses without choosing', () => {
    const e = el('st-scenario-result'); document.body.append(e);
    const acts = { continueSandbox: vi.fn(), retry: vi.fn(), menu: vi.fn() };
    e.bind(acts);
    e.show('Safe Slopes', res({ result: 'lost', medal: 'none', reason: 'Time is up.' }));
    expect(q(e, 'h2')[0]!.textContent).toBe('Safe Slopes: failed'); expect(q(e, '.hero')[0]!.className).toContain('lost'); expect(q(e, '.hero p')[0]!.textContent).toBe('Time is up.');
    expect(q(e, 'footer button').map((b) => b.textContent)).toEqual(['Back to menu', 'Retry']);
    expect(q(e, 'footer button.primary')[0]!.textContent).toBe('Retry');
    expect(q(e, '[data-best]')[0]!.textContent).toBe('No win recorded yet.');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(e.isOpen).toBe(false); expect(acts.retry).not.toHaveBeenCalled(); expect(acts.menu).not.toHaveBeenCalled();
  });

  it('has no share / export controls', () => {
    const e = el('st-scenario-result'); document.body.append(e); e.bind({ continueSandbox() {}, retry() {}, menu() {} }); e.show('X', res());
    const text = q(e, 'button').map((b) => b.title + b.textContent).join(' ');
    expect(/\b(share|export|copy|upload|download|link)\b/i.test(text)).toBe(false);
  });
});

describe('anchor registry', () => {
  it('the scenario card shares the goal card zone (it replaces it) but is never always-visible; the dialogs are modal zones', () => {
    expect(PANELS.find((p) => p.tag === 'st-scenario-card')).toMatchObject({ zone: 'right-goals', alwaysVisible: false });
    expect(PANELS.find((p) => p.tag === 'st-scenarios')!.zone).toBe('modal'); expect(PANELS.find((p) => p.tag === 'st-scenario-result')!.zone).toBe('modal');
  });
});
