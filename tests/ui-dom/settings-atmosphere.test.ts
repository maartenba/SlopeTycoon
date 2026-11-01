// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { ATMOS_LEVELS } from '../../src/config/atmosphere';
import { AtmosphereSettings } from '../../src/render/atmosphere/AtmosphereSettings';
import { el, registerComponents } from '../../src/ui';
import { MemStorage } from '../audio/fakeBackend';

registerComponents();
afterEach(() => { try { localStorage.clear(); } catch { /* none */ } document.body.replaceChildren(); });

describe('Settings > Graphics > Atmosphere', () => {
  it('shows Off / Low / High, reflects the stored level and drives the setter (persisted)', () => {
    const st = new MemStorage(), atm = new AtmosphereSettings(st, () => 'high');
    const e = el('st-settings'); document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], {
      quality: { get: () => 'med', set: () => {}, options: ['low', 'med', 'high'] },
      atmosphere: { get: () => atm.level, set: (l) => atm.set(l as 'off'), options: ATMOS_LEVELS },
    });
    const root = (e as unknown as { root: ShadowRoot }).root;
    const row = root.querySelector('section[data-section="graphics"] [data-row="atmosphere"]')!;
    expect(row.querySelector('label')!.textContent).toBe('Atmosphere');
    const sel = row.querySelector('st-select') as unknown as { value: string; options: { value: string }[]; dispatchEvent(e: Event): boolean };
    expect(sel.options.map((o) => o.value)).toEqual(['off', 'low', 'high']);
    expect(sel.value).toBe('high');
    sel.value = 'low'; sel.dispatchEvent(new Event('change'));
    expect(atm.level).toBe('low'); expect(st.m.get('slope.atmosphere')).toBe('low');
    expect(new AtmosphereSettings(st, () => 'high').level).toBe('low');
    e.remove();
  });
  it('without the api the row is absent', () => {
    const e = el('st-settings'); document.body.append(e);
    e.bind(new AudioSettings(null), { state: 'running', needsHint: false, onState: () => () => {} }, [], { quality: { get: () => 'med', set: () => {}, options: ['low', 'med', 'high'] } });
    expect((e as unknown as { root: ShadowRoot }).root.querySelector('[data-row="atmosphere"]')).toBeNull();
    e.remove();
  });
});
