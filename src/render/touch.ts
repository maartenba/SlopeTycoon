/**
 * Touch gestures -> intents (pure: no DOM, no three.js; time is injected so it is unit-testable). docs/touch.md.
 *
 * The recogniser follows the pointers of ONE gesture surface (the map canvas):
 *   - one finger, PAN mode (default): a drag pans the camera (`pan`), a short still press is a `tap`, a long still press is a `longpress`.
 *   - one finger, PAINT mode on a drag-tool (piste, path, terrain, trees, landscape): the stroke starts at once (`paintStart/Move/End`) so a
 *     one-finger drag paints instead of panning; the pan/paint toggle in the touch bar picks the mode.
 *   - two fingers: pinch = `zoom` (factor), twist = `rotate` (radians), centroid drag = `pan`; always, whatever the mode (a running paint stroke is
 *     cancelled with `paintCancel` first). A quick still two-finger tap = `twoTap` (undo).
 * Tap-tools (placement, lifts, bulldoze) and Select never paint: a one-finger drag always pans there, and a tap is delivered as `tap`.
 */
export type TouchMode = 'pan' | 'paint';
/** What the active map tool wants from a one-finger drag: 'paint' tools own the drag in paint mode; everything else pans. */
export type ToolKind = 'select' | 'tap' | 'paint';

export type TouchIntent =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number; x: number; y: number }
  | { type: 'rotate'; radians: number }
  | { type: 'tap'; x: number; y: number }
  | { type: 'longpress'; x: number; y: number }
  | { type: 'twoTap' }
  | { type: 'paintStart'; x: number; y: number }
  | { type: 'paintMove'; x: number; y: number }
  | { type: 'paintEnd'; x: number; y: number }
  | { type: 'paintCancel' };

export interface TouchConfig {
  /** Movement (px) a finger may drift and still count as a tap / long press. */
  tapSlopPx: number;
  longPressMs: number;
  /** A tap (one or two fingers) must be over within this long. */
  tapMs: number;
  /** Two-finger tap: fingers must stay within this much spread / centroid drift (px) and twist (rad). */
  twoTapSlopPx: number;
}
export const DEFAULT_TOUCH_CONFIG: Readonly<TouchConfig> = { tapSlopPx: 10, longPressMs: 450, tapMs: 300, twoTapSlopPx: 14 };

/** Minimum touch target (CSS px): Apple HIG 44, Material 48. Used by the CSS custom property `--touch-min` and the tests. */
export const TOUCH_MIN_TARGET_PX = 44;

interface Ptr { id: number; x: number; y: number; sx: number; sy: number; t0: number }

/** Smallest signed angle difference b - a, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export class TouchGestures {
  mode: TouchMode = 'pan';
  toolKind: ToolKind = 'select';
  private ptrs = new Map<number, Ptr>();
  private state: 'idle' | 'one' | 'paint' | 'pan' | 'multi' | 'consumed' = 'idle';
  private pinch: { dist: number; ang: number; cx: number; cy: number; t0: number; moved: boolean; spread0: number; ang0: number; cx0: number; cy0: number } | null = null;

  constructor(private readonly emit: (i: TouchIntent) => void, private readonly cfg: Readonly<TouchConfig> = DEFAULT_TOUCH_CONFIG) {}

  /** True when a one-finger drag starts a paint stroke right now. */
  get paintsOneFinger(): boolean { return this.mode === 'paint' && this.toolKind === 'paint'; }
  get touching(): boolean { return this.ptrs.size > 0; }
  get fingers(): number { return this.ptrs.size; }
  /** Pointer ids currently owned by a paint stroke or a camera gesture: the DOM glue keeps those events away from the tools. */
  get phase(): 'idle' | 'one' | 'paint' | 'pan' | 'multi' | 'consumed' { return this.state; }

  pointerDown(id: number, x: number, y: number, t: number): void {
    if (this.ptrs.has(id)) return;
    this.ptrs.set(id, { id, x, y, sx: x, sy: y, t0: t });
    if (this.ptrs.size === 1) {
      if (this.paintsOneFinger) { this.state = 'paint'; this.emit({ type: 'paintStart', x, y }); } else this.state = 'one';
      return;
    }
    if (this.ptrs.size === 2) {
      if (this.state === 'paint') this.emit({ type: 'paintCancel' });
      this.state = 'multi';
      this.beginPinch(t);
      return;
    }
    // 3+ fingers: ignored beyond the first two (no jumps)
    this.state = 'multi';
    if (this.pinch) this.pinch.moved = true;
  }

  private two(): [Ptr, Ptr] | null {
    if (this.ptrs.size < 2) return null;
    const it = this.ptrs.values();
    return [it.next().value as Ptr, it.next().value as Ptr];
  }

  private beginPinch(t: number): void {
    const p = this.two()!;
    const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2, dist = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    this.pinch = { dist, ang, cx, cy, t0: t, moved: false, spread0: dist, ang0: ang, cx0: cx, cy0: cy };
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    const p = this.ptrs.get(id);
    if (!p) return;
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    switch (this.state) {
      case 'paint': this.emit({ type: 'paintMove', x, y }); break;
      case 'one':
        if (Math.hypot(x - p.sx, y - p.sy) > this.cfg.tapSlopPx) { this.state = 'pan'; this.emit({ type: 'pan', dx: x - p.sx, dy: y - p.sy }); }
        break;
      case 'pan': if (dx || dy) this.emit({ type: 'pan', dx, dy }); break;
      case 'multi': this.movePinch(); break;
      default: break;
    }
    void t;
  }

  private movePinch(): void {
    const q = this.pinch, p = this.two();
    if (!q || !p) return;
    const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2, dist = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    if (!q.moved && (Math.hypot(cx - q.cx0, cy - q.cy0) > this.cfg.twoTapSlopPx || Math.abs(dist - q.spread0) > this.cfg.twoTapSlopPx * 1.5 || Math.abs(angleDelta(q.ang0, ang)) > 0.2)) {
      // The fingers have left the tap zone: from here on it is a camera gesture. Catch up with everything they did since they touched down (up to ~11 degrees of twist,
      // ~20 % of zoom, 14 px of pan), otherwise a twist of 60 degrees would only turn the view by ~50 (measured with real emulated touch, docs/touch.md).
      q.moved = true; q.dist = q.spread0; q.ang = q.ang0; q.cx = q.cx0; q.cy = q.cy0;
    }
    if (q.moved) {
      if (q.dist > 1 && dist > 1 && dist !== q.dist) this.emit({ type: 'zoom', factor: dist / q.dist, x: cx, y: cy });
      const da = angleDelta(q.ang, ang);
      if (da !== 0) this.emit({ type: 'rotate', radians: da });
      if (cx !== q.cx || cy !== q.cy) this.emit({ type: 'pan', dx: cx - q.cx, dy: cy - q.cy });
    }
    q.dist = dist; q.ang = ang; q.cx = cx; q.cy = cy;
  }

  pointerUp(id: number, t: number, cancelled = false): void {
    const p = this.ptrs.get(id);
    if (!p) return;
    const was = this.state, n = this.ptrs.size;
    this.ptrs.delete(id);
    if (was === 'paint') { this.emit(cancelled ? { type: 'paintCancel' } : { type: 'paintEnd', x: p.x, y: p.y }); this.state = 'idle'; return; }
    if (was === 'one') {
      if (!cancelled && t - p.t0 <= this.cfg.tapMs) this.emit({ type: 'tap', x: p.x, y: p.y });
      this.state = 'idle';
      return;
    }
    if (was === 'multi') {
      if (n === 2 && !cancelled && this.pinch && !this.pinch.moved && t - this.pinch.t0 <= this.cfg.tapMs) this.emit({ type: 'twoTap' });
      if (this.ptrs.size === 1) { this.state = 'consumed'; this.pinch = null; } // the remaining finger must not tap / pan / paint by accident
      else if (this.ptrs.size === 0) { this.state = 'idle'; this.pinch = null; } else this.beginPinch(t);
      return;
    }
    if (this.ptrs.size === 0) this.state = 'idle';
  }

  /** Advance time: fires the long press for a single still finger. Call from a timer / frame loop. */
  tick(t: number): void {
    if (this.state !== 'one' || this.ptrs.size !== 1) return;
    const p = this.ptrs.values().next().value as Ptr;
    if (t - p.t0 >= this.cfg.longPressMs && Math.hypot(p.x - p.sx, p.y - p.sy) <= this.cfg.tapSlopPx) {
      this.state = 'consumed';
      this.emit({ type: 'longpress', x: p.x, y: p.y });
    }
  }

  /** Hard reset (tool switch, view mode change, window blur). A running paint stroke is cancelled. */
  reset(): void {
    if (this.state === 'paint') this.emit({ type: 'paintCancel' });
    this.ptrs.clear(); this.state = 'idle'; this.pinch = null;
  }
}

/** 'consumed' ends when the last finger lifts: handled in pointerUp (ptrs.size===0 -> idle). */

/** Auto = follow the coarse-pointer media query. Off wins over everything; On wins over the media query. */
export function resolveTouchEnabled(setting: 'auto' | 'on' | 'off', coarse: boolean): boolean {
  return setting === 'on' ? true : setting === 'off' ? false : coarse;
}

/** Tool kind for the touch layer from the ToolManager id. 'network' (piste / path / road) and the terrain-style tools paint; placement / lift / bulldoze tap. */
export function toolKindOf(toolId: string): ToolKind {
  switch (toolId) {
    case 'terraform': case 'plant': case 'landscape': case 'network': return 'paint';
    case 'placement': case 'lift': case 'bulldoze': return 'tap';
    default: return 'select';
  }
}

/**
 * Two-step placement (ghost first, then confirm): the first tap moves the ghost, a second tap within `tolPx` of the ghost's last tap (or the Confirm
 * button) places. Pure so it can be tested: feed taps, read what to do.
 */
export class TapConfirm {
  private last: { x: number; y: number } | null = null;
  constructor(private readonly tolPx = 28) {}
  /** 'preview' (move the ghost here) or 'confirm' (place now). */
  tap(x: number, y: number): 'preview' | 'confirm' {
    const l = this.last;
    if (l && Math.hypot(x - l.x, y - l.y) <= this.tolPx) { this.last = null; return 'confirm'; }
    this.last = { x, y };
    return 'preview';
  }
  /** Where the ghost is (null = no preview yet). */
  get pending(): { x: number; y: number } | null { return this.last; }
  clear(): void { this.last = null; }
}

/** Virtual joystick: stick offset from its centre (px) -> walk axes in -1..1 with a dead zone (radial, so diagonals are not faster). `fwd` is up. */
export function joystickAxes(dx: number, dy: number, radius: number, dead = 0.18): { fwd: number; strafe: number } {
  const len = Math.hypot(dx, dy) / Math.max(1, radius);
  if (len < dead) return { fwd: 0, strafe: 0 };
  const k = Math.min(1, (len - dead) / (1 - dead)) / len;
  return { strafe: (dx / Math.max(1, radius)) * k, fwd: (-dy / Math.max(1, radius)) * k };
}
/** Joystick axes -> the held WASD keys (the walk mode reads keys): threshold 0.35. */
export function joystickKeys(a: { fwd: number; strafe: number }, th = 0.35): Set<string> {
  const k = new Set<string>();
  if (a.fwd > th) k.add('w'); else if (a.fwd < -th) k.add('s');
  if (a.strafe > th) k.add('d'); else if (a.strafe < -th) k.add('a');
  return k;
}
