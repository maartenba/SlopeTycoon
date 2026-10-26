// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';

registerComponents();

describe('inspector Undo after demolish', () => {
  it('offerUndo shows an Undo button that runs; selecting something else clears it; null hides the panel', () => {
    const e = el('st-inspector');
    document.body.append(e);
    const root = (e as unknown as { root: ShadowRoot }).root;
    const panel = root.querySelector('.panel') as HTMLElement;
    let ran = 0;
    e.offerUndo('Demolished Café', () => { ran++; });
    expect(panel.style.display).toBe('flex');
    (root.querySelector('button[data-undo]') as HTMLButtonElement).click();
    expect(ran).toBe(1);
    e.show(null); // refreshUi runs show(null) all the time: must not drop the offer
    expect(panel.style.display).toBe('flex');
    e.offerUndo(null);
    expect(panel.style.display).toBe('none');
    e.offerUndo('Demolished Café', () => {});
    e.show({ id: 1, type: 'cafe', active: true, refund: 10 });
    expect(root.querySelector('button[data-undo]')).toBeNull();
    e.remove();
  });
});
