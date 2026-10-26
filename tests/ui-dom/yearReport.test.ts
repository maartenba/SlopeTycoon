// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { modalStack } from '../../src/ui/modal';
import { computeYearReport } from '../../src/sim/meta/YearReport';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';
import type { FinanceApi } from '../../src/ui/components/StFinance';
import { Economy } from '../../src/sim/Economy';

registerComponents();
const h = new StatsHistory(null); fillDemoStats(h, 3);
const y2 = computeYearReport({ hist: h, year: 2, mapSize: 128, name: 'Your resort' });
const y3 = { ...computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'Your resort', prev: y2 }), cover: 'data:image/jpeg;base64,AAAA' };
const q = (e: HTMLElement, sel: string): HTMLElement[] => Array.from(e.shadowRoot!.querySelectorAll<HTMLElement>(sel));

describe('st-year-report', () => {
  it('createElement adds no attributes or children; connect / disconnect / reconnect are safe', () => {
    const e = document.createElement('st-year-report');
    expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
    expect(() => { document.body.append(e); e.remove(); }).not.toThrow();
  });

  it('closed: the layer is not displayed and the host has no size (no full-screen pointer-events)', () => {
    const e = el('st-year-report'); document.body.append(e);
    expect(e.isOpen).toBe(false);
    expect(q(e, '.layer.open').length).toBe(0);
    const root = e.shadowRoot!;
    const sheets = (root as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const css = [...sheets.flatMap((sh) => Array.from(sh.cssRules).map((r) => r.cssText)), ...Array.from(root.querySelectorAll('style')).map((x) => x.textContent ?? '')].join('\n').replace(/\s+/g, '');
    expect(css).toMatch(/:host\{position:absolute;left:0(px)?;top:0(px)?;width:0(px)?;height:0(px)?;?\}/);
    expect(css).toMatch(/\.layer\{display:none;/);
    e.remove();
  });

  it('shows the cover headline, four tiles with delta chips, one award card per award, three charts and highlights in a lg dialog', () => {
    const e = el('st-year-report'); document.body.append(e);
    e.show(y3);
    expect(e.isOpen).toBe(true); expect(modalStack.dialogs).toBe(1);
    expect(q(e, '.dlg.lg').length).toBe(1);
    expect(q(e, '.cover h3')[0]!.textContent).toBe(y3.headline.title);
    expect((q(e, '.cover')[0] as HTMLElement).style.backgroundImage).toContain('data:image/jpeg');
    expect(q(e, '.tile').map((t) => t.dataset.tile)).toEqual(['guests', 'income', 'profit', 'rating']);
    expect(q(e, '.tile .chip').length).toBe(4);
    expect(q(e, '.aw').length).toBe(y3.awards.length);
    expect(q(e, '.aw svg').length).toBe(y3.awards.length);
    expect(q(e, '.chart svg').length).toBe(3);
    expect(q(e, 'ul.hl li').length).toBeGreaterThan(5);
    expect(q(e, 'h2')[0]!.textContent).toBe(`Year ${y3.year} report`);
    e.close(); e.remove();
  });

  it('footer has exactly Remind me later / Save image / Continue and no sharing controls; Continue vs Esc/later report the close reason', () => {
    const e = el('st-year-report'); document.body.append(e);
    const saved: number[] = [];
    e.bind({ saveImage: (r) => { saved.push(r.year); } });
    const labels = (): string[] => q(e, 'footer button').map((b) => b.textContent!);
    const how: string[] = [];
    e.show(y3, (x) => how.push(x));
    expect(labels()).toEqual(['Remind me later', 'Save image', 'Continue']);
    expect(/share|copy link|code/i.test(labels().join(' '))).toBe(false);
    expect(e.clickAction('save')).toBe(true); expect(saved).toEqual([3]); expect(e.isOpen).toBe(true);
    e.clickAction('continue'); expect(e.isOpen).toBe(false);
    e.show(y3, (x) => how.push(x)); e.clickAction('later');
    e.show(y3, (x) => how.push(x)); expect(modalStack.closeTop()).toBe(true); // Esc
    expect(how).toEqual(['continue', 'later', 'later']);
    expect(modalStack.dialogs).toBe(0);
    e.remove();
  });

  it('Tab stays inside the dialog (focus trap through the shared modal system)', () => {
    const e = el('st-year-report'); document.body.append(e);
    e.show(y3);
    const trap = modalStack.top!.trap!;
    expect(trap.containsFocus()).toBe(true);
    for (let i = 0; i < 6; i++) { trap.cycle(false); expect(trap.containsFocus()).toBe(true); }
    e.close(); e.remove();
  });

  it('a partial first year shows a plain note; a cover-less report falls back to the gradient', () => {
    const e = el('st-year-report'); document.body.append(e);
    e.show({ ...y2, partial: true, days: 60, cover: undefined });
    expect(q(e, '.partial').length).toBe(1); expect(q(e, '.cover .mtn').length).toBe(1);
    e.close(); e.remove();
  });
});

describe('Finance drawer: Reports tab', () => {
  it('lists reports newest first with covers, marks unseen ones, and opens by year', () => {
    const f = el('st-finance'); document.body.append(f);
    const opened: number[] = [];
    f.bind({ economy: new Economy({ money: 0 }), debt: () => 0, reports: {
      list: () => [{ year: 2, headline: y2.headline.title, profit: y2.totals.profit, guests: y2.totals.guests, rating: y2.totals.ratingEnd, isNew: false }, { year: 3, headline: y3.headline.title, profit: y3.totals.profit, guests: y3.totals.guests, rating: y3.totals.ratingEnd, cover: y3.cover, isNew: true }],
      open: (y) => opened.push(y),
    } } satisfies FinanceApi);
    const tab = q(f, 'button[data-tab="reports"]')[0]!;
    expect(tab.textContent).toContain('\u2022'); // unseen report marker
    tab.click();
    const rows = q(f, 'button.rep');
    expect(rows.map((r) => r.dataset.year)).toEqual(['3', '2']);
    expect((rows[0]!.querySelector('.th') as HTMLElement).style.backgroundImage).toContain('data:image/jpeg');
    rows[0]!.click(); expect(opened).toEqual([3]);
    f.remove();
  });
  it('without the reports api there is no tab', () => {
    const f = el('st-finance'); document.body.append(f);
    f.bind({ economy: new Economy({ money: 0 }), debt: () => 0 });
    expect(q(f, 'button[data-tab="reports"]').length).toBe(0);
    f.remove();
  });
});
