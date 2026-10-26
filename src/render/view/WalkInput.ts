import type { WalkInput } from './walkPhysics';

/**
 * Walk mode input (Task 12). The key -> movement mapping and the settings are PURE (unit-tested); `WalkInputHandler` is the thin DOM layer
 * (key tracking + pointer-lock look with a drag-look fallback; pointer lock cannot be tested headlessly). Desktop only (no touch).
 */

/** Lower-cased `KeyboardEvent.key` values (plus 'shift') currently held. */
export type HeldKeys = ReadonlySet<string>;

const FWD = ['w', 'arrowup'], BACK = ['s', 'arrowdown'], LEFT = ['a', 'arrowleft'], RIGHT = ['d', 'arrowright'];
const any = (k: HeldKeys, names: string[]): boolean => names.some((n) => k.has(n));

/** Pure: held keys -> movement input. W/S + arrows = forward/back, A/D = strafe, Shift = run (or `runToggled` when the 'run toggle' setting is on), Space = jump. */
export function mapKeys(keys: HeldKeys, runToggled = false, out: WalkInput = { fwd: 0, strafe: 0, run: false, jump: false }): WalkInput {
  out.fwd = (any(keys, FWD) ? 1 : 0) - (any(keys, BACK) ? 1 : 0);
  out.strafe = (any(keys, RIGHT) ? 1 : 0) - (any(keys, LEFT) ? 1 : 0);
  out.run = keys.has('shift') || runToggled;
  out.jump = keys.has(' ');
  return out;
}
/** Keys the walk handler consumes (they never reach the iso camera / tools). */
export const WALK_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ', 'e'] as const;

/** Mouse look: 'drag' (default: hold the left button and drag, the cursor stays free: screenshots / OS shortcuts keep working) or 'lock' (pointer lock, immersive). */
export type MouseLook = 'drag' | 'lock';
export interface WalkSettings { sensitivity: number; invertY: boolean; fov: number; headBob: boolean; runToggle: boolean; mouseLook: MouseLook }
export const WALK_SETTINGS_KEY = 'slope.walk.v1';
export const DEFAULT_WALK_SETTINGS: WalkSettings = { sensitivity: 1, invertY: false, fov: 75, headBob: true, runToggle: false, mouseLook: 'drag' };
export const WALK_SENS_RANGE = [0.5, 2] as const;
export const WALK_FOV_RANGE = [60, 100] as const;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export function sanitizeWalkSettings(raw: unknown): WalkSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, d = DEFAULT_WALK_SETTINGS;
  const num = (v: unknown, def: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def);
  return {
    sensitivity: num(r.sensitivity, d.sensitivity, WALK_SENS_RANGE[0], WALK_SENS_RANGE[1]),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    fov: num(r.fov, d.fov, WALK_FOV_RANGE[0], WALK_FOV_RANGE[1]),
    headBob: typeof r.headBob === 'boolean' ? r.headBob : d.headBob,
    runToggle: typeof r.runToggle === 'boolean' ? r.runToggle : d.runToggle,
    mouseLook: r.mouseLook === 'lock' || r.mouseLook === 'drag' ? r.mouseLook : d.mouseLook,
  };
}
export function loadWalkSettings(storage: Pick<Storage, 'getItem'> | null): WalkSettings {
  try { const s = storage?.getItem(WALK_SETTINGS_KEY); return sanitizeWalkSettings(s ? JSON.parse(s) : null); } catch { return { ...DEFAULT_WALK_SETTINGS }; }
}
export function saveWalkSettings(storage: Pick<Storage, 'setItem'> | null, s: WalkSettings): void {
  try { storage?.setItem(WALK_SETTINGS_KEY, JSON.stringify(sanitizeWalkSettings(s))); } catch { /* storage unavailable */ }
}

/** Radians of look per pixel of mouse movement at sensitivity 1. */
export const LOOK_RAD_PER_PX = 0.0022;
/** Pure: mouse delta -> (dyaw, dpitch) in radians. Moving the mouse right turns right (yaw decreases: camera looks down -Z, +yaw = turn left). */
export function lookDelta(mx: number, my: number, sensitivity: number, out: { yaw: number; pitch: number }): void {
  const k = LOOK_RAD_PER_PX * sensitivity;
  // movement spikes (some browsers report huge first deltas after the lock engages) are ignored
  const cx = Math.abs(mx) > 400 ? 0 : mx, cy = Math.abs(my) > 400 ? 0 : my;
  out.yaw = -cx * k + 0; out.pitch = -cy * k + 0; // + 0 turns -0 into 0
}

/** Pure: drag-look delta in radians for a pointer moved from `prev` to `cur` (client px). Moving the mouse right turns right, up looks up. */
export function dragLook(prev: { x: number; y: number }, cur: { x: number; y: number }, sensitivity: number, out: { yaw: number; pitch: number }): void {
  lookDelta(cur.x - prev.x, cur.y - prev.y, sensitivity, out);
}
/** Pure: should the handler hold a pointer lock? Only in 'lock' mode, when supported, and not while the temporary 'free mouse' key (Alt / Tab) is held. */
export const wantsPointerLock = (mode: MouseLook, supported: boolean, freeKeyHeld: boolean): boolean => mode === 'lock' && supported && !freeKeyHeld;
/** Keys that temporarily free the mouse in lock mode. */
export const FREE_MOUSE_KEYS = ['alt', 'tab'] as const;
/** The HUD hint for the mouse (what the user needs to know about the cursor). */
export const mouseHint = (mode: MouseLook): string => (mode === 'lock' ? 'Mouse look (Alt: free mouse)' : 'Drag: look');

export interface WalkInputHost {
  onLook(dyaw: number, dpitch: number): void;
  onInteract(): void;
  /** Esc: leave walk mode. */
  onExit(): void;
  onPhoto(): void;
}

/** DOM side: tracks held keys, pointer-lock look (drag-look when the lock is unavailable / refused). */
export class WalkInputHandler {
  readonly keys = new Set<string>();
  runToggled = false;
  sensitivity = 1;
  runToggle = false;
  active = false;
  /** True while the pointer is locked to the canvas. */
  locked = false;
  /** 'drag' (default, no pointer lock, the cursor stays free) or 'lock'. */
  mouseLook: MouseLook = 'drag';
  /** Lock mode: Alt / Tab is held (or was pressed): the lock is released until the next click. */
  freed = false;
  private releasing = false;
  private drag: { id: number; x: number; y: number } | null = null;
  private tmp = { yaw: 0, pitch: 0 };
  private win: Window | null = null;
  private dom: HTMLElement | null = null;
  private listeners: Array<[string, (e: never) => void, AddEventListenerOptions | boolean]> = [];

  constructor(private host: WalkInputHost) {}

  /** Pointer lock available (desktop browsers; false in headless / happy-dom). */
  static lockSupported(el: HTMLElement | null): boolean { return !!el && typeof el.requestPointerLock === 'function'; }

  attach(win: Window, dom: HTMLElement): void {
    this.win = win; this.dom = dom;
    const add = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o: AddEventListenerOptions | boolean = true): void => { win.addEventListener(t, f as EventListener, o); this.listeners.push([t, f as never, o]); };
    add('keydown', (e) => this.keyDown(e));
    add('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
    add('keydown', (e) => this.freeKey(e));
    add('blur', () => { this.keys.clear(); });
    add('pointermove', (e) => this.pointerMove(e));
    add('pointerdown', (e) => this.pointerDown(e));
    const endDrag = (e: PointerEvent): void => { if (this.drag && e.pointerId === this.drag.id) { this.drag = null; document.body?.classList.remove('walk-dragging'); } };
    add('pointerup', endDrag); add('pointercancel', endDrag);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }
  detach(): void {
    for (const [t, f, o] of this.listeners) this.win?.removeEventListener(t, f as EventListener, o);
    this.listeners = [];
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
  /** Browsers release the lock on Esc and may not deliver that keydown: a lock lost while walking therefore counts as 'Esc' (exit). */
  private onLockChange = (): void => {
    const was = this.locked;
    this.locked = !!this.dom && document.pointerLockElement === this.dom;
    if (was && !this.locked && this.active) {
      if (this.releasing) { this.releasing = false; return; } // Alt / Tab freed the mouse on purpose
      this.host.onExit();
    }
  };

  /** Called when the mode starts / ends. */
  setActive(on: boolean): void {
    this.active = on; this.keys.clear(); this.runToggled = false; this.drag = null; this.freed = false; this.releasing = false;
    document.body?.classList.remove('walk-dragging');
    if (on) this.requestLock(); else this.releaseLock();
  }
  requestLock(): void {
    const d = this.dom;
    if (!d || !wantsPointerLock(this.mouseLook, WalkInputHandler.lockSupported(d), this.freed) || document.pointerLockElement === d) return;
    try { const p = d.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => { /* refused (needs a user gesture): drag-look fallback */ }); } catch { /* ignore */ }
  }
  releaseLock(): void { try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ } this.locked = false; }
  /** Lock mode: Alt / Tab frees the mouse (cursor back, screenshots work); the next click on the canvas captures it again. */
  private freeKey(e: KeyboardEvent): void {
    if (!this.active || this.mouseLook !== 'lock' || !this.locked) return;
    const k = e.key.toLowerCase();
    if (!(FREE_MOUSE_KEYS as readonly string[]).includes(k)) return;
    this.freed = true; this.releasing = true;
    if (k === 'tab') e.preventDefault();
    try { if (document.pointerLockElement) document.exitPointerLock(); else this.releasing = false; } catch { this.releasing = false; } // pointerlockchange (onLockChange) clears `locked` and `releasing`
  }

  /** Held-key movement input (a reused scratch object: allocation free). */
  private readonly scratch: WalkInput = { fwd: 0, strafe: 0, run: false, jump: false };
  input(): WalkInput { return mapKeys(this.keys, this.runToggled, this.scratch); }

  private keyDown(e: KeyboardEvent): void {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.stopImmediatePropagation(); e.preventDefault(); this.host.onExit(); return; }
    if (k === 'p') { e.stopImmediatePropagation(); e.preventDefault(); this.host.onPhoto(); return; }
    if (k === 'e') { if (!e.repeat) this.host.onInteract(); e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (k === 'shift') { if (!e.repeat && this.runToggle) this.runToggled = !this.runToggled; }
    if ((WALK_KEYS as readonly string[]).includes(k)) { this.keys.add(k); e.stopImmediatePropagation(); e.preventDefault(); }
  }
  private pointerMove(e: PointerEvent): void {
    if (!this.active) return;
    if (this.locked) { this.lockLook(e); return; }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    dragLook(this.drag, { x: e.clientX, y: e.clientY }, this.sensitivity, this.tmp);
    this.host.onLook(this.tmp.yaw, this.tmp.pitch);
    this.drag.x = e.clientX; this.drag.y = e.clientY;
  }
  private lockLook(e: PointerEvent): void { lookDelta(e.movementX, e.movementY, this.sensitivity, this.tmp); this.host.onLook(this.tmp.yaw, this.tmp.pitch); }
  private pointerDown(e: PointerEvent): void {
    if (!this.active || e.target !== this.dom) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    if (this.mouseLook === 'lock' && WalkInputHandler.lockSupported(this.dom)) { this.freed = false; this.requestLock(); if (this.locked) return; } // click to (re)capture
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; // drag to look: the cursor stays free and is hidden only while dragging
    document.body?.classList.add('walk-dragging');
    try { this.dom?.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }
}
