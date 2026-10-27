// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { OperationsApi } from '../../src/ui/components/StOperations';

registerComponents();

function mount(total = 3, off = 0) {
  const st = { mode: 'on' as 'on' | 'off' | 'auto', total, off, running: 2, paused: 0, calls: [] as string[] };
  const api: OperationsApi = {
    rows: () => [], setMode: () => {}, setHours: () => {}, setEco: () => {}, setSeason: () => {}, keepOnly: () => {}, projected: () => 0,
    snow: {
      mode: () => st.mode, setMode: (m) => { st.mode = m; st.calls.push(`mode:${m}`); },
      summary: () => ({ total: st.total, running: st.running, paused: st.paused, off: st.off, snowlineM: 1420 }),
      setAll: (on) => { st.off = on ? 0 : st.total; st.calls.push(`all:${on}`); },
    },
  };
  const e = el('st-operations'); document.body.append(e);
  (e as unknown as { bind(a: OperationsApi): void }).bind(api);
  return { e, st, root: (e as unknown as { root: ShadowRoot }).root };
}

describe('Operations: snowmaking control', () => {
  it('shows On / Auto / Off with the active one pressed, and switches mode', () => {
    const { st, root } = mount();
    const btn = (m: string) => root.querySelector(`[data-snow-mode=${m}]`) as HTMLButtonElement;
    expect(btn('on').getAttribute('aria-pressed')).toBe('true');
    btn('auto').click(); expect(st.calls).toEqual(['mode:auto']);
    expect(btn('auto').getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Snowmaking');
  });
  it('bulk button turns all cannons off, then on', () => {
    const { st, root } = mount();
    const bulk = () => root.querySelector('[data-role=snow-bulk]') as HTMLButtonElement;
    expect(bulk().textContent).toBe('Turn all cannons off'); bulk().click();
    expect(bulk().textContent).toBe('Turn all cannons on'); bulk().click();
    expect(st.calls).toEqual(['all:false', 'all:true']);
  });
  it('status line: Off by you / Auto waiting / Auto paused with the snowline', () => {
    const { st, root, e } = mount();
    st.mode = 'off'; (e as unknown as { refresh(): void }).refresh(); expect(root.textContent).toContain('Off by you');
    st.mode = 'auto'; st.running = 0; (e as unknown as { refresh(): void }).refresh(); expect(root.textContent).toContain('Auto: waiting for cold');
    st.paused = 2; (e as unknown as { refresh(): void }).refresh(); expect(root.textContent).toContain('Auto: paused, snowline 1,420 m');
  });
  it('is hidden when the resort has no cannons', () => {
    const { root } = mount(0);
    expect(root.querySelector('[data-role=snow-control]')).toBeNull();
  });
});
