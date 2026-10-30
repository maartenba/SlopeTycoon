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
    expect(r.querySelectorAll('.card').length).toBe(11);
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

describe('st-marketing campaigns v2', () => {
  it('renders the four early campaigns; unmet prerequisites get Show me; Come by Train shows the rail line', () => {
    const date = { year: 0, day: 250 };
    const m = new Marketing({
      economy: new Economy({ money: 50000 }), date: () => date, trackRail: true,
      ctx: { season: () => 'winter', stars: () => 3, has: () => false, met: (id) => id !== 'stuntPark' && id !== 'bookedFestival', dayPassRatio: () => 1, rail: () => ({ available: true, load: 12, capacity: 150 }) },
    });
    const p = el('st-marketing'); document.body.append(p);
    const showMe = vi.fn();
    p.bind({ view: () => buildMarketingView(m, 50000), start: (id) => m.start(id), showMe });
    const r = root(p);
    for (const n of ['Come by Train', 'Snowboard Park Jam', 'Hike & Bike Weekends', 'Festival Season']) expect(r.textContent).toContain(n);
    const jam = [...r.querySelectorAll('.card')].find((c) => /Snowboard Park Jam/.test(c.textContent ?? ''))!;
    expect(jam.textContent).toMatch(/✗ A Stunt Park/);
    const btn = [...jam.querySelectorAll('button.show')][0] as HTMLButtonElement;
    btn.click();
    expect(showMe).toHaveBeenCalledWith(expect.objectContaining({ id: 'stuntPark', build: 'stuntPark' }));
    const fest = [...r.querySelectorAll('.card')].find((c) => /Festival Season/.test(c.textContent ?? ''))!;
    (fest.querySelector('button.show') as HTMLButtonElement).click();
    expect(showMe).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'bookedFestival', show: 'events' }));
    expect(m.start('train')).toBeNull();
    p.refresh();
    expect(r.textContent).toMatch(/By train: — of arrivals \(station 12\/150\)/);
  });
});

describe('st-marketing summer campaigns (Task 51)', () => {
  it('renders Family Summer Camp and Angler\'s Paradise with Show me for the unmet building requirements', () => {
    const date = { year: 0, day: 250 };
    const m = new Marketing({
      economy: new Economy({ money: 50000 }), date: () => date,
      ctx: { season: () => 'summer', stars: () => 3, has: () => false, met: (id) => id !== 'campground' && id !== 'tackleHut' && id !== 'water', dayPassRatio: () => 1, fishStock: () => 0.9 },
    });
    const p = el('st-marketing'); document.body.append(p);
    const showMe = vi.fn();
    p.bind({ view: () => buildMarketingView(m, 50000), start: (id) => m.start(id), showMe });
    const r = root(p);
    const camp = [...r.querySelectorAll('.card')].find((c) => /Family Summer Camp/.test(c.textContent ?? ''))!, ang = [...r.querySelectorAll('.card')].find((c) => /Angler's Paradise/.test(c.textContent ?? ''))!;
    expect(camp.textContent).toMatch(/✗ A Campground/);
    expect(camp.textContent).toMatch(/✓ A kids area/);
    expect(camp.textContent).not.toMatch(/Ski School/);
    expect(ang.textContent).toMatch(/✗ A Tackle & Bait Hut/);
    (camp.querySelector('button.show') as HTMLButtonElement).click();
    expect(showMe).toHaveBeenCalledWith(expect.objectContaining({ id: 'campground', build: 'campground' }));
    (ang.querySelector('button.show') as HTMLButtonElement).click();
    expect(showMe).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'tackleHut', build: 'tackleHut' }));
    expect((camp.querySelector('button:not(.show)') as HTMLButtonElement).disabled).toBe(true);
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

describe('slider steppers (pricing)', () => {
  const mkApi = (pricing: Pricing) => ({ pricing, set: vi.fn((k: string, v: number) => pricing.set(k, v)), setFree: vi.fn(), reset: vi.fn(), resetAll: vi.fn(), preset: vi.fn(), setSchedule: vi.fn(), setPowder: vi.fn() });
  it('puts [-] [slider] [+] on one row, in that order, with aria labels', () => {
    const p = el('st-pricing'); document.body.append(p); p.bind(mkApi(new Pricing()));
    const step = root(p).querySelector('.row .step')!;
    expect([...step.children].map((c) => c.tagName + ((c as HTMLInputElement).type ?? ''))).toEqual(['BUTTON' + 'submit', 'INPUT' + 'range', 'BUTTON' + 'submit']);
    expect(step.children[0]!.textContent).toBe('−'); expect(step.children[2]!.textContent).toBe('+');
    expect(step.children[0]!.getAttribute('aria-label')).toMatch(/^Lower /);
    expect(step.children[2]!.getAttribute('aria-label')).toMatch(/^Raise /);
    expect(step.parentElement!.classList.contains('row')).toBe(true); // slider and steppers share the grid cell
  });
  it('steppers change the value by one step', () => {
    const pr = new Pricing(), api = mkApi(pr);
    const p = el('st-pricing'); document.body.append(p); p.bind(api);
    const before = pr.get('dayPass');
    (root(p).querySelectorAll('.row .step button')[1] as HTMLButtonElement).click();
    expect(api.set).toHaveBeenLastCalledWith('dayPass', before + 1);
    (root(p).querySelectorAll('.row .step button')[0] as HTMLButtonElement).click();
    expect(api.set).toHaveBeenLastCalledWith('dayPass', before);
  });
  it('buttons are 28px, growing with --touch-min; the slider never wraps below them', () => {
    const p = el('st-pricing'); document.body.append(p); p.bind(mkApi(new Pricing()));
    const css = (p as unknown as { css(): string }).css();
    expect(css).toMatch(/\.row \.step\{[^}]*flex-wrap:nowrap/);
    expect(css).toMatch(/width:max\(28px,var\(--touch-min,0px\)\)/);
    expect(css).toMatch(/height:max\(28px,var\(--touch-min,0px\)\)/);
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
