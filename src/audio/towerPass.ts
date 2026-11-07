import { TOWER_CLANK } from '../config/audioSamples';
import { zoomWindow } from './proximity';
import { spatialParams, type Listener } from './spatial';

/**
 * Tower clanks: a carrier (chair / cabin / T-bar anchor) passing a lift TOWER close to the camera makes a quiet clank (recorded sheave-train rattles, `towerClank` samples; synth `towerClank` recipe as the fallback).
 * Pure and cheap: no audio nodes here. `TowerPassDetector` finds the pass events from carrier / tower positions (world tiles, the same units as the camera target), `TowerClanker` decides which of them sound
 * (global gap, chance, short one-shot vs the whole 2.8 s passage). Tuning: `TOWER_CLANK` in src/config/audioSamples.ts. Tests: tests/audio/towerPass.test.ts.
 */
export interface TowerLift {
  id: number;
  towers: ReadonlyArray<{ x: number; z: number }>;
  /** Carrier positions now (called lazily, only for the few lifts nearest to the camera). */
  carriers: () => ReadonlyArray<{ x: number; z: number }>;
}
export interface TowerPass { liftId: number; tower: number; x: number; z: number; /** 0..1: (1 - d / reach)^2 x zoom window. */ level: number }

export class TowerPassDetector {
  private inside = new Set<string>();
  private armed = false;
  constructor(private cfg: Pick<typeof TOWER_CLANK, 'maxLifts' | 'enterR' | 'exitR' | 'reach' | 'zoomFar' | 'zoomNear' | 'minLevel'> = TOWER_CLANK) {}

  /** One tick (~10 Hz). Returns the passes that BEGAN since the last tick (a carrier entering a tower's zone; one per carrier and tower until it has left again), nearest-to-camera first. */
  step(lifts: readonly TowerLift[], cam: Pick<Listener, 'x' | 'z'>, zoom: number): TowerPass[] {
    const c = this.cfg, zw = zoomWindow(zoom, c.zoomFar, c.zoomNear);
    if (zw <= 0) { this.inside.clear(); this.armed = false; return []; } // zoomed out: nothing to hear, nothing tracked (cheap)
    const near: Array<{ l: TowerLift; d: number }> = [];
    for (const l of lifts) {
      let best = Infinity;
      for (const t of l.towers) best = Math.min(best, Math.hypot(t.x - cam.x, t.z - cam.z));
      if (best <= c.reach + c.exitR) near.push({ l, d: best });
    }
    near.sort((a, b) => a.d - b.d);
    const out: TowerPass[] = [], now = new Set<string>(), prime = !this.armed; // the first tick after zooming in only records who is already at a tower: no clank storm
    for (const { l } of near.slice(0, c.maxLifts)) {
      const cs = l.carriers();
      l.towers.forEach((t, ti) => {
        const dc = Math.hypot(t.x - cam.x, t.z - cam.z);
        if (dc > c.reach) return;
        const level = Math.pow(1 - dc / c.reach, 2) * zw;
        for (let ci = 0; ci < cs.length; ci++) {
          const k = `${l.id}:${ti}:${ci}`, d = Math.hypot(cs[ci]!.x - t.x, cs[ci]!.z - t.z), was = this.inside.has(k);
          if (d < c.enterR || (was && d < c.exitR)) {
            now.add(k);
            if (!was && !prime && level >= c.minLevel) out.push({ liftId: l.id, tower: ti, x: t.x, z: t.z, level });
          }
        }
      });
    }
    this.inside = now; this.armed = true;
    return out.sort((a, b) => b.level - a.level);
  }
  /** Debug / tests. */
  get tracked(): number { return this.inside.size; }
  reset(): void { this.inside.clear(); this.armed = false; }
}

export interface ClankPlay { gain: number; pan: number; tag: 'short' | 'pass' }

/** Which pass sounds: at most one per `globalGap` s (audio clock) anywhere, `chance` per candidate tick, the whole passage with probability `passShare`. */
export class TowerClanker {
  private last = -Infinity;
  /** Counts for the census / tests. */
  readonly played = { short: 0, pass: 0 };
  constructor(private rng: () => number, private cfg: Pick<typeof TOWER_CLANK, 'globalGap' | 'chance' | 'passShare' | 'gainNear' | 'gainFar'> = TOWER_CLANK) {}
  pick(passes: readonly TowerPass[], listener: Listener, now: number): ClankPlay | null {
    if (!passes.length || now - this.last < this.cfg.globalGap) return null;
    if (this.rng() >= this.cfg.chance) return null;
    const p = passes[0]!, tag = this.rng() < this.cfg.passShare ? 'pass' : 'short';
    this.last = now; this.played[tag]++;
    return { gain: this.cfg.gainFar + (this.cfg.gainNear - this.cfg.gainFar) * Math.min(1, p.level * 2), pan: spatialParams(listener, p.x, p.z, 14).pan, tag };
  }
}
