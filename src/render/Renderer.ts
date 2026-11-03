import * as THREE from 'three';
import { CameraController, type IsoPose } from './CameraController';
import { ViewCameraRig } from './view/ViewCameraRig';
import { ViewModeMachine } from './view/ViewMode';
import { ViewFog, fogDensityFor, fogRangeFor } from './Fog';
import { ShadowRig } from './ShadowRig';
import { QUALITY_PRESETS, pixelRatioFor, type GraphicsQuality } from '../config/balance';

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly controls: CameraController;
  /** Perspective camera for the ground-level views (ride / photo). */
  readonly rig = new ViewCameraRig();
  readonly viewMode = new ViewModeMachine();
  readonly fog: ViewFog;
  private isoSaved: IsoPose | null = null;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** High-tier sun shadows (docs/shadows.md): own depth pass; terrain, buildings, props, trees receive; iso + ride / photo / walk. Off (no cost, no shader define) on low / med. */
  readonly shadows: ShadowRig;
  /** Per-frame inputs of the shadow pass (set by main.ts from Lighting / the terrain): sun direction, night 0..1, overcast 0..1, ground height under the focus, terrain y range. */
  shadowFeed: ((x: number, z: number) => { sunDir: [number, number, number]; night: number; overcast: number; groundY: number; heights: [number, number] }) | null = null;
  private shadowFocus = new THREE.Vector3();
  quality: GraphicsQuality = 'med';
  private raf = 0;
  private last = 0;
  private onResize = (): void => this.resize();
  /** Runs after the iso controls and BEFORE `onFrame` (the ride rig positions its camera here so every per-frame consumer sees the final pose). */
  preFrame: ((dt: number) => void) | null = null;
  onFrame: ((dt: number) => void) | null = null;
  /** Runs first every animation frame (fast-forward steps the sim here). Returns true to SKIP drawing this frame (no controls / onFrame / render). */
  preSim: ((dt: number) => boolean) | null = null;

  private mapSize: number;

  constructor(private container: HTMLElement, mapSize: number) {
    this.mapSize = mapSize;
    this.webgl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = false; // three's own shadow maps stay off: the custom shaders cannot sample them; see ShadowRig
    this.shadows = new ShadowRig(this.webgl, this.scene);
    container.appendChild(this.webgl.domElement);
    this.scene.background = new THREE.Color(0xa9d4f5);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6a5a66, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    this.sun.position.set(mapSize, mapSize * 1.5, mapSize * 0.5);
    this.scene.add(this.sun);
    this.controls = new CameraController(this.webgl.domElement, mapSize);
    this.rig.setMapSize(mapSize);
    this.fog = new ViewFog(this.scene);
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  /** The camera everything renders / culls with: the iso orthographic camera, or the perspective rig in ground-level views. */
  get camera(): THREE.Camera { return this.viewMode.isIso ? this.controls.camera : this.rig.camera; }

  /**
   * Switch to a ground-level view (`ride` | `photo` | `walk`): freezes the iso controls (remembering the exact pose) and turns the fog on.
   * False for an illegal transition. `exitToIso` restores the saved pose exactly.
   */
  enterGround(mode: 'ride' | 'photo' | 'walk'): boolean {
    const from = this.viewMode.mode;
    if (!this.viewMode.set(mode)) return false;
    if (from === 'iso') this.isoSaved = this.controls.freeze();
    this.applyGroundFog();
    this.rig.reset();
    return true;
  }

  /** Ground-level fog range multiplier (graphics preset). */
  private fogRangeScale = 1;
  setGroundFogScale(k: number): void { this.fogRangeScale = Math.max(0.3, k); if (!this.viewMode.isIso) this.applyGroundFog(); }
  private applyGroundFog(): void { this.fog.setDensity(fogDensityFor(fogRangeFor(this.mapSize) * this.fogRangeScale)); }

  exitToIso(): boolean {
    if (!this.viewMode.set('iso')) return false;
    this.fog.setDensity(0);
    if (this.isoSaved) { this.controls.thaw(this.isoSaved); this.isoSaved = null; }
    return true;
  }

  /**
   * Graphics quality: pixel ratio (capped by the preset) and shadows. LOD / density / particle scales are applied by the owner
   * of those layers (main.ts) from the same preset. `shadows` (High only) turns on the ShadowRig depth pass + the terrain's shadow sampling.
   */
  setQuality(q: GraphicsQuality): void {
    this.quality = q;
    this.webgl.setPixelRatio(pixelRatioFor(q, window.devicePixelRatio));
    this.setShadows(QUALITY_PRESETS[q].shadows);
    this.resize();
  }

  setShadows(on: boolean): void { this.shadows.setEnabled(on); }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.webgl.setSize(w, h);
    this.controls.setAspect(w / h);
    this.rig.setAspect(w / h);
  }

  start(): void {
    const loop = (t: number): void => {
      const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
      this.last = t;
      if (!(this.preSim?.(dt) ?? false)) {
        this.controls.update(dt);
        this.preFrame?.(dt);
        this.onFrame?.(dt);
        if (this.shadows.enabled && this.shadowFeed) {
          const iso = this.viewMode.isIso, fx = iso ? this.controls.target.x : this.rig.camera.position.x, fz = iso ? this.controls.target.z : this.rig.camera.position.z;
          const f = this.shadowFeed(fx, fz);
          this.shadowFocus.set(fx, f.groundY, fz);
          try { this.shadows.update(dt, true, this.camera, this.shadowFocus, f.sunDir, f.night, f.overcast, f.heights); }
          catch (e) { console.error('[shadows] disabled after an error', e); this.shadows.setEnabled(false); } // never let the optional pass take the frame loop down
        }
        this.webgl.render(this.scene, this.camera);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }
}
