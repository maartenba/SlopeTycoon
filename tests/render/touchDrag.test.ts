// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { TouchController } from '../../src/render/TouchController';

/** M7.5: the controller tells the UI while a finger drags the map (phones fade the cards, docs/mobile-ui.md). */
const mk = (): { dom: HTMLElement; c: TouchController; log: boolean[]; pans: number[] } => {
  const dom = document.createElement('canvas'); document.body.append(dom);
  const log: boolean[] = [], pans: number[] = [];
  const camera = { active: true, panPixels: (dx: number) => pans.push(dx), zoomBy() {}, rotateBy() {}, rotateSnap() {} } as never;
  const c = new TouchController({ dom, camera, toolId: () => 'select', enabled: () => true, onDrag: (v) => log.push(v) });
  return { dom, c, log, pans };
};
const ev = (type: string, x: number, y: number, id = 1): PointerEvent => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true });
let ctl: TouchController | null = null;
afterEach(() => { ctl?.dispose(); ctl = null; document.body.replaceChildren(); });

describe('TouchController.onDrag', () => {
  it('true on the first pan, false when the last finger lifts; a plain tap never reports a drag', () => {
    const { dom, c, log, pans } = mk(); ctl = c;
    dom.dispatchEvent(ev('pointerdown', 100, 100)); dom.dispatchEvent(ev('pointerup', 100, 100));
    expect(log).toEqual([]);
    dom.dispatchEvent(ev('pointerdown', 100, 100, 2));
    for (let i = 1; i <= 8; i++) window.dispatchEvent(ev('pointermove', 100 + i * 12, 100, 2));
    expect(pans.length).toBeGreaterThan(0);
    expect(log).toEqual([true]);
    window.dispatchEvent(ev('pointerup', 200, 100, 2));
    expect(log).toEqual([true, false]);
  });

  it('reset() (blur, touch turned off) clears a running drag', () => {
    const { dom, c, log } = mk(); ctl = c;
    dom.dispatchEvent(ev('pointerdown', 100, 100, 3));
    for (let i = 1; i <= 8; i++) window.dispatchEvent(ev('pointermove', 100 + i * 12, 100, 3));
    expect(log).toEqual([true]);
    c.reset();
    expect(log).toEqual([true, false]);
  });
});
