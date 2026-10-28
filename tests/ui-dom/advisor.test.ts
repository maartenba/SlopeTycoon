// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { ASSISTANT_CSS, type AdviceItem, type AdviceApi, type AssistantApi } from '../../src/ui/components/StAssistant';
import type { EngineView } from '../../src/tutorial/TutorialEngine';
import { ADVISOR_UI, RANGER_NAME } from '../../src/sim/advisor/strings';

registerComponents();
(window as unknown as { innerWidth: number }).innerWidth = 1280;

const items = (n: number): AdviceItem[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, severity: (['urgent', 'warn', 'info'] as const)[i % 3]!, title: `Advice ${i}`, why: `Why ${i}` }));
const tutView = (status: EngineView['status']): EngineView => ({ status, step: { id: 'a', title: 'T', text: 'x', index: 1, total: 3, expr: 'idle', canNext: false, canSkip: true, ack: false, doLabel: 'default', price: 0, canDo: true }, ui: null, map: null, note: null, message: null, minimised: false, goals: null, completedCount: 0 });
const mk = (): { a: ReturnType<typeof el<'st-assistant'>>; calls: string[] } => {
  const a = el('st-assistant'); document.body.append(a);
  const calls: string[] = [];
  const api: AdviceApi = { show: (id) => calls.push(`show:${id}`), dismiss: (id) => calls.push(`dismiss:${id}`) };
  a.bindAdvice(api);
  return { a, calls };
};
const q = (e: HTMLElement, sel: string): HTMLElement | null => e.shadowRoot!.querySelector(sel);
const qa = (e: HTMLElement, sel: string): HTMLElement[] => Array.from(e.shadowRoot!.querySelectorAll(sel));

describe('st-assistant advice mode', () => {
  it('createElement adds no attributes or children (constructor rules)', () => {
    const a = document.createElement('st-assistant');
    expect(a.attributes.length).toBe(0);
    expect(a.childNodes.length).toBe(0);
  });
  it('is hidden with no advice; the badge shows the count with an SVG icon; the card opens on click', () => {
    const { a } = mk();
    a.renderAdvice({ items: [], count: 0 });
    expect(a.adviceBadgeVisible).toBe(false);
    expect(a.visible).toBe(false);
    a.renderAdvice({ items: items(3), count: 5 });
    expect(a.adviceBadgeVisible).toBe(true);
    expect(a.visible).toBe(true);
    const badge = q(a, '.advbadge')!;
    expect(badge.textContent).toContain(`${ADVISOR_UI.badge} (5)`);
    expect(badge.querySelector('svg')).toBeTruthy();
    expect(a.adviceOpen).toBe(false);
    badge.click();
    expect(a.adviceOpen).toBe(true);
    expect(q(a, '.advice')!.textContent).toContain(RANGER_NAME);
    expect(qa(a, '.advice .it')).toHaveLength(3);
    badge.click();
    expect(a.adviceOpen).toBe(false);
  });
  it('Show me and Dismiss call the API with the advice id', () => {
    const { a, calls } = mk();
    a.renderAdvice({ items: items(2), count: 2 });
    a.toggleAdvice(true);
    const row = qa(a, '.advice .it')[1]!;
    const bs = Array.from(row.querySelectorAll('button'));
    bs.find((b) => b.textContent === ADVISOR_UI.show)!.click();
    bs.find((b) => b.textContent === ADVISOR_UI.dismiss)!.click();
    expect(calls).toEqual(['show:r1', 'dismiss:r1']);
  });
  it('empty state: Rudi adds a friendly line only here (a positive note)', () => {
    const { a } = mk();
    a.renderAdvice({ items: [], count: 0 });
    a.toggleAdvice(true);
    expect(q(a, '.advice')!.textContent).toContain(ADVISOR_UI.empty);
    expect(q(a, '.advice')!.textContent).toContain(`${RANGER_NAME}: ${ADVISOR_UI.emptyFriendly}`);
  });
  it('the card is 340 wide with a max-height (list scrolls); advice text is never clamped or ellipsised', () => {
    expect(ASSISTANT_CSS).toMatch(/\.advice\{[^}]*width:100%/);
    expect(ASSISTANT_CSS).toMatch(/\.advice\{[^}]*max-height:/);
    expect(ASSISTANT_CSS).not.toMatch(/\.advice\{[^}]*[^-]height:214px/);
    expect(ASSISTANT_CSS).toMatch(/\.wrap\{[^}]*width:340px/);
    expect(ASSISTANT_CSS).toMatch(/\.bubble\{height:214px\}/);
    expect(ASSISTANT_CSS).not.toMatch(/\.advice \.(why|tt)\{[^}]*(line-clamp|text-overflow)/);
  });
  it('long advice shows in full with Show / Dismiss in their own action group', () => {
    const { a } = mk();
    const long = 'You owe $20,710. Raise prices or open more lifts, and pause new construction until the books recover. The Tourism Board will not be amused by this at all.';
    a.renderAdvice({ items: [{ id: 'x', severity: 'warn', title: 'Debt', why: long }], count: 1 });
    a.toggleAdvice(true);
    expect(q(a, '.advice .why')!.textContent).toBe(long);
    expect(q(a, '.advice .ab')!.querySelectorAll('button').length).toBe(2);
  });
  it('the tutorial has priority: while it runs the badge and card are hidden; they return afterwards', () => {
    const { a } = mk();
    a.renderAdvice({ items: items(3), count: 3 });
    a.toggleAdvice(true);
    expect(a.adviceOpen).toBe(true);
    const api = { show() {}, doIt() {}, skip() {}, next() {}, minimise() {}, exit() {} } as AssistantApi;
    a.bind(api);
    a.render(tutView('active'));
    expect(a.adviceBadgeVisible).toBe(false);
    expect(a.adviceOpen).toBe(false);
    a.renderAdvice({ items: items(3), count: 3 });
    expect(a.adviceBadgeVisible).toBe(false);
    a.render(tutView('off'));
    expect(a.adviceBadgeVisible).toBe(true);
  });
  it('only small boxes accept clicks (badge and card); host stays click-through', () => {
    const { a } = mk();
    expect(a.style.pointerEvents).toBe('none');
    for (const sel of ['.advbadge', '.advice']) expect(ASSISTANT_CSS).toMatch(new RegExp(`\\${sel}\\{[^}]*pointer-events:auto`));
    expect(ASSISTANT_CSS).toMatch(/\.arow\{[^}]*pointer-events:none/);
  });
  it('urgent advice makes Rudi look worried; no advice makes him cheerful', () => {
    const { a } = mk();
    a.renderAdvice({ items: [{ id: 'x', severity: 'urgent', title: 'T', why: 'W' }], count: 1 });
    const worried = q(a, '.avatar')!.innerHTML;
    a.renderAdvice({ items: [], count: 0 });
    expect(q(a, '.avatar')!.innerHTML).not.toBe(worried);
  });
});
