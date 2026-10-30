import { FISH } from '../../config/balance';

/**
 * Fish stock per water body (Phase 6 Task 49, docs/anglers.md). Pure sim data: no three / DOM.
 *
 * A water body is a lake (`l<i>`), a player pond (`p<id>`), a natural stream (`n<i>`) or a dug river (`r<id>`; the same ids as the flow model for ways).
 * `stock` is 0..1 and is created lazily at `FISH.initial` the first time somebody fishes there, so a world without a Tackle hut has NO stock state
 * (the save module is `null`, left out of stateHash). Regrowth is logistic per day (rivers with Q >= 1 faster, frozen water none); a catch costs
 * `depleteKeep` (Keep) or `depleteRelease` (Catch & release), scaled by how small the water is.
 */
export type FishKind = 'lake' | 'pond' | 'stream' | 'river';
export interface FishBody {
  key: string;
  kind: FishKind;
  /** Inspector / advisor name ("Lake 2", "River 1"). */
  name: string;
  /** Tile indices (y * N + x) of the water (lake / pond footprint, stream / river path). */
  tiles: number[];
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** How big a water body is for depletion: lakes / ponds = tiles, rivers / streams count 2.5 per path tile (a flowing water refills from upstream). */
export const bodySize = (b: Pick<FishBody, 'kind' | 'tiles'>): number => (b.kind === 'lake' || b.kind === 'pond' ? b.tiles.length : Math.round(b.tiles.length * 2.5));
/** Small waters deplete faster (0.25 .. 2 x). */
export const sizeFactor = (size: number): number => Math.min(2, Math.max(0.25, FISH.sizeRef / Math.max(1, size)));

export interface FishStockSave { s: Array<[string, number]> }

export class FishStock {
  private stock = new Map<string, number>();

  has(key: string): boolean { return this.stock.has(key); }
  /** Current stock (the untouched initial value for a water nobody has fished). */
  get(key: string): number { return this.stock.get(key) ?? FISH.initial; }
  set(key: string, v: number): void { this.stock.set(key, r4(clamp01(v))); }
  /** Number of waters that have been fished (tracked). */
  get tracked(): number { return this.stock.size; }

  /** One cast: `u` in [0,1) (sim rng). Returns true for a fish; the stock drops per `keep` (kept) or release. */
  cast(key: string, size: number, keep: boolean, u: number): boolean {
    const s = this.get(key);
    if (u >= FISH.catchBase + FISH.catchSlope * s) return false;
    this.set(key, s - (keep ? FISH.depleteKeep : FISH.depleteRelease) * sizeFactor(size));
    return true;
  }

  /** Daily regrowth of every tracked body. `frozen(key)` = no growth; `flow(key)` = season discharge of a river / stream (>= 1 grows faster). */
  newDay(frozen: (key: string) => boolean = () => false, flow: (key: string) => number = () => 0): void {
    for (const [k, s] of this.stock) {
      if (frozen(k)) continue;
      const rate = FISH.regrow * (k[0] === 'r' || k[0] === 'n' ? (flow(k) >= 1 ? FISH.riverRegrow : 1) : 1);
      this.stock.set(k, r4(clamp01(s + rate * s * (1 - s) + FISH.floor * (1 - s))));
    }
  }

  /** Mean stock of the tracked bodies; null = nothing fished yet. */
  mean(): number | null {
    if (!this.stock.size) return null;
    let t = 0; for (const v of this.stock.values()) t += v;
    return t / this.stock.size;
  }
  /** The most depleted tracked body (key + stock); null = none tracked. */
  lowest(): { key: string; stock: number } | null {
    let best: { key: string; stock: number } | null = null;
    for (const [key, stock] of this.stock) if (!best || stock < best.stock || (stock === best.stock && key < best.key)) best = { key, stock };
    return best;
  }
  /** Tracked bodies below the "Overfished" mark (or `limit`), in key order. */
  overfished(limit: number = FISH.overfished): Array<{ key: string; stock: number }> {
    return [...this.stock].filter(([, v]) => v < limit).map(([key, stock]) => ({ key, stock })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  /** Sustainability facet points (+/- FISH.sustainMax): healthy stocks help a little, overfished waters hurt. 0 while nothing has been fished. */
  sustainPoints(): number {
    const m = this.mean();
    if (m === null) return 0;
    return Math.round(Math.min(FISH.sustainMax, Math.max(-FISH.sustainMax, (m - FISH.sustainMid) * FISH.sustainK)) * 100) / 100;
  }

  serialize(): FishStockSave | null { return this.stock.size ? { s: [...this.stock].sort((a, b) => (a[0] < b[0] ? -1 : 1)) } : null; }
  load(d: unknown): void {
    this.stock.clear();
    const o = d as FishStockSave | null | undefined;
    if (o?.s) for (const [k, v] of o.s) this.stock.set(k, r4(clamp01(v)));
  }
  reset(): void { this.stock.clear(); }
}

/* ------------------------------------------------------------------ spots + reach (pure helpers, shared by the sim and the renderer) */

export interface HutLike { x: number; y: number; w: number; h: number }
const centre = (b: HutLike): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Water bodies (in key order) with at least one tile within `radius` of the hut centre; ice rules via `usable`. */
export function reachable(hut: HutLike, bodies: ReadonlyArray<FishBody>, size: number, usable: (b: FishBody) => boolean, radius: number = FISH.radius): FishBody[] {
  const c = centre(hut), r2 = radius * radius;
  const out: FishBody[] = [];
  for (const b of bodies) {
    if (!usable(b)) continue;
    for (const t of b.tiles) { const dx = (t % size) + 0.5 - c.x, dy = Math.floor(t / size) + 0.5 - c.y; if (dx * dx + dy * dy <= r2) { out.push(b); break; } }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Is a hut within `FISH.nearWater` tiles of the water (any tile of any body)? The placement rule of the hut. */
export function nearWater(hut: HutLike, bodies: ReadonlyArray<FishBody>, size: number): boolean {
  const x0 = hut.x - FISH.nearWater, x1 = hut.x + hut.w - 1 + FISH.nearWater, y0 = hut.y - FISH.nearWater, y1 = hut.y + hut.h - 1 + FISH.nearWater;
  for (const b of bodies) for (const t of b.tiles) { const x = t % size, y = Math.floor(t / size); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true; }
  return false;
}

/** Nearest tile of a body to a point: squared distance and the heading (atan2 dy, dx) towards it. */
function nearest(x: number, y: number, b: FishBody, size: number): { d: number; heading: number } {
  let d = Infinity, hx = 1, hy = 0;
  for (const t of b.tiles) { const dx = (t % size) + 0.5 - x, dy = Math.floor(t / size) + 0.5 - y, q = dx * dx + dy * dy; if (q < d) { d = q; hx = dx; hy = dy; } }
  return { d, heading: Math.atan2(hy, hx) };
}

export interface Spot { x: number; y: number; /** 'pier' (fishing pier), 'bank' (shore tile beside a path) or 'ice' (on the frozen water, ice fishing). */ kind: 'pier' | 'bank' | 'ice'; body: string; /** Direction (radians, atan2(dy, dx) in tile space) from the spot to the water: the cast. View only. */ heading: number }

/**
 * Fishing places a hut can use: the pier slots (4 per pier within reach, each pier fishes the nearest reachable lake / pond) + bank spots (a shore tile
 * of a reachable body with a path / trail tile as 4-neighbour (on ice: any shore tile, standing on the ice); at most `FISH.bankSpotsMax`, nearest to the hut first). Deterministic order.
 */
export function spotsFor(hut: HutLike, reach: ReadonlyArray<FishBody>, piers: ReadonlyArray<HutLike>, size: number, isWalk: (x: number, y: number) => boolean, ice = false): Spot[] {
  const c = centre(hut), out: Spot[] = [];
  const near = (x: number, y: number, b: FishBody): number => nearest(x, y, b, size).d;
  for (const p of [...piers].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const pc = centre(p);
    if (Math.hypot(pc.x - c.x, pc.y - c.y) > FISH.radius) continue;
    let best: FishBody | undefined, bd = 9; // a pier sits on the shore: its water is within ~3 tiles
    for (const b of reach) if (b.kind === 'lake' || b.kind === 'pond') { const d = near(pc.x, pc.y, b); if (d < bd) { bd = d; best = b; } }
    if (!best) continue;
    const hd = nearest(pc.x, pc.y, best, size).heading;
    for (let k = 0; k < FISH.pierSlots; k++) out.push({ x: pc.x + (k % 2 ? 0.25 : -0.25), y: pc.y + (k < 2 ? -0.25 : 0.25), kind: 'pier', body: best.key, heading: hd });
  }
  const bank: Array<Spot & { d: number }> = [];
  const seen = new Set<number>();
  for (const b of reach) {
    const set = new Set(b.tiles);
    for (const t of b.tiles) {
      const x = t % size, y = Math.floor(t / size);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy, ni = ny * size + nx;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || set.has(ni) || seen.has(ni) || (!ice && !isWalk(nx, ny))) continue; // ice fishing walks out from any shore tile
        const d = (nx + 0.5 - c.x) ** 2 + (ny + 0.5 - c.y) ** 2;
        if (d > FISH.radius * FISH.radius) continue;
        seen.add(ni); bank.push(ice ? { x: x + 0.5, y: y + 0.5, kind: 'ice', body: b.key, heading: Math.atan2(y - ny, x - nx), d } : { x: nx + 0.5, y: ny + 0.5, kind: 'bank', body: b.key, heading: Math.atan2(-dy, -dx), d });
      }
    }
  }
  bank.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const s of bank.slice(0, FISH.bankSpotsMax)) out.push({ x: s.x, y: s.y, kind: s.kind, body: s.body, heading: s.heading });
  return out;
}
