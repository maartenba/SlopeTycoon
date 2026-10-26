import { describe, it, expect } from 'vitest';
import { ToolManager, type ManagedTool } from '../../src/build/ToolManager';

function mk() {
  const log: string[] = [];
  const state: Record<string, boolean> = {};
  const m = new ToolManager('select');
  const tool = (id: string, onDisable?: () => void): ManagedTool => ({
    id, enable: () => { state[id] = true; log.push(`+${id}`); }, disable: () => { state[id] = false; log.push(`-${id}`); onDisable?.(); },
  });
  return { m, log, state, tool };
}

describe('ToolManager', () => {
  it('starts on the default tool and only one tool is active', () => {
    const { m, state, tool } = mk();
    for (const id of ['select', 'placement', 'lift', 'network', 'bulldoze']) m.register(tool(id));
    expect(m.current).toBe('select');
    m.activate('placement');
    m.activate('lift');
    expect(m.current).toBe('lift');
    expect(state.placement).toBe(false);
    expect(state.select).toBe(false);
    expect(state.lift).toBe(true);
    expect(Object.values(state).filter(Boolean)).toHaveLength(1);
  });
  it('release returns to default; stale releases are ignored', () => {
    const { m, state, tool } = mk();
    for (const id of ['select', 'placement', 'lift']) m.register(tool(id));
    m.activate('lift');
    m.release('placement'); // not current
    expect(m.current).toBe('lift');
    m.release('lift');
    expect(m.current).toBe('select');
    expect(state.select).toBe(true);
  });
  it('a tool whose disable() calls release() on itself does not re-enable the default mid-switch', () => {
    const { m, log, tool } = mk();
    m.register(tool('select'));
    m.register(tool('lift', () => m.release('lift')));
    m.register(tool('placement'));
    m.activate('lift');
    log.length = 0;
    m.activate('placement');
    expect(log).toEqual(['-lift', '+placement']);
    expect(m.current).toBe('placement');
  });
  it('reset (Esc) returns to default and notifies; unknown ids are rejected', () => {
    const { m, tool } = mk();
    m.register(tool('select')); m.register(tool('bulldoze'));
    const seen: string[] = [];
    m.onChange((id, prev) => seen.push(`${prev}>${id}`));
    expect(m.activate('nope')).toBe(false);
    m.activate('bulldoze');
    m.reset();
    m.reset();
    expect(seen).toEqual(['select>bulldoze', 'bulldoze>select']);
    expect(m.isDefault()).toBe(true);
  });
});

describe('ToolManager default start', () => {
  it('start() enables the default tool; missing default is reported', async () => {
    const { ToolManager } = await import('../../src/build/ToolManager');
    const tm = new ToolManager('select');
    expect(tm.start()).toBe(false);
    let on = false;
    tm.register({ id: 'select', enable: () => { on = true; }, disable: () => { on = false; } });
    expect(tm.current).toBe('select');
    expect(tm.start()).toBe(true);
    expect(on).toBe(true);
    tm.register({ id: 'x', enable: () => {}, disable: () => {} });
    tm.activate('x');
    expect(on).toBe(false);
    tm.reset();
    expect(on).toBe(true);
  });
});

describe('select default + terraform opt-in', () => {
  const setup = () => {
    const calls: string[] = [];
    const m = new ToolManager('select');
    let terraEnabled = false;
    m.register({ id: 'select', enable: () => {}, disable: () => {} });
    m.register({ id: 'terraform', enable: () => { terraEnabled = true; }, disable: () => { terraEnabled = false; } });
    m.register({ id: 'placement', enable: () => {}, disable: () => {} });
    return { m, calls, terra: () => terraEnabled };
  };
  it('default is select and terraform is inactive after start/reset/release', () => {
    const { m, terra } = setup();
    expect(m.start()).toBe(true);
    expect(m.current).toBe('select');
    expect(terra()).toBe(false);
    m.activate('terraform');
    expect(terra()).toBe(true);
    m.reset(); // Esc / drawer close
    expect(m.current).toBe('select');
    expect(terra()).toBe(false);
    m.activate('terraform'); m.release('terraform');
    expect(terra()).toBe(false);
    m.activate('terraform'); m.activate('placement');
    expect(terra()).toBe(false);
  });
});
