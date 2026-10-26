import { TapConfirm, TouchGestures, toolKindOf, type TouchIntent, type TouchMode } from './touch';
import type { CameraController } from './CameraController';

export interface TouchControllerOptions {
  dom: HTMLElement;
  camera: CameraController;
  /** Current ToolManager id. */
  toolId(): string;
  /** Touch input on? (Settings > Touch controls + `(pointer: coarse)`.) */
  enabled(): boolean;
  /** Mode / pending-placement changes for the touch bar. */
  onState?(s: { mode: TouchMode; confirming: boolean; hint: string }): void;
  /** One-line summary of the ghost (cost or why it cannot be placed): the drawer that normally shows it steps aside while aiming. */
  ghostText?(): string;
  /** Place the pending building (PlacementTool.confirm). */
  confirmPlacement?(): boolean;
  now?(): number;
}

/**
 * DOM glue of the touch input (docs/touch.md): translates touch pointers on the map canvas into camera moves (pan / pinch / twist) and
 * SYNTHETIC mouse-style pointer events for the tools, so every tool keeps its single pointer-events code path (no touch fork inside tools).
 * Registered first (window capture) so it can keep the raw touch events away from the tools; synthetic events carry `synthetic` and are skipped here.
 * Outside the iso view (ride / walk / photo own the camera) one finger passes through untouched (drag = look / orbit) and a pinch becomes wheel events.
 */
export class TouchController {
  readonly gestures: TouchGestures;
  private readonly confirmTap = new TapConfirm();
  private tracked = new Set<number>();
  private timer = 0;
  private synthetic = false;
  private disposers: Array<() => void> = [];
  // pinch outside the iso view
  private view2: Map<number, { x: number; y: number }> = new Map();
  private viewDist = 0;
  private lastTool = '';

  constructor(private readonly o: TouchControllerOptions) {
    this.gestures = new TouchGestures((i) => this.onIntent(i));
    const dom = o.dom;
    dom.style.touchAction = 'none';
    this.on(window, 'pointerdown', (e: PointerEvent) => this.down(e), true);
    this.on(window, 'pointermove', (e: PointerEvent) => this.move(e), true);
    this.on(window, 'pointerup', (e: PointerEvent) => this.up(e, false), true);
    this.on(window, 'pointercancel', (e: PointerEvent) => this.up(e, true), true);
    this.on(window, 'blur', () => this.reset());
  }

  private on(el: EventTarget, t: string, fn: (e: never) => void, capture = false): void {
    el.addEventListener(t, fn as EventListener, capture);
    this.disposers.push(() => el.removeEventListener(t, fn as EventListener, capture));
  }

  get mode(): TouchMode { return this.gestures.mode; }
  setMode(m: TouchMode): void { this.gestures.mode = m; this.state(); }
  toggleMode(): TouchMode { this.setMode(this.gestures.mode === 'pan' ? 'paint' : 'pan'); return this.gestures.mode; }
  /** Pending (ghost placed, waiting for a second tap / Confirm). */
  get confirming(): boolean { return this.confirmTap.pending !== null; }
  /** The tool changed: refresh the tool kind and drop a pending preview. */
  toolChanged(): void { this.confirmTap.clear(); this.gestures.toolKind = toolKindOf(this.o.toolId()); this.state(); }
  confirm(): boolean { const ok = this.o.confirmPlacement?.() ?? false; this.confirmTap.clear(); this.state(); return ok; }
  private state(): void { this.o.onState?.({ mode: this.gestures.mode, confirming: this.confirming, hint: this.confirming ? (this.o.ghostText?.() ?? '') : '' }); }
  reset(): void { this.gestures.reset(); this.tracked.clear(); this.view2.clear(); this.stopTimer(); }
  dispose(): void { this.reset(); for (const d of this.disposers) d(); this.disposers = []; }

  private now(): number { return this.o.now ? this.o.now() : performance.now(); }
  private isoTouch(e: PointerEvent): boolean { return e.pointerType === 'touch' && !(e as { synthetic?: boolean }).synthetic && !this.synthetic && this.o.enabled(); }

  private down(e: PointerEvent): void {
    if (!this.isoTouch(e)) return;
    if (e.target !== this.o.dom) return;
    if (!this.o.camera.active) { this.viewDown(e); return; }
    const tk = toolKindOf(this.o.toolId());
    if (tk !== this.lastTool as never) { this.lastTool = tk; }
    this.gestures.toolKind = tk;
    e.stopImmediatePropagation(); e.preventDefault();
    this.tracked.add(e.pointerId);
    this.gestures.pointerDown(e.pointerId, e.clientX, e.clientY, this.now());
    this.startTimer();
  }
  private move(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || this.synthetic) return;
    if (this.tracked.has(e.pointerId)) { e.stopImmediatePropagation(); this.gestures.pointerMove(e.pointerId, e.clientX, e.clientY, this.now()); return; }
    if (this.view2.has(e.pointerId)) this.viewMove(e);
  }
  private up(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerType !== 'touch' || this.synthetic) return;
    if (this.tracked.has(e.pointerId)) {
      e.stopImmediatePropagation();
      this.tracked.delete(e.pointerId);
      this.gestures.pointerUp(e.pointerId, this.now(), cancelled);
      if (!this.gestures.touching) this.stopTimer();
      return;
    }
    if (this.view2.has(e.pointerId)) { this.view2.delete(e.pointerId); this.viewDist = 0; }
  }

  // ---- ride / walk / photo: one finger passes through; two fingers = wheel (FOV / zoom)
  private viewDown(e: PointerEvent): void {
    this.view2.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.view2.size >= 2) { e.stopImmediatePropagation(); const [a, b] = [...this.view2.values()]; this.viewDist = Math.hypot(a!.x - b!.x, a!.y - b!.y); }
  }
  private viewMove(e: PointerEvent): void {
    const p = this.view2.get(e.pointerId)!;
    p.x = e.clientX; p.y = e.clientY;
    if (this.view2.size < 2) return;
    e.stopImmediatePropagation();
    const [a, b] = [...this.view2.values()], d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (this.viewDist > 1 && d > 1 && d !== this.viewDist) this.fire(this.o.dom, new WheelEvent('wheel', { deltaY: -Math.log(d / this.viewDist) * 1000, bubbles: true, cancelable: true, clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 }));
    this.viewDist = d;
  }

  private startTimer(): void { if (!this.timer) this.timer = window.setInterval(() => this.gestures.tick(this.now()), 60); }
  private stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = 0; } }

  private fire(target: EventTarget, ev: Event): void {
    this.synthetic = true;
    try { target.dispatchEvent(ev); } finally { this.synthetic = false; }
  }
  private ptr(type: string, x: number, y: number, buttons: number): PointerEvent {
    const e = new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons, pointerId: 9001, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true });
    (e as { synthetic?: boolean }).synthetic = true;
    return e;
  }
  private press(x: number, y: number): void { this.fire(this.o.dom, this.ptr('pointermove', x, y, 0)); this.fire(this.o.dom, this.ptr('pointerdown', x, y, 1)); }
  private release(x: number, y: number): void { this.fire(this.o.dom, this.ptr('pointerup', x, y, 0)); }

  private onIntent(i: TouchIntent): void {
    const cam = this.o.camera;
    const tool = this.o.toolId();
    switch (i.type) {
      case 'pan': cam.panPixels(i.dx, i.dy); break;
      case 'zoom': cam.zoomBy(i.factor); break;
      case 'rotate': cam.rotateBy(i.radians); break;
      case 'tap':
        if (tool === 'placement') {
          if (this.confirmTap.tap(i.x, i.y) === 'confirm') { if (!this.o.confirmPlacement?.()) this.press(i.x, i.y); this.state(); } // place at the GHOST (never at a tile a finger-width away)
          else { this.fire(this.o.dom, this.ptr('pointermove', i.x, i.y, 0)); this.state(); }
        } else if (toolKindOf(tool) === 'paint') { // a tap with a paint tool = one dab
          this.press(i.x, i.y); this.release(i.x, i.y);
        } else this.press(i.x, i.y);
        break;
      case 'longpress': // alternative action: cancel the tool (right-click); in Select, show the hover info (tooltip substitute)
        if (tool === 'select') this.fire(this.o.dom, this.ptr('pointermove', i.x, i.y, 0));
        else { this.fire(this.o.dom, new MouseEvent('contextmenu', { clientX: i.x, clientY: i.y, button: 2, bubbles: true, cancelable: true })); this.confirmTap.clear(); this.state(); }
        break;
      case 'twoTap': window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); break;
      case 'paintStart': this.press(i.x, i.y); break;
      case 'paintMove': this.fire(this.o.dom, this.ptr('pointermove', i.x, i.y, 1)); break;
      case 'paintEnd': this.release(i.x, i.y); break;
      case 'paintCancel': this.fire(this.o.dom, this.ptr('pointermove', 0, 0, 0)); this.release(0, 0); break;
    }
  }
}
