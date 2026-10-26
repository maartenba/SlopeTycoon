import { describe, it, expect } from 'vitest';
import { routeMapClick } from '../../src/build/selectMode';
import { ToolManager } from '../../src/build/ToolManager';

describe('routeMapClick', () => {
  it('select mode only selects/deselects', () => {
    expect(routeMapClick('select', true, false)).toBe('select');
    expect(routeMapClick('select', false, true)).toBe('deselect');
    expect(routeMapClick('select', false, false)).toBe('none');
  });
  it('clicking a piste tile selects the piste (buildings win)', () => {
    expect(routeMapClick('select', false, false, true)).toBe('select-piste');
    expect(routeMapClick('select', true, false, true)).toBe('select');
    expect(routeMapClick('bulldoze', false, false, true)).toBe('bulldoze-miss');
  });
  it('bulldoze demolishes; other tools do nothing', () => {
    expect(routeMapClick('bulldoze', true, false)).toBe('bulldoze');
    expect(routeMapClick('bulldoze', false, false)).toBe('bulldoze-miss');
    for (const t of ['terraform', 'placement', 'lift', 'network']) expect(routeMapClick(t, true, true)).toBe('none');
  });
  it('a click in select mode never reaches the terraform tool (fake tools)', () => {
    const m = new ToolManager('select');
    let edits = 0, enabled = false;
    m.register({ id: 'select', enable: () => {}, disable: () => {} });
    m.register({ id: 'terraform', enable: () => { enabled = true; }, disable: () => { enabled = false; } });
    m.start();
    const click = (): void => { if (enabled) edits++; };
    click();
    expect(edits).toBe(0);
    m.activate('terraform'); click();
    expect(edits).toBe(1);
    m.reset(); click();
    expect(edits).toBe(1);
  });
});
