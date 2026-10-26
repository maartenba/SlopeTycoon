import * as THREE from 'three';
import { CAMERA_ALT_DRAG_RAD_PER_PX, CAMERA_PAN_SPEED, CAMERA_PITCH, CAMERA_ROTATE_TWEEN_S, CAMERA_YAW_OFFSET } from '@/config/balance';

/** Camera offset from target given yaw/pitch/distance (Y up). */
export function cameraOffset(yaw: number, pitch: number, dist: number): THREE.Vector3 {
  const h = Math.cos(pitch) * dist;
  return new THREE.Vector3(Math.sin(yaw) * h, Math.sin(pitch) * dist, Math.cos(yaw) * h);
}

/** Ground-plane right/forward unit vectors (x,z) for a yaw. */
export function panBasis(yaw: number): { right: [number, number]; forward: [number, number] } {
  return {
    right: [Math.cos(yaw), -Math.sin(yaw)],
    forward: [-Math.sin(yaw), -Math.cos(yaw)],
  };
}

export function snapYaw(yaw: number, dir: number): number {
  const q = Math.PI / 2;
  const k = (yaw - CAMERA_YAW_OFFSET) / q;
  const n = dir > 0 ? Math.floor(k + 1e-6) + 1 : dir < 0 ? Math.ceil(k - 1e-6) - 1 : Math.round(k);
  return CAMERA_YAW_OFFSET + n * q;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

export interface FocusPose { x: number; z: number; zoom: number }
/** Pure: pose at normalised time t (0..1) of a focus tween (ease-in-out cubic). */
export function focusPose(from: FocusPose, to: FocusPose, t: number): FocusPose {
  const k = clamp(t, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  return { x: from.x + (to.x - from.x) * e, z: from.z + (to.z - from.z) * e, zoom: from.zoom + (to.zoom - from.zoom) * e };
}
/** Zoom a 'Go to' move settles at: close enough to read the spot, never zooming out. */
export const FOCUS_ZOOM = 2.6;

/** Everything that defines the iso camera; `freeze` / `thaw` bracket a ground-level view so exiting restores the exact pose. */
export interface IsoPose { tx: number; ty: number; tz: number; yaw: number; zoom: number }

export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  yaw = CAMERA_YAW_OFFSET;
  zoom = 1;
  minZoom = 0.5;
  maxZoom = 4;
  private mapSize = 64;
  private viewHeight = 40;
  private aspect = 1;
  private tweenFrom = 0;
  private tweenTo = 0;
  private tweenT = 1;
  private focusTween: { from: FocusPose; to: FocusPose; t: number; dur: number } | null = null;
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number } | null = null;
  private disposers: Array<() => void> = [];
  /** False while a ground-level view owns the input and the camera (all iso input is ignored, `update` leaves the pose untouched). */
  active = true;

  constructor(private dom: HTMLElement, mapSize: number) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.setMapSize(mapSize);
    this.bind();
  }

  setMapSize(n: number): void {
    this.mapSize = n;
    this.viewHeight = n * 0.75; // visible world height at zoom 1 (fully zoomed out)
    this.minZoom = 1.25; // never show the whole slab + void: the zoomed-out view stays mostly terrain
    this.maxZoom = Math.max(4, n / 8);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    const far = n * 4;
    this.camera.far = far;
    this.target.set(n / 2, 0, n / 2);
    this.updateProjection();
  }

  setAspect(a: number): void {
    this.aspect = a;
    this.updateProjection();
  }

  private updateProjection(): void {
    const h = this.viewHeight / this.zoom / 2;
    const c = this.camera;
    c.left = -h * this.aspect;
    c.right = h * this.aspect;
    c.top = h;
    c.bottom = -h;
    c.near = 0.1;
    c.far = this.mapSize * 4;
    c.updateProjectionMatrix();
  }

  rotateSnap(dir: number): void {
    this.tweenFrom = this.yaw;
    this.tweenTo = snapYaw(this.tweenT < 1 ? this.tweenTo : this.yaw, dir);
    this.tweenT = 0;
  }

  /** Smoothly move the view to tile-space point (x, z) (world units) and optionally zoom (default: at least FOCUS_ZOOM). */
  focusOn(x: number, z: number, o: { zoom?: number; duration?: number } = {}): void {
    const mx = clamp(x, 0, this.mapSize), mz = clamp(z, 0, this.mapSize);
    const zoom = clamp(o.zoom ?? Math.max(this.zoom, FOCUS_ZOOM), this.minZoom, this.maxZoom), dur = o.duration ?? 0.7;
    if (dur <= 0) { this.target.x = mx; this.target.z = mz; this.zoom = zoom; this.focusTween = null; this.updateProjection(); return; }
    this.focusTween = { from: { x: this.target.x, z: this.target.z, zoom: this.zoom }, to: { x: mx, z: mz, zoom }, t: 0, dur };
  }
  get focusing(): boolean { return this.focusTween !== null; }

  zoomBy(factor: number): void {
    this.focusTween = null;
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.updateProjection();
  }

  pan(right: number, forward: number): void {
    this.focusTween = null;
    const b = panBasis(this.yaw);
    this.target.x += b.right[0] * right + b.forward[0] * forward;
    this.target.z += b.right[1] * right + b.forward[1] * forward;
    this.clampTarget();
  }

  /** Touch: pan so the world follows a finger that moved (dx, dy) CSS px (same maths as the mouse drag). */
  panPixels(dx: number, dy: number): void {
    if (!this.active) return;
    const wpp = this.viewHeight / this.zoom / Math.max(1, this.dom.clientHeight);
    this.pan(-dx * wpp, dy * wpp / Math.sin(CAMERA_PITCH));
  }

  /** Touch twist: turn the view freely by `radians` (positive = the fingers turned clockwise on screen; the world follows them). */
  rotateBy(radians: number): void {
    if (!this.active) return;
    this.tweenT = 1;
    this.yaw += radians;
  }

  clampTarget(): void {
    this.target.x = clamp(this.target.x, 0, this.mapSize);
    this.target.z = clamp(this.target.z, 0, this.mapSize);
  }

  /** Stop the iso controls (cancel tweens) and return the exact pose to restore later. */
  freeze(): IsoPose {
    this.focusTween = null;
    this.tweenT = 1;
    this.keys.clear();
    this.drag = null;
    this.active = false;
    return { tx: this.target.x, ty: this.target.y, tz: this.target.z, yaw: this.yaw, zoom: this.zoom };
  }

  thaw(p: IsoPose): void {
    this.target.set(p.tx, p.ty, p.tz);
    this.yaw = p.yaw;
    this.zoom = p.zoom;
    this.focusTween = null;
    this.tweenT = 1;
    this.keys.clear();
    this.active = true;
    this.updateProjection();
    this.update(0);
  }

  update(dt: number): void {
    if (!this.active) return;
    const ft = this.focusTween;
    if (ft) {
      ft.t += dt / ft.dur;
      const p = focusPose(ft.from, ft.to, ft.t);
      this.target.x = p.x; this.target.z = p.z;
      if (p.zoom !== this.zoom) { this.zoom = p.zoom; this.updateProjection(); }
      if (ft.t >= 1) this.focusTween = null;
    }
    if (this.tweenT < 1) {
      this.tweenT = Math.min(1, this.tweenT + dt / CAMERA_ROTATE_TWEEN_S);
      const e = 1 - Math.pow(1 - this.tweenT, 3);
      this.yaw = this.tweenFrom + (this.tweenTo - this.tweenFrom) * e;
    }
    const k = (k1: string, k2: string): number => (this.keys.has(k1) || this.keys.has(k2) ? 1 : 0);
    const r = k('d', 'arrowright') - k('a', 'arrowleft');
    const f = k('w', 'arrowup') - k('s', 'arrowdown');
    if (r || f) {
      const d = (this.viewHeight / this.zoom) * CAMERA_PAN_SPEED * dt;
      this.pan(r * d, f * d);
    }
    this.camera.position.copy(this.target).add(cameraOffset(this.yaw, CAMERA_PITCH, this.mapSize * 2));
    this.camera.lookAt(this.target);
  }

  private on(el: HTMLElement | Window, t: string, fn: (e: never) => void): void {
    el.addEventListener(t, fn as EventListener);
    this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
  }

  private bind(): void {
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.active) return;
      const key = e.key.toLowerCase();
      if (key === 'q') this.rotateSnap(-1);
      else if (key === 'e') this.rotateSnap(1);
      else this.keys.add(key);
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'blur', () => this.keys.clear());
    this.on(this.dom, 'contextmenu', (e: Event) => e.preventDefault());
    this.on(this.dom, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      if (!this.active) return;
      this.zoomBy(Math.exp(-e.deltaY * 0.001));
    });
    this.on(this.dom, 'pointerdown', (e: PointerEvent) => {
      if (!this.active) return;
      if (e.button === 0 && !e.altKey) return;
      this.drag = { button: e.button, x: e.clientX, y: e.clientY };
      this.dom.setPointerCapture(e.pointerId);
    });
    this.on(this.dom, 'pointermove', (e: PointerEvent) => {
      if (!this.active || !this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (e.altKey) {
        this.tweenT = 1;
        this.yaw -= dx * CAMERA_ALT_DRAG_RAD_PER_PX;
      } else {
        const wpp = this.viewHeight / this.zoom / this.dom.clientHeight;
        // drag moves the world with the cursor; screen-down maps to ground-forward scaled by 1/sin(pitch)
        this.pan(-dx * wpp, dy * wpp / Math.sin(CAMERA_PITCH));
      }
    });
    const up = (): void => {
      this.drag = null;
    };
    this.on(this.dom, 'pointerup', up);
    this.on(this.dom, 'pointercancel', up);
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
