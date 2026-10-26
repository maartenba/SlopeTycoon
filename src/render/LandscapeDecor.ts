import * as THREE from 'three';
import { VillageDecor, type DecorItem } from './VillageDecor';
import type { DecorRec, Landscape } from '@/sim/landscape/Landscape';

/** Pure: the player's decor as village-decor items (tile centres; rot 0 = along x, 1 = along y). Same mesh recipes as the village, so walk-mode collision (`decorCircles`) applies unchanged. */
export function landscapeDecorItems(recs: Iterable<DecorRec>): DecorItem[] {
  const out: DecorItem[] = [];
  for (const r of recs) {
    const x = r.x + 0.5, z = r.y + 0.5, ry = r.rot ? Math.PI / 2 : 0;
    switch (r.kind) {
      case 'bench': out.push({ kind: 'bench', x, z, ry: r.rot ? Math.PI / 2 : 0 }); break;
      case 'lamp': out.push({ kind: 'lamp', x, z, ry: 0 }); break;
      case 'flowerBed': out.push({ kind: 'bed', x, z, ry, w: 0.9, d: 0.9 }); break;
      case 'hedge': out.push({ kind: 'hedge', x, z, ry, w: 1 }); break;
      case 'fence': out.push({ kind: 'fence', x, z, ry, w: 1 }); break;
      case 'wall': out.push({ kind: 'wall', x, z, ry, w: 1 }); break;
      case 'fountain': out.push({ kind: 'fountain', x, z, ry: 0 }); break;
    }
  }
  return out;
}

/** Renders the Landscape decor (3 draw calls, rebuilt only when `ls.version` moves). Lamp glass glows at night like the village lamps. */
export class LandscapeDecorView {
  private readonly view: VillageDecor;
  private version = -1;
  constructor(private readonly ls: Landscape, ground: (x: number, z: number) => number) {
    this.view = new VillageDecor(ground);
    this.view.group.name = 'landscapeDecor';
  }
  get group(): THREE.Group { return this.view.group; }
  /** Stable array reference until the decor changes (walk mode caches on it). */
  get items(): readonly DecorItem[] { return this.view.items; }
  setNight(n: number): void { this.view.setNight(n); }
  /** Heights changed under decor (terraforming next to it): rebuild next sync. */
  invalidate(): void { this.version = -1; }
  sync(): boolean {
    if (this.version === this.ls.version) return false;
    this.version = this.ls.version;
    this.view.buildFrom(landscapeDecorItems(this.ls.decor.values()));
    return true;
  }
  dispose(): void { this.view.dispose(); }
}
