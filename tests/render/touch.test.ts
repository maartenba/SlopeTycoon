import { describe, expect, it } from 'vitest';
import { TapConfirm, TouchGestures, angleDelta, joystickAxes, joystickKeys, resolveTouchEnabled, toolKindOf, type TouchIntent } from '../../src/render/touch';

const rig = (mode: 'pan' | 'paint' = 'pan', kind: 'select' | 'tap' | 'paint' = 'select') => {
  const out: TouchIntent[] = [];
  const g = new TouchGestures((i) => out.push(i));
  g.mode = mode; g.toolKind = kind;
  return { g, out };
};

describe('touch gestures: one finger', () => {
  it('a still short press is a tap; nothing else fires', () => {
    const { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerMove(1, 103, 102, 40); g.pointerUp(1, 120);
    expect(out).toEqual([{ type: 'tap', x: 103, y: 102 }]);
  });
  it('a slow still press is not a tap but a long press (once)', () => {
    const { g, out } = rig();
    g.pointerDown(1, 50, 60, 0);
    g.tick(200); expect(out).toEqual([]);
    g.tick(460); g.tick(900);
    g.pointerUp(1, 1000);
    expect(out).toEqual([{ type: 'longpress', x: 50, y: 60 }]);
  });
  it('a drag beyond the slop pans (total offset first, then deltas) and never taps or long-presses', () => {
    const { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerMove(1, 130, 100, 30); g.pointerMove(1, 150, 110, 60); g.tick(900); g.pointerUp(1, 100);
    expect(out).toEqual([{ type: 'pan', dx: 30, dy: 0 }, { type: 'pan', dx: 20, dy: 10 }]);
  });
  it('tap-tools and select never paint: a drag pans even in paint mode', () => {
    for (const kind of ['select', 'tap'] as const) {
      const { g, out } = rig('paint', kind);
      g.pointerDown(1, 0, 0, 0); g.pointerMove(1, 50, 0, 20); g.pointerUp(1, 40);
      expect(out.map((i) => i.type)).toEqual(['pan']);
    }
  });
});

describe('touch gestures: paint mode', () => {
  it('a paint tool in paint mode starts at once and streams the stroke', () => {
    const { g, out } = rig('paint', 'paint');
    g.pointerDown(1, 10, 10, 0); g.pointerMove(1, 20, 12, 10); g.pointerMove(1, 40, 20, 20); g.pointerUp(1, 30);
    expect(out).toEqual([{ type: 'paintStart', x: 10, y: 10 }, { type: 'paintMove', x: 20, y: 12 }, { type: 'paintMove', x: 40, y: 20 }, { type: 'paintEnd', x: 40, y: 20 }]);
  });
  it('the same tool in pan mode pans instead (the pan / paint toggle disambiguates the drag)', () => {
    const { g, out } = rig('pan', 'paint');
    g.pointerDown(1, 10, 10, 0); g.pointerMove(1, 80, 10, 20); g.pointerUp(1, 30);
    expect(out.map((i) => i.type)).toEqual(['pan']);
  });
  it('a tap in pan mode with a paint tool is a tap (the glue turns it into one dab)', () => {
    const { g, out } = rig('pan', 'paint');
    g.pointerDown(1, 10, 10, 0); g.pointerUp(1, 50);
    expect(out).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });
  it('a second finger cancels the running stroke and starts the camera gesture', () => {
    const { g, out } = rig('paint', 'paint');
    g.pointerDown(1, 100, 100, 0); g.pointerMove(1, 110, 100, 10);
    g.pointerDown(2, 200, 100, 20);
    expect(out.map((i) => i.type)).toEqual(['paintStart', 'paintMove', 'paintCancel']);
    g.pointerMove(2, 260, 100, 30);
    expect(out.some((i) => i.type === 'zoom')).toBe(true);
    expect(out.filter((i) => i.type === 'paintMove')).toHaveLength(1);
  });
  it('cancelled pointer (system gesture) cancels the stroke', () => {
    const { g, out } = rig('paint', 'paint');
    g.pointerDown(1, 1, 1, 0); g.pointerUp(1, 5, true);
    expect(out.map((i) => i.type)).toEqual(['paintStart', 'paintCancel']);
  });
});

describe('touch gestures: two fingers', () => {
  it('pinch out zooms in by the distance ratio; pinch in zooms out', () => {
    const { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 5);
    g.pointerMove(2, 300, 100, 20); // spread 100 -> 200
    const z = out.find((i) => i.type === 'zoom') as Extract<TouchIntent, { type: 'zoom' }>;
    expect(z.factor).toBeCloseTo(2, 5);
    out.length = 0;
    g.pointerMove(2, 200, 100, 40); // back to 100
    expect((out.find((i) => i.type === 'zoom') as Extract<TouchIntent, { type: 'zoom' }>).factor).toBeCloseTo(0.5, 5);
  });
  it('twist rotates by the angle between the fingers (clockwise on screen = positive)', () => {
    const { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 5);
    g.pointerMove(2, 100 + 100 * Math.cos(0.5), 100 + 100 * Math.sin(0.5), 20); // finger 2 swings clockwise (y down) by 0.5 rad
    const r = out.find((i) => i.type === 'rotate') as Extract<TouchIntent, { type: 'rotate' }>;
    expect(r.radians).toBeCloseTo(0.5, 5);
  });
  it('dragging both fingers together pans by the centroid move', () => {
    const { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 5);
    g.pointerMove(1, 100, 160, 20); g.pointerMove(2, 200, 160, 21);
    const pans = out.filter((i): i is Extract<TouchIntent, { type: 'pan' }> => i.type === 'pan');
    expect(pans.reduce((a, p) => a + p.dy, 0)).toBeCloseTo(60, 5);
  });
  it('a quick still two-finger tap is `twoTap` (undo); a held or moved one is not', () => {
    let { g, out } = rig();
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 10); g.pointerUp(2, 100); g.pointerUp(1, 110);
    expect(out).toEqual([{ type: 'twoTap' }]);
    ({ g, out } = rig());
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 10); g.pointerUp(2, 700); g.pointerUp(1, 710);
    expect(out).toEqual([]);
    ({ g, out } = rig());
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 10); g.pointerMove(2, 300, 100, 20); g.pointerUp(2, 100); g.pointerUp(1, 110);
    expect(out.some((i) => i.type === 'twoTap')).toBe(false);
  });
  it('the finger left after a pinch is consumed: it cannot tap, pan or paint by accident, and the next touch works', () => {
    const { g, out } = rig('paint', 'paint');
    g.pointerDown(1, 100, 100, 0); g.pointerDown(2, 200, 100, 5); g.pointerMove(2, 300, 100, 20); g.pointerUp(2, 30);
    out.length = 0;
    g.pointerMove(1, 150, 150, 40); g.pointerUp(1, 50);
    expect(out).toEqual([]);
    expect(g.phase).toBe('idle');
    g.pointerDown(3, 5, 5, 100);
    expect(out[0]).toEqual({ type: 'paintStart', x: 5, y: 5 });
  });
  it('reset cancels a stroke and forgets every finger', () => {
    const { g, out } = rig('paint', 'paint');
    g.pointerDown(1, 1, 1, 0); g.reset();
    expect(out.map((i) => i.type)).toEqual(['paintStart', 'paintCancel']);
    expect(g.touching).toBe(false);
  });
});

describe('touch helpers', () => {
  it('angleDelta wraps', () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 5);
    expect(angleDelta(0, 0.3)).toBeCloseTo(0.3, 6);
  });
  it('Auto follows the coarse pointer; On / Off override it', () => {
    expect(resolveTouchEnabled('auto', true)).toBe(true);
    expect(resolveTouchEnabled('auto', false)).toBe(false);
    expect(resolveTouchEnabled('on', false)).toBe(true);
    expect(resolveTouchEnabled('off', true)).toBe(false);
  });
  it('tool kinds: terrain-style tools and the network tool paint, placement / lifts tap, the rest selects', () => {
    for (const id of ['terraform', 'plant', 'landscape', 'network']) expect(toolKindOf(id)).toBe('paint');
    for (const id of ['placement', 'lift', 'bulldoze']) expect(toolKindOf(id)).toBe('tap');
    expect(toolKindOf('select')).toBe('select');
  });
  it('TapConfirm: first tap previews, a second tap near it confirms, a far tap moves the preview', () => {
    const c = new TapConfirm(30);
    expect(c.tap(100, 100)).toBe('preview');
    expect(c.tap(300, 100)).toBe('preview');
    expect(c.tap(310, 108)).toBe('confirm');
    expect(c.pending).toBeNull();
    expect(c.tap(310, 108)).toBe('preview');
    c.clear(); expect(c.pending).toBeNull();
  });
  it('joystick: dead zone, radial scaling, keys', () => {
    expect(joystickAxes(5, 5, 50)).toEqual({ fwd: 0, strafe: 0 });
    const a = joystickAxes(0, -50, 50);
    expect(a.fwd).toBeCloseTo(1, 5); expect(a.strafe).toBeCloseTo(0, 5);
    const d = joystickAxes(50, -50, 50); // clamped by the caller: here len > radius => still <= 1
    expect(Math.hypot(d.fwd, d.strafe)).toBeLessThanOrEqual(1.0001);
    expect([...joystickKeys({ fwd: 1, strafe: -1 })].sort()).toEqual(['a', 'w']);
    expect([...joystickKeys({ fwd: -0.6, strafe: 0.1 })]).toEqual(['s']);
    expect(joystickKeys({ fwd: 0.2, strafe: 0 }).size).toBe(0);
  });
});
