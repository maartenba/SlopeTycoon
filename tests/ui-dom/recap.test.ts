// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { MONTH_CARD_MS, RECAP_AUTO_MS } from '../../src/ui/components/StRecap';
import { formatMonthCard, formatRecap } from '../../src/ui/recap';

registerComponents();
const recap = formatRecap({ date: { year: 1, day: 40 }, season: 'winter', cash: 9000, stars: 3, monthStartMoney: 8000, monthStartStars: 2.5, last: null, goals: [{ title: 'A goal', progress: 0.4 }], advice: [{ title: 'Some advice' }], issues: { openIncidents: 1, closedLifts: 0, brokenLifts: 0, closedPistes: 0, lowCash: false } });
const month = (m = 2) => formatMonthCard({ year: 1, month: m, incomeTotal: 100, expenseTotal: 60, net: 40, guests: 12, income: { lifts: 100 } }, 0.5);
const mk = () => { const r = el('st-recap'); document.body.append(r); const calls: string[] = []; r.bind({ openFinance: () => calls.push('finance') }); return { r, calls }; };
const q = (r: HTMLElement, s: string): HTMLElement | null => r.shadowRoot!.querySelector(s);
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe('st-recap', () => {
  it('constructor adds no attributes or children; connect / reconnect are safe', () => {
    const e = document.createElement('st-recap');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
    expect(() => { document.body.append(e); e.remove(); }).not.toThrow();
  });

  it('nothing shown (and nothing blocking) until a card is requested', () => {
    const { r } = mk();
    expect(r.showing).toBe(false);
    expect(q(r, '.card')!.hidden).toBe(true);
  });

  it('recap: shows the summary; host and card are small, fixed and never full-screen; host has no pointer events, only the card', () => {
    const { r } = mk();
    expect(r.showRecap(recap)).toBe(true);
    const css = (r as unknown as { css(): string }).css();
    expect(css).toMatch(/:host\{[^}]*pointer-events:none/);
    expect(css).toMatch(/\.card\{pointer-events:auto/);
    expect(css).not.toMatch(/inset:\s*0|100vw|100vh|100%\s*;?\s*height/);
    expect(css).toMatch(/width:320px/);
    const text = q(r, '.card')!.textContent!;
    for (const s of ['Welcome back', '$9,000', 'A goal', 'Some advice', '1 incident is still open']) expect(text).toContain(s);
    expect(q(r, '.card')!.hidden).toBe(false);
  });

  it('one click on ✕ dismisses it: the card is hidden and emptied, so nothing can block the game', () => {
    const { r } = mk();
    r.showRecap(recap);
    (q(r, 'button.close') as HTMLButtonElement).click();
    expect(r.showing).toBe(false);
    expect(q(r, '.card')!.hidden).toBe(true);
    expect(q(r, '.card')!.childElementCount).toBe(0);
  });

  it('recap auto-dismisses after ~20 s; the month card after ~8 s', () => {
    vi.useFakeTimers();
    const { r } = mk();
    r.showRecap(recap);
    vi.advanceTimersByTime(RECAP_AUTO_MS - 100); expect(r.showing).toBe(true);
    vi.advanceTimersByTime(200); expect(r.showing).toBe(false);
    expect(r.showMonth(month(), 'm:1', 0)).toBe(true);
    vi.advanceTimersByTime(MONTH_CARD_MS - 100); expect(r.showing).toBe(true);
    vi.advanceTimersByTime(200); expect(r.showing).toBe(false);
  });

  it('never shown while suppressed (tutorial); suppressing drops a visible card', () => {
    const { r } = mk();
    r.suppress(true);
    expect(r.showRecap(recap)).toBe(false); expect(r.showMonth(month(), 'm:1')).toBe(false);
    expect(r.showing).toBe(false);
    r.suppress(false); r.showRecap(recap); r.suppress(true);
    expect(r.showing).toBe(false);
  });

  it('month card: obeys the limiter (one at a time, the same month never repeats), collapses, and Details opens Finance', () => {
    const { r, calls } = mk();
    expect(r.showMonth(month(2), 'm:1:2', 0)).toBe(true);
    expect(q(r, '.card')!.textContent).toContain('June closed');
    expect(r.showMonth(month(2), 'm:1:2', 10)).toBe(false); // duplicate key
    (q(r, 'button.collapse') as HTMLButtonElement).click();
    expect(q(r, '.card')!.classList.contains('collapsed')).toBe(true);
    expect(q(r, 'button.details')).toBeNull();
    (q(r, 'button.collapse') as HTMLButtonElement).click();
    expect(r.showMonth(month(3), 'm:1:3', 20)).toBe(true); // one at a time: the newer replaces the older
    expect(q(r, '.card')!.textContent).toContain('July closed');
    (q(r, 'button.details') as HTMLButtonElement).click();
    expect(calls).toEqual(['finance']); expect(r.showing).toBe(false);
  });

  it('a visible recap has priority over the month card', () => {
    const { r } = mk();
    r.showRecap(recap);
    expect(r.showMonth(month(), 'm:1:2', 0)).toBe(false);
    expect(r.currentMode).toBe('recap');
  });
});
