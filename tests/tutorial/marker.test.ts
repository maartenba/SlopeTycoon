import { describe, expect, it } from 'vitest';
import { TutorialMarker, markGeometry, outline, ribbon } from '../../src/render/TutorialMarker';

const ground = (x: number, y: number): number => x * 0.5 + y * 0.25;

describe('TutorialMarker (terrain-draped ring / route / arrow)', () => {
  it('outline is a closed loop around the rect', () => {
    const o = outline({ x: 2, y: 3, w: 4, h: 2 });
    expect(o[0]).toEqual(o[o.length - 1]);
    expect(Math.min(...o.map((p) => p.x))).toBeLessThan(2);
    expect(Math.max(...o.map((p) => p.y))).toBeGreaterThan(5);
  });

  it('ribbon vertices follow the terrain height (draped), indices are valid', () => {
    const r = ribbon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 0.5, ground);
    expect(r.pos.length).toBe(18);
    for (let i = 0; i < r.pos.length; i += 3) expect(r.pos[i + 1]).toBeCloseTo(ground(r.pos[i]!, r.pos[i + 2]!) + 0.12, 5);
    expect(Math.max(...r.idx)).toBeLessThan(r.pos.length / 3);
  });

  it('markGeometry covers rect, second rect, route and the arrow; one mesh = one draw call', () => {
    const base = markGeometry({ x: 5, y: 5, w: 2, h: 2, ok: true }, ground);
    const full = markGeometry({ x: 5, y: 5, w: 2, h: 2, ok: true, extra: { x: 10, y: 10, w: 2, h: 2 }, line: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }] }, ground);
    expect(full.pos.length).toBeGreaterThan(base.pos.length);
    expect(Math.max(...full.idx)).toBeLessThan(full.pos.length / 3);
    const m = new TutorialMarker(ground);
    expect(m.visible).toBe(false);
    m.set({ x: 5, y: 5, w: 2, h: 2, ok: true });
    expect(m.visible).toBe(true);
    const geo = m.mesh.geometry;
    const before = geo.getAttribute('position');
    m.set({ x: 5, y: 5, w: 2, h: 2, ok: true }); // unchanged mark: geometry is not rebuilt
    expect(geo.getAttribute('position')).toBe(before);
    m.update(1.0);
    expect((m.mesh.material as { opacity: number }).opacity).toBeGreaterThan(0.1);
    m.set(null);
    expect(m.visible).toBe(false);
    m.dispose();
  });
});
