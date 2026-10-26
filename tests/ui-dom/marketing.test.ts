// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { Marketing } from '../../src/sim/Marketing';
import { Economy } from '../../src/sim/Economy';
import { Pricing } from '../../src/sim/Pricing';
import { buildMarketingView } from '../../src/ui/marketingFormat';
import { priceRows, gaugePercent, demandPercent, todayLine, scheduleCells } from '../../src/ui/pricingFormat';

registerComponents();
const root = (e: Element): ShadowRoot => (e as unknown as { root: ShadowRoot }).root;

const mk = (money = 50000): { m: Marketing; date: { year: number; day: number } } => {
  const date = { year: 0, day: 250 };
  const m = new Marketing({ economy: new Economy({ money }), date: () => date, ctx: { season: () => 'winter', stars: () => 3, has: (f) => f !== 'kids', met: (id) => id !== 'skiSchool' && id !== 'kidsArea', dayPassRatio: () => 1 } });
  return { m, date };
};

describe('st-marketing', () => {
  it('renders campaign cards with warnings, starts a campaign and shows it running', () => {
    const { m } = mk();
    const p = el('st-marketing'); document.body.append(p);
    const start = vi.fn((id: string) => m.start(id));
    p.bind({ view: () => buildMarketingView(m, 50000), start });
    const r = root(p);
    expect(r.querySelectorAll('.card').length).toBe(5);
    expect(r.textContent).toMatch(/Families/);
    expect(r.textContent).toMatch(/✗ Ski School HQ/); // hard prerequisite missing -> listed with a cross
    expect(r.textContent).toMatch(/✓ An open lift/);
    const fam = [...r.querySelectorAll('.card')].find((c) => /Families/.test(c.textContent ?? ''))!;
    const famBtn = fam.querySelector('button')!;
    expect(famBtn.disabled).toBe(true); expect(famBtn.textContent).toBe('Requirements missing');
    expect(fam.querySelector('.dim')).not.toBeNull(); // ROI preview greyed
    famBtn.click(); expect(start).not.toHaveBeenCalled();
    const btn = [...r.querySelectorAll('button')].find((b) => /Start campaign/.test(b.textContent ?? ''))!;
    btn.click();
    expect(start).toHaveBeenCalled();
    expect(r.textContent).toMatch(/Running \(1\/2\)/);
    expect(r.querySelectorAll('.bar > i').length).toBe(1);
  });
  it('disables unaffordable campaigns and lists history', () => {
    const { m, date } = mk(3000);
    const p = el('st-marketing'); document.body.append(p);
    p.bind({ view: () => buildMarketingView(m, 3000), start: (id) => m.start(id) });
    expect([...root(p).querySelectorAll('button')].some((b) => /Not enough cash/.test(b.textContent ?? '') && b.disabled)).toBe(true);
    m.start('brand'); date.day += 12; m.update();
    p.refresh();
    expect(root(p).textContent).toMatch(/Brand awareness: \$2,?500/);
  });
});

describe('st-pricing', () => {
  it('shows tabs, rows with gauge and writes prices through the api', () => {
    const pricing = new Pricing();
    const api = { pricing, set: vi.fn((k: string, v: number) => pricing.set(k, v)), setFree: vi.fn((k: string, on: boolean) => pricing.setFree(k, on)), reset: vi.fn((k: string) => pricing.reset(k)), resetAll: vi.fn(() => pricing.resetAll()), preset: vi.fn(), setSchedule: vi.fn((a: 'winter' | 'shoulder' | 'summer', b: 'peak' | 'regular' | 'off', m: number) => pricing.setSchedule(a, b, m)), setPowder: vi.fn((on: boolean) => { pricing.powderSurcharge = on; }) };
    const p = el('st-pricing'); document.body.append(p);
    p.bind(api);
    const r = root(p);
    expect(r.querySelectorAll('.row').length).toBe(2); // day pass + season pass
    expect(r.querySelectorAll('.gauge').length).toBe(2);
    expect(r.textContent).toMatch(/Fair/);
    const plus = [...r.querySelectorAll('button')].find((b) => b.textContent === '+')!;
    plus.click();
    expect(api.set).toHaveBeenCalledWith('dayPass', 46);
    [...r.querySelectorAll('button')].find((b) => /Premium/.test(b.textContent ?? ''))!.click();
    expect(api.preset).toHaveBeenCalledWith(1.25);
    [...r.querySelectorAll('button')].find((b) => /Seasonal/.test(b.textContent ?? ''))!.click();
    expect(r.querySelectorAll('table input[type=number]').length).toBe(9);
    const box = r.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(api.setPowder).toHaveBeenCalledWith(true);
    [...r.querySelectorAll('button')].find((b) => /Lodging/.test(b.textContent ?? ''))!.click();
    expect(r.querySelectorAll('.row').length).toBe(3);
  });
});

describe('format helpers', () => {
  it('rows, gauge, demand and schedule', () => {
    const p = new Pricing();
    const rows = priceRows(p, 'lifts');
    expect(rows.map((x) => x.key)).toEqual(['dayPass', 'seasonPass']);
    expect(rows[0]!.verdict).toBe('fair');
    expect(gaugePercent(0.2)).toBe(0); expect(gaugePercent(5)).toBe(100);
    expect(demandPercent(1)).toBe(100); expect(demandPercent(2)).toBeLessThan(60);
    expect(priceRows(p, 'food').some((x) => x.percent)).toBe(true);
    expect(scheduleCells(p)).toHaveLength(9);
    expect(todayLine(p)).toMatch(/Today/);
  });
});

describe('st-marketing highlight', () => {
  it('outlines the advised campaign card and clears it', () => {
    const { m } = mk();
    const p = el('st-marketing'); document.body.append(p);
    p.bind({ view: () => buildMarketingView(m, 50000), start: (id) => m.start(id) });
    const id = m.list()[1]!.id;
    (p as unknown as { highlight(i: string | null): void }).highlight(id);
    const hl = root(p).querySelectorAll('.card.hl');
    expect(hl.length).toBe(1);
    expect((hl[0] as HTMLElement).dataset.id).toBe(id);
    (p as unknown as { highlight(i: string | null): void }).highlight(null);
    expect(root(p).querySelectorAll('.card.hl').length).toBe(0);
  });
});
