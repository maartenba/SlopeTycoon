// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { dangerRose } from '../../src/ui/components/StRouteInspector';
import { routeInfo, OVERRIDE_CONFIRM, DANGER_COLORS } from '../../src/ui/backcountryFormat';
import type { BackcountryRoute } from '../../src/sim/ops/Backcountry';

registerComponents();
const route = (o: Partial<BackcountryRoute> = {}): BackcountryRoute => ({
  id: 5, name: 'Backcountry route 1', tiles: Array.from({ length: 20 }, (_, i) => i), top: 19, bottom: 0, danger: 3, score: 0.4, open: true, override: false, attached: true, covered: 0.8, snowy: true, ...o,
});

describe('route inspector', () => {
  it('shows the danger rose (5 wedges, current bright), the text "Considerable (3)", open state and the toggles', () => {
    const e = el('st-route-inspector');
    document.body.append(e);
    const calls: string[] = [];
    e.bind({ setOverride: (on) => calls.push(`o:${on}`), setGlobal: (on) => calls.push(`g:${on}`) });
    e.show(routeInfo(route(), false));
    const root = e.shadowRoot!;
    expect(root.querySelectorAll('svg path')).toHaveLength(5);
    expect(root.querySelector('[data-danger]')!.textContent).toBe('Avalanche danger: Considerable (3)');
    expect(root.querySelector('[data-status]')!.textContent).toBe('Open');
    expect(root.querySelector<SVGPathElement>('svg path[data-level="3"]')!.getAttribute('opacity')).toBe('1');
    expect(root.querySelector<SVGPathElement>('svg path[data-level="2"]')!.getAttribute('opacity')).toBe('0.28');
    (root.querySelector('input[data-role=override]') as HTMLInputElement).click();
    (root.querySelector('input[data-role=global]') as HTMLInputElement).click();
    expect(calls).toEqual(['o:true', 'g:true']);
    e.show(null);
    expect(root.querySelector('svg')).toBeNull();
  });

  it('closed state names the reason; the model warns outside patrol cover and when open at danger 4+', () => {
    const e = el('st-route-inspector'); document.body.append(e);
    e.show(routeInfo(route({ danger: 4, open: false, closedReason: 'Avalanche danger 4' }), false));
    expect(e.shadowRoot!.querySelector('[data-status]')!.textContent).toBe('Avalanche danger 4');
    expect(e.shadowRoot!.querySelector('[data-status]')!.className).toBe('closed');
    expect(routeInfo(route({ covered: 0.1 }), false).warnings.join()).toMatch(/Patrol/);
    expect(routeInfo(route({ danger: 5, open: true, override: true, covered: 1 }), false).warnings.join()).toMatch(/danger 5/);
    expect(routeInfo(route(), false).warnings).toEqual([]);
    expect(OVERRIDE_CONFIRM).toBe('Open at danger 4? Burials possible; patrol required.');
    expect(DANGER_COLORS).toHaveLength(6);
    expect(dangerRose(5).getAttribute('aria-label')).toBe('Avalanche danger 5 of 5');
  });
});
