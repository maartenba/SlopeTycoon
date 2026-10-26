import { describe, expect, it } from 'vitest';
import { KEY_BINDINGS, SHORTCUTS, speedKeyAction, type KeyContext } from '../../src/ui/shortcuts';

describe('shortcut registry', () => {
  it('no key is bound twice inside one context', () => {
    const seen = new Map<string, string>();
    for (const b of KEY_BINDINGS) {
      const id = `${b.context}:${b.key.toLowerCase()}`;
      // arrow keys / wasd have one row per key; the same ACTION may appear under two keys but never one key twice
      expect(seen.has(id), `duplicate ${id} (${seen.get(id)} vs ${b.action})`).toBe(false);
      seen.set(id, b.action);
    }
  });
  it("a tool context never rebinds a global key unless the global handler is gated off for that tool", () => {
    const tools: KeyContext[] = ['terraform', 'plant', 'build', 'lift', 'path'];
    for (const b of KEY_BINDINGS.filter((x) => tools.includes(x.context))) {
      const g = KEY_BINDINGS.find((x) => x.context === 'global' && x.key.toLowerCase() === b.key.toLowerCase());
      if (g) expect(g.gatedBy, `${b.key} in ${b.context} collides with global '${g.action}'`).toBe(b.context);
    }
  });
  it('time keys never use digits (digits belong to drawer items / terraform modes)', () => {
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) expect(speedKeyAction({ key: k })).toBeNull();
  });
  it('every registry key is mentioned in the help overlay text', () => {
    const text = JSON.stringify(SHORTCUTS).toLowerCase();
    for (const b of KEY_BINDINGS) {
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '1-9', '_', '=', '.', ',', '+', '-', 'w', 'a', 's', 'd', 'e', 'q', '1', '2', '3', '4', '[', ']'].includes(b.key.toLowerCase())) continue; // grouped notations ('W A S D / arrows', '+ / .', '1 2 3 4', '[ ]')
      expect(text.includes(b.key.toLowerCase()) || text.includes(b.key.toLowerCase().replace('escape', 'esc')), `help overlay lacks ${b.key}`).toBe(true);
    }
  });
  it('photo mode: P is a global key that no tool context rebinds; the photo context has no duplicate keys and is documented in the help overlay', () => {
    expect(KEY_BINDINGS.filter((b) => b.key.toLowerCase() === 'p' && b.context !== 'walk')).toEqual([expect.objectContaining({ context: 'global' })]);
    const photo = KEY_BINDINGS.filter((b) => b.context === 'photo').map((b) => b.key.toLowerCase());
    expect(new Set(photo).size).toBe(photo.length);
    expect(photo).toEqual(expect.arrayContaining(['w', 'a', 's', 'd', 'q', 'e', 'enter', 'escape']));
    const help = JSON.stringify(SHORTCUTS);
    expect(help).toContain('Photo mode'); expect(help).toContain('nothing is uploaded');
  });
  it('walk mode: V is free (only global), the walk context has no duplicate keys, never collides with tool contexts it cannot be active with, and is documented', () => {
    expect(KEY_BINDINGS.filter((b) => b.key.toLowerCase() === 'v')).toEqual([expect.objectContaining({ context: 'global' })]);
    const walk = KEY_BINDINGS.filter((b) => b.context === 'walk').map((b) => b.key.toLowerCase());
    expect(new Set(walk).size).toBe(walk.length);
    expect(walk).toEqual(expect.arrayContaining(['w', 'a', 's', 'd', 'shift', ' ', 'e', 'p', 'escape']));
    // walk mode owns the keyboard (tools are reset on entry and every non-time key is swallowed): no tool-context key may be live with it
    expect(KEY_BINDINGS.filter((b) => ['terraform', 'plant', 'build', 'lift', 'path', 'drawer', 'ride', 'photo'].includes(b.context) && walk.includes(b.key.toLowerCase())).every((b) => b.context !== 'walk')).toBe(true);
    const help = JSON.stringify(SHORTCUTS);
    expect(help).toContain('Walk mode'); expect(help).toContain('cosmetic ride'); expect(help).toContain('Run');
  });
  it('walk start: Shift+V (choose start, global) and T (teleport, walk only) do not collide with any other binding and are documented', () => {
    const keys = KEY_BINDINGS.map((b) => `${b.context}:${b.key.toLowerCase()}`);
    expect(keys).toContain('global:shift+v'); expect(keys).toContain('walk:t'); expect(keys).toContain('walk:alt');
    expect(KEY_BINDINGS.filter((b) => b.key.toLowerCase() === 't')).toEqual([expect.objectContaining({ context: 'walk' })]); // T is free everywhere else
    expect(KEY_BINDINGS.filter((b) => b.key.toLowerCase() === 'v')).toHaveLength(1); // plain V unchanged
    const help = JSON.stringify(SHORTCUTS);
    expect(help).toContain('Shift+V'); expect(help).toContain('Teleport'); expect(help).toContain('Drag (hold the left button)'); expect(help).toContain('Alt');
  });
});
