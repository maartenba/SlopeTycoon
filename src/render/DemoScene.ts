import { DemoCamera, type CameraLike, type Poi } from './DemoCamera';
import { REAL_SECONDS_PER_DAY_1X } from '../config/balance';

/** Real seconds of one in-game day on the title screen (the sim clock itself is unchanged: only the tick rate is scaled). */
export const DEMO_DAY_SECONDS = 100;
/** Real seconds between season changes (winter <-> summer) on the title screen. */
export const DEMO_SEASON_SECONDS = 180;
/** Fade out / in duration (s) around a season jump. */
export const DEMO_FADE_SECONDS = 0.7;

/** Tick-rate multiplier giving `daySeconds` per in-game day at speed 1. */
export const demoTimeScale = (daySeconds: number = DEMO_DAY_SECONDS): number => REAL_SECONDS_PER_DAY_1X / daySeconds;

/** Collects dispose callbacks (geometries, materials, timers, listeners, sims) and runs them once, newest first. */
export class DisposeBag {
  private fns: Array<() => void> = [];
  private done = false;
  get disposed(): boolean { return this.done; }
  get size(): number { return this.fns.length; }
  add(fn: () => void): void { if (this.done) fn(); else this.fns.push(fn); }
  /** Runs every callback (errors are collected, never thrown) and returns them. Idempotent. */
  dispose(): unknown[] {
    if (this.done) return [];
    this.done = true;
    const errs: unknown[] = [];
    for (const fn of this.fns.reverse()) { try { fn(); } catch (e) { errs.push(e); } }
    this.fns = [];
    return errs;
  }
}

interface Disposable { dispose?(): void }
interface Disposing3D { geometry?: Disposable; material?: Disposable | Disposable[]; traverse?(fn: (o: Disposing3D) => void): void }

/** Disposes geometry / materials (and their textures) of everything below `root`; returns how many resources were disposed. */
export function disposeTree(root: Disposing3D): number {
  const seen = new Set<unknown>();
  let n = 0;
  const kill = (d: Disposable | undefined): void => { if (d && !seen.has(d)) { seen.add(d); d.dispose?.(); n++; } };
  const visit = (o: Disposing3D): void => {
    kill(o.geometry);
    const m = o.material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) kill(v as Disposable);
      kill(mat);
    }
  };
  if (root.traverse) root.traverse(visit); else visit(root);
  return n;
}

/** Season-jump state machine (pure): out -> (jump) -> in. */
export class SeasonCycler {
  private t = 0;
  private phase: 'wait' | 'out' | 'in' = 'wait';
  private next: 'summer' | 'winter' = 'summer';
  /** 0..1 black overlay opacity. */
  fade = 0;
  constructor(private period = DEMO_SEASON_SECONDS, private fadeS = DEMO_FADE_SECONDS) {}
  get upcoming(): 'summer' | 'winter' { return this.next; }
  /** Advance by dt seconds; returns the season to jump to when the screen is fully black, else null. */
  update(dt: number): 'summer' | 'winter' | null {
    this.t += dt;
    if (this.phase === 'wait') { if (this.t >= this.period) { this.phase = 'out'; this.t = 0; } return null; }
    if (this.phase === 'out') {
      this.fade = Math.min(1, this.t / this.fadeS);
      if (this.fade >= 1) { this.phase = 'in'; this.t = 0; const s = this.next; this.next = s === 'summer' ? 'winter' : 'summer'; return s; }
      return null;
    }
    this.fade = Math.max(0, 1 - this.t / this.fadeS);
    if (this.fade <= 0) { this.phase = 'wait'; this.t = 0; }
    return null;
  }
}

export interface DemoSceneHost {
  controls: CameraLike & { camera: { top: number; bottom: number } };
  size: number;
  aspect: () => number;
  pois: () => readonly Poi[];
  groundY: (x: number, z: number) => number;
  /** Jump the sim (and every render cache) to this season. */
  jumpSeason: (s: 'summer' | 'winter') => void;
  /** Called every frame (before the camera) so the host can run its own logic. */
  reducedMotion: boolean;
  container: HTMLElement;
  /** Soft blur patch behind the menu card (off for screenshots without a menu). */
  blur?: boolean;
}

/**
 * Title-screen director: camera loop, season cycle with a dark crossfade and a vignette (CSS, behind the menu card). All DOM / timers are
 * owned by the `bag`; `dispose()` removes everything (called when a game starts).
 */
export class DemoScene {
  readonly camera: DemoCamera;
  readonly seasons: SeasonCycler;
  readonly bag = new DisposeBag();
  /** Harness / debugging: freeze the camera director. */
  hold = false;
  /** Harness: disable the automatic season cycle. */
  seasonsEnabled = true;
  private fadeEl: HTMLElement;

  constructor(private host: DemoSceneHost, seed = 7) {
    this.camera = new DemoCamera(host.controls, { size: host.size, aspect: host.aspect, pois: host.pois, groundY: host.groundY, reducedMotion: host.reducedMotion, seed });
    this.seasons = new SeasonCycler();
    const doc = host.container.ownerDocument;
    const vignette = doc.createElement('div');
    vignette.className = 'demo-vignette';
    vignette.setAttribute('aria-hidden', 'true');
    // dim + soft blur behind the centred menu card; the screen corners stay crisp
    vignette.style.cssText = 'position:fixed;inset:0;z-index:20;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(8,14,24,.50) 0%,rgba(8,14,24,.30) 38%,rgba(8,14,24,.10) 70%,rgba(8,14,24,.35) 100%)';
    const blur = doc.createElement('div');
    blur.setAttribute('aria-hidden', 'true');
    blur.style.cssText = 'position:fixed;left:50%;top:50%;width:min(560px,96vw);height:min(640px,90vh);transform:translate(-50%,-50%);z-index:20;pointer-events:none;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);border-radius:28px;-webkit-mask-image:radial-gradient(closest-side,#000 55%,transparent 100%);mask-image:radial-gradient(closest-side,#000 55%,transparent 100%)';
    this.fadeEl = doc.createElement('div');
    this.fadeEl.setAttribute('aria-hidden', 'true');
    this.fadeEl.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;background:#06090f;opacity:0';
    host.container.append(vignette, ...(host.blur === false ? [] : [blur]), this.fadeEl);
    this.bag.add(() => { vignette.remove(); blur.remove(); this.fadeEl.remove(); });
  }

  /** Per-frame update (real seconds). */
  update(dt: number): void {
    if (!this.hold) this.camera.update(dt);
    if (!this.seasonsEnabled) return;
    const jump = this.seasons.update(dt);
    if (jump) this.host.jumpSeason(jump);
    this.fadeEl.style.opacity = this.seasons.fade.toFixed(3);
  }

  dispose(): unknown[] { return this.bag.dispose(); }
}
