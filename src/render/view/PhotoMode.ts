/**
 * Photo mode camera + controls + capture (M5.2, Task 10). RENDER ONLY: nothing here touches the sim (the time-of-day override, the precipitation
 * toggle and the optional pause are owned by main.ts and restored on exit). Orbit maths are pure and unit-tested (tests/render/photoMode.test.ts).
 *
 * Camera: an orbit around a focus point on the ground (`fx, fz` + `lift` metres-ish above the surface), perspective, FOV 20..90.
 * Mouse: left drag orbits, middle / right drag (or Shift + left) pans the focus, wheel dollies. Keys: W A S D / arrows pan, Q / E lower / raise the focus,
 * Shift = fast. No animation / smoothing at all (so reduced motion is respected by construction).
 */
import * as THREE from 'three';
import type { Renderer } from '../Renderer';
import { skyGradient, type Lighting } from '../Lighting';
import type { ViewCameraRig } from './ViewCameraRig';
import { VIEWPOINT } from '../../config/viewpoints';
import { horizonFraction } from './cameraMath';
import { ASPECT_IDS, FILTER_IDS, FRAME_IDS, aspectRect, clampExportSize, compositeExport, cropFov, photoFileName, type AspectId, type FilterId, type FrameId } from './postfx';

export const PHOTO_FOV_MIN = 20;
export const PHOTO_FOV_MAX = 90;
export const PHOTO_FOV_DEFAULT = 55;
export const PHOTO_PITCH_MIN = -1.45;
export const PHOTO_PITCH_MAX = 0.45;
export const PHOTO_DIST_MIN = 1.5;
export const PHOTO_LIFT_MAX = 60;
/** Never let the camera sink below the terrain surface by less than this. */
export const PHOTO_MIN_CLEARANCE = 0.6;
export const PHOTO_THUMB_W = 256;

export interface PhotoSettings {
  fov: number;
  /** Time of day in hours (render-only override) or null = follow the game clock. */
  hour: number | null;
  /** Show the precipitation particles (render-only; the weather itself is untouched). */
  precip: boolean;
  /** 'Pause game while composing' (restores the previous speed on exit). */
  pauseGame: boolean;
  filter: FilterId;
  /** 0..1 */
  vignette: number;
  frame: FrameId;
  aspect: AspectId;
  /** 1 = on-screen pixels, 2 = double (clamped to the GPU / memory limits). */
  scale: 1 | 2;
}
export const DEFAULT_PHOTO_SETTINGS: PhotoSettings = { fov: PHOTO_FOV_DEFAULT, hour: null, precip: true, pauseGame: true, filter: 'none', vignette: 0.25, frame: 'none', aspect: 'window', scale: 1 };

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
/** Merge + clamp user input into a valid settings object (unknown / NaN values fall back to the previous value). */
export function sanitizeSettings(prev: PhotoSettings, patch: Partial<PhotoSettings>): PhotoSettings {
  const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const s = { ...prev, ...patch };
  return {
    fov: clamp(n(s.fov, prev.fov), PHOTO_FOV_MIN, PHOTO_FOV_MAX),
    hour: s.hour === null ? null : ((n(s.hour, prev.hour ?? 12) % 24) + 24) % 24,
    precip: !!s.precip, pauseGame: !!s.pauseGame,
    filter: FILTER_IDS.includes(s.filter) ? s.filter : prev.filter,
    vignette: clamp(n(s.vignette, prev.vignette), 0, 1),
    frame: FRAME_IDS.includes(s.frame) ? s.frame : prev.frame,
    aspect: ASPECT_IDS.includes(s.aspect) ? s.aspect : prev.aspect,
    scale: s.scale === 2 ? 2 : 1,
  };
}

export interface OrbitState { fx: number; fz: number; /** focus height above the surface */ lift: number; yaw: number; /** camera pitch: negative = looking down */ pitch: number; dist: number }
export type GroundFn = (x: number, z: number) => number;
export interface OrbitPose { x: number; y: number; z: number; yaw: number; pitch: number; fy: number }

/** Camera position / orientation for an orbit state. The camera never sinks below the surface (the pitch is raised instead) and stays inside the map. */
export function orbitPose(s: OrbitState, ground: GroundFn, mapSize: number, out: OrbitPose): OrbitPose {
  const fx = clamp(s.fx, 0, mapSize), fz = clamp(s.fz, 0, mapSize);
  const fy = ground(fx, fz) + s.lift;
  const d = Math.max(PHOTO_DIST_MIN, s.dist);
  let pitch = clamp(s.pitch, PHOTO_PITCH_MIN, PHOTO_PITCH_MAX);
  for (let i = 0; i < 3; i++) { // a few passes: the surface height under the camera changes with the pitch
    const cx = fx + d * Math.sin(s.yaw) * Math.cos(pitch), cz = fz + d * Math.cos(s.yaw) * Math.cos(pitch);
    const minY = ground(clamp(cx, 0, mapSize), clamp(cz, 0, mapSize)) + PHOTO_MIN_CLEARANCE;
    const maxSin = (fy - minY) / d;
    if (-Math.sin(pitch) * d + fy >= minY) break;
    pitch = Math.max(PHOTO_PITCH_MIN, Math.min(pitch, Math.asin(clamp(maxSin, -1, 1))));
  }
  out.x = fx + d * Math.sin(s.yaw) * Math.cos(pitch);
  out.z = fz + d * Math.cos(s.yaw) * Math.cos(pitch);
  out.y = Math.max(fy - d * Math.sin(pitch), ground(clamp(out.x, 0, mapSize), clamp(out.z, 0, mapSize)) + PHOTO_MIN_CLEARANCE);
  out.x = clamp(out.x, -mapSize * 0.25, mapSize * 1.25); out.z = clamp(out.z, -mapSize * 0.25, mapSize * 1.25);
  out.yaw = s.yaw; out.pitch = pitch; out.fy = fy;
  return out;
}

/** Orbit state that reproduces a free camera pose (focus `dist` ahead of the camera). */
export function orbitFromPose(x: number, y: number, z: number, yaw: number, pitch: number, dist: number, ground: GroundFn): OrbitState {
  const cp = Math.cos(pitch);
  const fx = x - dist * Math.sin(yaw) * cp, fz = z - dist * Math.cos(yaw) * cp, fy = y + dist * Math.sin(pitch);
  return { fx, fz, lift: clamp(fy - ground(fx, fz), 0, PHOTO_LIFT_MAX), yaw, pitch, dist };
}

/** Pan the focus on the ground plane relative to the camera yaw (+right, +forward in metres-ish world units). */
export function panFocus(s: OrbitState, right: number, forward: number): void {
  s.fx += Math.cos(s.yaw) * right - Math.sin(s.yaw) * forward;
  s.fz += -Math.sin(s.yaw) * right - Math.cos(s.yaw) * forward;
}

/** The 'Hero shot' preset: a 3/4 view of the village from the sunny side, slightly above head height of the buildings. */
export function heroState(cx: number, cz: number, mapSize: number): OrbitState {
  return { fx: cx, fz: cz, lift: 2.5, yaw: 0.62, pitch: -0.3, dist: clamp(mapSize * 0.2, 16, 40) };
}

/** Orbit state of a viewpoint spot: the camera stands on the viewpoint, the focus lies `photoDist` out in the look direction. */
export function viewpointState(spot: { x: number; z: number; look: number; reach?: number }, mapSize: number): OrbitState {
  const pitch = VIEWPOINT.photoPitch, d = VIEWPOINT.photoDist, c = Math.cos(pitch), r = spot.reach ?? 0; // reach: step out past the building's own mesh
  return { fx: clamp(spot.x + Math.cos(spot.look) * (r + d * c), 0, mapSize), fz: clamp(spot.z + Math.sin(spot.look) * (r + d * c), 0, mapSize), lift: VIEWPOINT.photoLift, yaw: Math.atan2(-Math.cos(spot.look), -Math.sin(spot.look)), pitch, dist: d };
}

/**
 * Render-only time-of-day override on top of the host's debug lock: `begin` remembers the previous lock, `apply(h)` sets the photo hour (`null` = the
 * remembered lock again), `end` restores it exactly. The sim clock (and therefore stateHash) is never involved.
 */
export class HourOverride {
  private saved: number | null = null;
  private on = false;
  constructor(private readonly get: () => number | null, private readonly set: (h: number | null) => void) {}
  get active(): boolean { return this.on; }
  begin(): void { this.saved = this.get(); this.on = true; }
  apply(h: number | null): void { if (this.on) this.set(h === null ? this.saved : h); }
  end(): void { if (!this.on) return; this.on = false; this.set(this.saved); this.saved = null; }
}

export interface PhotoResult { png: Blob; thumb: Blob; w: number; h: number; clamped: boolean; transparentPx: number; /** transparent pixels of the raw WebGL frame before the sky was painted (proves the sky step does something) */ rawTransparentPx: number }
export interface PhotoModeDeps {
  renderer: Renderer;
  lighting: Lighting;
  ground: GroundFn;
  mapSize: number;
  resortName(): string;
  /** Village centre for the hero preset. */
  heroFocus(): { x: number; z: number };
  /** Live position of the followed ride guest (null = none). */
  followTarget?(): { x: number; y: number; z: number } | null;
  /** Viewpoint photo spots (Phase 6 Task 6): tile centre + the direction (radians over x / z) in which the ground falls away. */
  spots?(): ReadonlyArray<{ x: number; z: number; look: number; reach?: number }>;
}

const KEYS_MOVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e']);

export class PhotoMode {
  active = false;
  settings: PhotoSettings = { ...DEFAULT_PHOTO_SETTINGS };
  readonly orbit: OrbitState = { fx: 0, fz: 0, lift: 1, yaw: 0, pitch: -0.5, dist: 30 };
  follow = false;
  private readonly keys = new Set<string>();
  private readonly pose: OrbitPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 };
  private drag: { id: number; x: number; y: number; pan: boolean } | null = null;
  private attached = false;

  constructor(private readonly d: PhotoModeDeps) {}

  /** Starts photo mode from the current camera: iso = a perspective view of the same spot, ride / walk = the exact ground camera pose (the walker's eye). */
  begin(from: 'iso' | 'ride' | 'walk'): void {
    const r = this.d.renderer, g = this.d.ground;
    this.settings = { ...this.settings, fov: PHOTO_FOV_DEFAULT };
    if (from === 'ride' || from === 'walk') {
      const p = r.rig.pose;
      Object.assign(this.orbit, orbitFromPose(p.x, p.y, p.z, p.yaw, p.pitch, 12, g));
      this.settings.fov = clamp(r.rig.fov, PHOTO_FOV_MIN, PHOTO_FOV_MAX);
    } else {
      const c = r.controls, o = c.camera, h = (o.top - o.bottom) || 30;
      const dist = clamp(h / 2 / Math.tan((this.settings.fov * Math.PI) / 360), 10, this.d.mapSize * 0.9);
      Object.assign(this.orbit, { fx: c.target.x, fz: c.target.z, lift: 1, yaw: c.yaw, pitch: -0.62, dist });
    }
    this.follow = false; this.keys.clear(); this.drag = null; this.active = true;
  }
  end(): void { this.active = false; this.follow = false; this.keys.clear(); this.drag = null; }

  hero(): void {
    const f = this.d.heroFocus();
    Object.assign(this.orbit, heroState(f.x, f.z, this.d.mapSize));
    this.follow = false;
  }
  /** Number of viewpoint photo spots right now. */
  spotCount(): number { return this.d.spots?.().length ?? 0; }
  private spotIx = -1;
  /** 'Viewpoint': frame the next viewpoint spot from the viewpoint itself, looking out over the lower ground. Returns false without spots. */
  nextSpot(): boolean {
    const list = this.d.spots?.() ?? [];
    if (!list.length) return false;
    this.spotIx = (this.spotIx + 1) % list.length;
    Object.assign(this.orbit, viewpointState(list[this.spotIx]!, this.d.mapSize));
    this.follow = false;
    return true;
  }
  /** 'Follow guest' (only meaningful when entered from a ride-along): the focus tracks the guest; the orbit angles stay under user control. */
  followGuest(on: boolean): void {
    this.follow = on && !!this.d.followTarget?.();
    if (this.follow) Object.assign(this.orbit, { lift: 1.2, dist: 7, pitch: -0.22 });
  }

  /** Per frame: apply held keys, position the rig. Returns the rig pose. */
  update(dt: number): ReturnType<ViewCameraRig['setFree']> {
    const o = this.orbit, k = this.keys, fast = k.has('shift') ? 3 : 1;
    if (this.follow) {
      const t = this.d.followTarget?.();
      if (t) { o.fx = t.x; o.fz = t.z; } else this.follow = false;
    }
    const sp = Math.max(4, o.dist) * 0.9 * fast * dt;
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (!this.follow && (r || f)) panFocus(o, r * sp, f * sp);
    if (k.has('e')) o.lift = clamp(o.lift + 8 * fast * dt, 0, PHOTO_LIFT_MAX);
    if (k.has('q')) o.lift = clamp(o.lift - 8 * fast * dt, 0, PHOTO_LIFT_MAX);
    o.fx = clamp(o.fx, 0, this.d.mapSize); o.fz = clamp(o.fz, 0, this.d.mapSize);
    const p = orbitPose(o, this.d.ground, this.d.mapSize, this.pose);
    o.pitch = p.pitch; // keep the ground clamp sticky so the drag does not wind up
    return this.d.renderer.rig.setFree(p.x, p.y, p.z, p.yaw, p.pitch, this.settings.fov);
  }

  /** Where the horizon sits (0..1 of the frame height) for the current pose, with an optional cropped FOV. */
  horizon(fov = this.settings.fov): number { return horizonFraction(this.pose.pitch, fov); }

  // ------------------------------------------------------------ input (window capture listeners, active only in photo mode)
  /** Returns true when the key was consumed. Esc / P are handled by the host. */
  keyDown(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'shift') { this.keys.add('shift'); return false; }
    if (KEYS_MOVE.has(k)) { this.keys.add(k); return true; }
    return false;
  }
  keyUp(e: KeyboardEvent): void { this.keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') this.keys.delete('shift'); }
  blur(): void { this.keys.clear(); this.drag = null; }

  pointerDown(e: PointerEvent, dom: HTMLElement): void {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
    try { dom.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }
  pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    const o = this.orbit;
    if (d.pan) { if (!this.follow) { const k = Math.max(4, o.dist) * 0.0016; panFocus(o, -dx * k, dy * k); } } else {
      o.yaw -= dx * 0.005;
      o.pitch = clamp(o.pitch - dy * 0.004, PHOTO_PITCH_MIN, PHOTO_PITCH_MAX);
    }
  }
  pointerUp(e: PointerEvent): void { if (this.drag && e.pointerId === this.drag.id) this.drag = null; }
  wheel(e: WheelEvent): void { this.orbit.dist = clamp(this.orbit.dist * Math.exp(clamp(e.deltaY, -300, 300) * 0.0012), PHOTO_DIST_MIN, this.d.mapSize * 1.2); }

  /** Registers the capture-phase window listeners once (they do nothing unless photo mode is active). `consume` = swallow pointer events for the canvas. */
  attach(win: Window, dom: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    const onDown = (e: PointerEvent): void => { if (!this.active || e.target !== dom) return; e.stopPropagation(); this.pointerDown(e, dom); };
    const onMove = (e: PointerEvent): void => { if (!this.active) { this.drag = null; return; } if (e.target === dom) e.stopPropagation(); this.pointerMove(e); };
    const onUp = (e: PointerEvent): void => { if (!this.active) return; this.pointerUp(e); if (e.target === dom) e.stopPropagation(); };
    const onWheel = (e: WheelEvent): void => { if (!this.active || e.target !== dom) return; e.preventDefault(); e.stopPropagation(); this.wheel(e); };
    const swallow = (e: Event): void => { if (this.active && e.target === dom) { e.stopPropagation(); if (e.type === 'contextmenu') e.preventDefault(); } };
    win.addEventListener('pointerdown', onDown, true);
    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onUp, true);
    win.addEventListener('wheel', onWheel, { capture: true, passive: false });
    for (const t of ['click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup']) win.addEventListener(t, swallow, true);
    win.addEventListener('keyup', (e) => { if (this.active) this.keyUp(e); }, true);
    win.addEventListener('blur', () => this.blur());
  }

  // ------------------------------------------------------------ capture
  /**
   * Renders the current view at export resolution and composites the PNG: sky behind the transparent WebGL pixels, colour filter, vignette, frame.
   * The WebGL canvas is resized to the export size for one synchronous render + read (drawImage right after render, so no preserveDrawingBuffer is
   * needed), then restored. Throws if there is no 2D canvas.
   */
  async capture(): Promise<PhotoResult> {
    const r = this.d.renderer, gl = r.webgl, cam = r.rig.camera, s = this.settings;
    const el = gl.domElement, winW = el.clientWidth || window.innerWidth, winH = el.clientHeight || window.innerHeight;
    const rect = aspectRect(winW, winH, s.aspect);
    const dpr = gl.getPixelRatio();
    const maxTex = Math.min(gl.capabilities.maxTextureSize, Number(gl.getContext().getParameter(gl.getContext().MAX_RENDERBUFFER_SIZE)) || 4096);
    const size = clampExportSize(rect.w * dpr, rect.h * dpr, s.scale, maxTex);
    const prevFov = cam.fov, prevAspect = cam.aspect;
    const fov = cropFov(s.fov, rect.h, winH);
    const hf = horizonFraction(this.pose.pitch, fov);
    const prevSize = gl.getSize(new THREE.Vector2());
    let img: ImageData;
    try {
      gl.setPixelRatio(1);
      gl.setSize(size.w, size.h, false);
      cam.aspect = size.w / size.h; cam.fov = fov; cam.updateProjectionMatrix();
      gl.render(r.scene, cam);
      const c2 = document.createElement('canvas'); c2.width = size.w; c2.height = size.h;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable');
      ctx.drawImage(el, 0, 0);
      img = ctx.getImageData(0, 0, size.w, size.h);
    } finally {
      gl.setPixelRatio(dpr);
      gl.setSize(prevSize.x, prevSize.y, false);
      r.resize();
      cam.fov = prevFov; cam.aspect = prevAspect; cam.updateProjectionMatrix();
    }
    let rawTransparentPx = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < 255) rawTransparentPx++;
    const lp = this.d.lighting.last;
    const g = lp ? skyGradient(lp) : { top: [0.3, 0.55, 0.9] as [number, number, number], horizon: [0.8, 0.9, 1] as [number, number, number] };
    compositeExport(img.data, size.w, size.h, { sky: { top: g.top, horizon: g.horizon, horizonAt: hf }, filter: s.filter, vignette: s.vignette, frame: s.frame });
    let transparentPx = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < 255) transparentPx++;
    const out = document.createElement('canvas'); out.width = size.w; out.height = size.h;
    out.getContext('2d')!.putImageData(img, 0, 0);
    const tw = Math.min(PHOTO_THUMB_W, size.w), th = Math.max(1, Math.round((size.h * tw) / size.w));
    const tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
    const tctx = tc.getContext('2d')!; tctx.imageSmoothingQuality = 'high'; tctx.drawImage(out, 0, 0, tw, th);
    const toBlob = (c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q));
    const [png, thumb] = await Promise.all([toBlob(out, 'image/png'), toBlob(tc, 'image/jpeg', 0.82)]);
    return { png, thumb, w: size.w, h: size.h, clamped: size.clamped, transparentPx, rawTransparentPx };
  }

  /**
   * Year-report cover (M5.3): a small framed shot of the CURRENT camera (iso by default; no photo mode needed) with the sky painted behind the
   * transparent WebGL pixels, centre-cropped to 16:9 and returned as a JPEG data URL of at most `maxChars` characters. One synchronous render at
   * ~`maxW` px (a few ms); the WebGL canvas is restored right after. Returns null when WebGL / 2D canvas is unavailable (headless) or on any error.
   */
  captureCover(maxW = 480, maxChars = 30_000): string | null {
    try {
      const r = this.d.renderer, gl = r.webgl, cam = r.camera, el = gl.domElement;
      const winW = el.clientWidth || 0, winH = el.clientHeight || 0;
      if (winW < 16 || winH < 16) return null;
      const w = Math.min(maxW, winW), h = Math.max(2, Math.round((winH * w) / winW)), dpr = gl.getPixelRatio();
      const prev = gl.getSize(new THREE.Vector2());
      let img: ImageData;
      try {
        gl.setPixelRatio(1); gl.setSize(w, h, false);
        gl.render(r.scene, cam);
        const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        const ctx = c2.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(el, 0, 0);
        img = ctx.getImageData(0, 0, w, h);
      } finally {
        gl.setPixelRatio(dpr); gl.setSize(prev.x, prev.y, false); r.resize();
      }
      const lp = this.d.lighting.last;
      const g = lp ? skyGradient(lp) : { top: [0.3, 0.55, 0.9] as [number, number, number], horizon: [0.8, 0.9, 1] as [number, number, number] };
      compositeExport(img.data, w, h, { sky: { top: g.top, horizon: g.horizon, horizonAt: 0.3 }, filter: 'none', vignette: 0.2, frame: 'none' });
      const full = document.createElement('canvas'); full.width = w; full.height = h;
      full.getContext('2d')!.putImageData(img, 0, 0);
      const ow = w, oh = Math.min(h, Math.round((w * 9) / 16)), out = document.createElement('canvas'); out.width = ow; out.height = oh;
      out.getContext('2d')!.drawImage(full, 0, Math.round((h - oh) / 2), w, oh, 0, 0, ow, oh);
      for (const q of [0.72, 0.6, 0.48, 0.36, 0.26]) { const u = out.toDataURL('image/jpeg', q); if (u.startsWith('data:image/jpeg') && u.length <= maxChars) return u; }
      return null;
    } catch { return null; }
  }

  fileName(now = new Date()): string { return photoFileName(this.d.resortName(), now); }
}

/** Local download of a blob. Safari without `download` support opens the blob in a new tab instead. Never uploads or shares anything. */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  if (!('download' in a)) { window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60_000); return; }
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  doc.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
