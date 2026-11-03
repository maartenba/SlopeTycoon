import * as THREE from 'three';
import type { BuildingMeshes } from '../meshes';
import { buildTowerGeometry } from '../meshes/lifts/Tower';
import { LIFTS } from '../../config/lifts';
import { buildCarrierGeometry } from '../meshes/lifts';
import { glassGroups, liftGlassMaterial, liftMaterial } from '../meshes/lifts/geo';
import type { LiftKind } from '../../config/lifts';
import { thumbKey, type ThumbKind } from './keys';

/** Game camera orientation (see CameraController): pitch 35.264°, yaw 45°. */
const PITCH = Math.atan(1 / Math.SQRT2);
const YAW = Math.PI / 4;

/**
 * Renders procedural meshes to small transparent PNG data URLs with a private offscreen WebGLRenderer.
 * Lazy + cached. get() returns null when WebGL is unavailable or rendering failed (callers show a fallback tile).
 * NOTE: unverified at runtime in agent environments (no WebGL); verify visually.
 */
export class Thumbnails {
  private cache = new Map<string, string | null>();
  private gl: THREE.WebGLRenderer | null | undefined;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  private dpr = 1;

  constructor(private meshes: BuildingMeshes, private canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas')) {
    this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x6a5a66, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    sun.position.set(10, 15, 5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.45); // cool fill from the shadow side so dark faces keep their detail at 96px
    fill.position.set(-8, 6, -6);
    this.scene.add(fill);
  }

  private renderer(): THREE.WebGLRenderer | null {
    if (this.gl !== undefined) return this.gl;
    try {
      const c = this.canvasFactory();
      this.gl = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.gl.setClearColor(0x000000, 0);
    } catch (e) {
      console.warn('[thumbnails] WebGL unavailable, using fallback tiles', e);
      this.gl = null;
    }
    return this.gl;
  }

  /** Cached data URL (renders on first request). */
  get(kind: ThumbKind, id: string, size = 96): string | null {
    const key = thumbKey(kind, id, size);
    if (this.cache.has(key)) return this.cache.get(key)!;
    let url: string | null = null;
    try {
      const obj = kind === 'building' ? this.meshes.create(id) : this.liftObject(id as LiftKind);
      url = this.render(obj, size);
    } catch (e) { console.warn('[thumbnails] render failed', key, e); }
    this.cache.set(key, url);
    return url;
  }

  /** Cache-only lookup: never renders (no synchronous WebGL work on hover). */
  peek(kind: ThumbKind, id: string, size = 96): string | null {
    return this.cache.get(thumbKey(kind, id, size)) ?? null;
  }

  private wanted: Array<{ kind: ThumbKind; id: string; size: number }> = [];
  private wantRaf = 0;
  private wantCb: (() => void) | null = null;

  /**
   * On-demand render (M8): a drawer that shows a card whose thumbnail is not cached yet asks for it here; the card renders on the NEXT animation frame
   * (a few ms budget per frame, at least one) instead of waiting for the idle pre-warm, then `onReady` lets the dock swap the fallback icon for the image.
   */
  request(kind: ThumbKind, id: string, size: number, onReady?: () => void): void {
    const key = thumbKey(kind, id, size);
    if (this.cache.has(key) || this.wanted.some((w) => thumbKey(w.kind, w.id, w.size) === key)) return;
    this.wanted.push({ kind, id, size });
    if (onReady) this.wantCb = onReady;
    if (!this.wantRaf && typeof requestAnimationFrame === 'function') this.wantRaf = requestAnimationFrame(() => this.drainWanted());
  }

  private drainWanted(): void {
    this.wantRaf = 0;
    const t0 = performance.now();
    let n = 0;
    while (this.wanted.length && (n === 0 || performance.now() - t0 < 6)) { const it = this.wanted.shift()!; this.get(it.kind, it.id, it.size); n++; }
    this.wantCb?.();
    if (this.wanted.length && typeof requestAnimationFrame === 'function') this.wantRaf = requestAnimationFrame(() => this.drainWanted());
  }

  /** Render the given thumbnails one per idle slot so the first frames and hovers never stall. */
  prewarm(items: ReadonlyArray<{ kind: ThumbKind; id: string; size: number }>, onItem?: () => void): void {
    const queue = items.slice();
    const idle: (cb: () => void) => void = typeof requestIdleCallback === 'function'
      ? (cb) => { requestIdleCallback(() => cb(), { timeout: 500 }); }
      : (cb) => { setTimeout(cb, 16); };
    const step = (): void => {
      const it = queue.shift();
      if (!it) return;
      this.get(it.kind, it.id, it.size);
      onItem?.();
      idle(step);
    };
    idle(step);
  }

  /**
   * Lift drawer icon (M8, one composition per lift family): a family-specific tower with its cable head, the cable running to a LARGE carrier
   * (T-bar pole + bar, open chair with the right seat count, bubble hood, gondola / tram cabin) hanging from it; the funicular is a trestle with
   * rails and a car. The tower + carrier meshes are the in-game ones, so every kind reads differently (seat count, hood, tower style, colour).
   */
  private liftObject(kind: LiftKind): THREE.Group {
    const mat = liftMaterial();
    const glass = liftGlassMaterial();
    const g = new THREE.Group();
    const fam = LIFTS[kind].family;
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    const towerH = fam === 'cablecar' ? 1.9 : fam === 'gondola' ? 1.7 : fam === 'funicular' ? 0.9 : fam === 'tbar' ? 1.5 : 1.5;
    const tower = new THREE.Mesh(buildTowerGeometry(towerH, kind, 0.3, false), mat);
    g.add(tower);
    const scale = fam === 'tbar' ? 2.0 : fam === 'chair' ? 2.1 : fam === 'gondola' ? 1.5 : 1.1;
    const cg = buildCarrierGeometry(kind);
    const car = new THREE.Mesh(cg, glassGroups(cg) ? [mat, glass] : mat);
    car.scale.setScalar(scale);
    if (fam === 'funicular') {
      for (const x of [-0.3, 0.3]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.6), cableMat)).position.set(x, towerH - 0.04, 1.1);
      car.position.set(0, towerH, 1.5);
    } else {
      const cx = 0.3;
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.4), cableMat);
      cable.position.set(cx, towerH, 0.9);
      g.add(cable);
      car.position.set(cx, towerH, 1.5);
    }
    g.add(car);
    return g;
  }

  private render(obj: THREE.Object3D, size: number): string | null {
    const gl = this.renderer();
    if (!gl) return null;
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const centre = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
    this.cam.position.copy(centre).addScaledVector(dir, 100);
    this.cam.lookAt(centre);
    this.cam.updateMatrixWorld(true);
    // Fit the projected bbox corners.
    const inv = this.cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2 * 1.06 || 1;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.cam.left = cx - half; this.cam.right = cx + half; this.cam.top = cy + half; this.cam.bottom = cy - half;
    this.cam.updateProjectionMatrix();
    gl.setPixelRatio(this.dpr);
    gl.setSize(size, size, false);
    gl.render(this.scene, this.cam);
    const url = gl.domElement.toDataURL('image/png');
    this.scene.remove(obj);
    return url;
  }

  dispose(): void { this.gl?.dispose(); this.cache.clear(); }
}
