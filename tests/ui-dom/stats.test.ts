// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';
import { el, registerComponents } from '../../src/ui';
import type { StStats } from '../../src/ui/components/StStats';

registerComponents();
afterEach(() => { document.body.replaceChildren(); });

const mount = (h: StatsHistory): StStats => { const s = el('st-stats') as StStats; document.body.append(s); s.bind({ history: () => h }); return s; };

describe('st-stats', () => {
  it('constructor adds no attributes / children', () => {
    const e = document.createElement('st-stats'); expect(e.attributes.length).toBe(0); expect(e.childNodes.length).toBe(0);
  });
  it('empty history shows a friendly note and no charts', () => {
    const s = mount(new StatsHistory(null)); s.open();
    expect(s.shadowRoot!.querySelector('[data-empty]')).not.toBeNull(); expect(s.chartCount).toBe(0);
    s.close();
  });
  it('shows four labelled charts, range buttons, a numbers table and closes again', () => {
    const h = new StatsHistory(null); fillDemoStats(h, 3);
    const s = mount(h); s.open();
    const root = s.shadowRoot!;
    expect(s.chartCount).toBe(4);
    expect(Array.from(root.querySelectorAll('[data-chart]')).map((c) => (c as HTMLElement).dataset.chart)).toEqual(['guests', 'cash', 'rating', 'revenue']);
    for (const c of Array.from(root.querySelectorAll('canvas'))) expect(c.getAttribute('aria-label')).toBeTruthy();
    expect(root.querySelectorAll('[data-range]').length).toBe(4);
    expect(root.querySelector('details[data-table] table tbody')!.children.length).toBeGreaterThan(4);
    expect(root.textContent).toContain('Sustainability');
    (root.querySelector('[data-range="all"]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-range="all"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Monthly summaries');
    s.toggle(); expect(s.isOpen).toBe(false);
  });
});
