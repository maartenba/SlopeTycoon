/**
 * Lazily rebuilt run network (docs/runs.md): derives `world/Runs.ts` from the piste layer + lift stations whenever the Networks version or the set
 * of station positions changes. Deterministic and observer-free: nothing here is saved (names/closed flags live in Names / RunSettings).
 */
import { buildRuns, type Run, type RunNetwork } from '../world/Runs';
import type { Networks } from '../world/Networks';
import { Layer } from '../world/Networks';
import type { Pt } from './Dependencies';
import { RUN_LABEL_NODE } from './Coverage';

export interface RunIndexDeps {
  networks: Pick<Networks, 'size' | 'layers' | 'difficulty' | 'version' | 'disconnectedMask'>;
  /** World-unit altitude of a tile index (mean corner height). */
  alt(i: number): number;
  /** Lift station footprint centres (tile coordinates). */
  stations(): ReadonlyArray<Pt>;
}

export class RunIndex {
  private cache: { v: number; key: string; net: RunNetwork } | null = null;
  /** Bumps every rebuild (UI / caches). */
  rebuilds = 0;
  constructor(private d: RunIndexDeps) {}

  network(): RunNetwork {
    const n = this.d.networks, st = this.d.stations();
    const key = st.map((p) => `${p.x},${p.y}`).join(';');
    if (this.cache && this.cache.v === n.version && this.cache.key === key) return this.cache.net;
    const size = n.size, mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) if (n.layers[i]! & Layer.Ski) mask[i] = 1;
    const net = buildRuns({ size, mask, alt: (i) => this.d.alt(i), difficulty: n.difficulty, stations: st });
    const dis = n.disconnectedMask();
    for (const r of net.runs) r.disconnected = r.tiles.length > 0 && dis[r.tiles[0]!] === 1;
    this.cache = { v: n.version, key, net };
    this.rebuilds++;
    return net;
  }
  private labels: { net: RunNetwork; map: Uint16Array } | null = null;
  /** Per tile: run index + 1 (node tiles: RUN_LABEL_NODE), 0 = no piste. For the 'runs' overlay. */
  labelMap(): Uint16Array {
    const net = this.network();
    if (this.labels?.net === net) return this.labels.map;
    const map = new Uint16Array(net.size * net.size);
    for (let i = 0; i < map.length; i++) map[i] = net.runOf[i]! >= 0 ? Math.min(RUN_LABEL_NODE - 1, net.runOf[i]! + 1) : net.nodeOf[i]! >= 0 ? RUN_LABEL_NODE : 0;
    this.labels = { net, map };
    return map;
  }
  runs(): Run[] { return this.network().runs; }
  runOfTile(tile: number): Run | null { return this.network().runAt(tile); }
}
