// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { el, registerComponents } from '../../src/ui';
import type { AttractionInfo } from '../../src/sim/attractions/Attraction';

registerComponents();
afterEach(() => { document.body.replaceChildren(); });
const info = (o: Partial<AttractionInfo> = {}): AttractionInfo => ({ id: 7, name: 'Schirmbar', open: true, served: 12, revenue: 70, balked: 0, reneged: 0, nights: 0, queue: 0, users: 2, capacity: 8, price: 6, maxPrice: 14, billing: 'perUse', unitPrice: 6, staff: 1, staffRequired: 1, upkeepPerDay: 5, schirmbar: { playerClosed: false, guestsToday: 9, incomeToday: 54, dailyCap: 60 }, ...o });

describe('Schirmbar card (M7.8)', () => {
  it('shows today, the weather rule, and a Closed switch that reports the new state', () => {
    const e = el('st-inspector'); document.body.append(e);
    const calls: Array<[number, boolean]> = [];
    (e as unknown as { bindAttraction(h: object): void }).bindAttraction({ setPrice() {}, adjustStaff() {}, setClosed: (id: number, c: boolean) => calls.push([id, c]) });
    e.show({ id: 7, type: 'schirmbar', active: true, refund: 750, attraction: info() } as never);
    const root = (e as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toContain('Today: 9 / 60 guests');
    expect(root.textContent).toMatch(/storms, heavy snow, rain, fog and high wind/);
    const box = root.querySelector('input[data-opt=schirmbarClosed]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(calls).toEqual([[7, true]]);
  });
  it('a closed bar says why on the card (the weather reason, or "Closed by you")', () => {
    const e = el('st-inspector'); document.body.append(e);
    e.show({ id: 7, type: 'schirmbar', active: true, refund: 750, attraction: info({ open: false, reason: 'Closed: storm' }) } as never);
    expect((e as unknown as { root: ShadowRoot }).root.textContent).toContain('Closed: storm');
    e.show({ id: 7, type: 'schirmbar', active: true, refund: 750, attraction: info({ open: false, reason: 'Closed by you', schirmbar: { playerClosed: true, guestsToday: 0, incomeToday: 0, dailyCap: 60 } }) } as never);
    const root = (e as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toContain('Closed by you');
    expect((root.querySelector('input[data-opt=schirmbarClosed]') as HTMLInputElement).checked).toBe(true);
  });
});

describe('Settings > Gameplay > Resort name', () => {
  it('shows the name, sanitises through the host on change, and is absent without the api', () => {
    const e = el('st-settings'); document.body.append(e);
    let name = 'Alpenglow';
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { resortName: { get: () => name, set: (v: string) => { name = v.replace(/[<>]/g, '').slice(0, 24) || 'Alpenglow'; return name; } } });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const inp = root.querySelector('[data-row="resort-name"] input') as HTMLInputElement;
    expect(inp.value).toBe('Alpenglow'); expect(inp.maxLength).toBe(24);
    inp.value = '<Edelweiss>'; inp.dispatchEvent(new Event('change'));
    expect(name).toBe('Edelweiss'); expect(inp.value).toBe('Edelweiss');
    const e2 = el('st-settings'); document.body.append(e2);
    e2.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { quality: { get: () => 'med', set: () => {}, options: ['low', 'med', 'high'] } });
    expect((e2 as unknown as { root: ShadowRoot }).root.querySelector('[data-row="resort-name"]')).toBeNull();
  });
});
