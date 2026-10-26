// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mountTownCaption } from '../../src/ui/townCaption';

describe('title town caption', () => {
  it('shows the caption + Shuffle, Space / N / the button shuffle; focused controls keep their keys', () => {
    const onShuffle = vi.fn();
    const h = mountTownCaption(document, 'Alpine Village · seed 1234', onShuffle);
    expect(h.el.textContent).toContain('Alpine Village · seed 1234');
    expect(h.el.textContent).toContain('Space: next town');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(onShuffle).toHaveBeenCalledTimes(2);
    const btn = document.createElement('button'); document.body.appendChild(btn);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); // a focused button: Space belongs to it
    expect(onShuffle).toHaveBeenCalledTimes(2);
    (h.el.querySelector('button') as HTMLButtonElement).click();
    expect(onShuffle).toHaveBeenCalledTimes(3);
    h.setText('Cosy Hut Hamlet · seed 7');
    expect(h.el.textContent).toContain('Cosy Hut Hamlet');
    h.dispose(); btn.remove();
  });
  it('dispose removes the element and the key listener (no leaks across shuffles)', () => {
    const add = vi.spyOn(document, 'addEventListener'), rem = vi.spyOn(document, 'removeEventListener');
    for (let i = 0; i < 5; i++) { const fn = vi.fn(); const h = mountTownCaption(document, 'x', fn); h.dispose(); document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); expect(fn).not.toHaveBeenCalled(); }
    expect(document.querySelectorAll('.town-caption').length).toBe(0);
    expect(add.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(rem.mock.calls.filter((c) => c[0] === 'keydown').length);
    add.mockRestore(); rem.mockRestore();
  });
});
