import { AMB, SHELTER, shelterFromTrunks, type AmbienceState } from './Ambience';
import { PropKind, type PropStore } from '../world/Props';
import { nearestSource, proximity, spatialParams, type Listener } from './spatial';
import { CHUNK_SIZE, isWaterType, TileType, type Grid } from '../world/Grid';
import { PROX } from '../config/audioProximity';
import { FARM_WORK } from '../config/farmWork';
import { apresProximity } from './proximity';
import type { SeasonId, WeatherKind } from '../core/events';

export interface ProbeDeps {
  grid: Grid;
  /** Guest positions (tile coords) + the SpatialHash for density queries. */
  guests: { count(x: number, y: number, r: number): number };
  lifts: () => Array<{ x: number; y: number }>;
  /** Open lifts that have towers + their carriers (tower clanks, towerPass.ts). Optional: absent = no clanks. */
  towerLifts?: () => import('./towerPass').TowerLift[];
  /** Station centres (and the line midpoint) of the OPEN gondola / cable car / funicular lifts, tagged with the family (per-kind recorded beds). Optional: absent = none. */
  stationSources?: () => Array<{ x: number; y: number; family: 'gondola' | 'cablecar' | 'funicular' }>;
  buildings: () => Array<{ x: number; y: number }>;
  cows: () => Array<{ x: number; y: number }>;
  cats: () => Array<{ x: number; y: number }>;
  helis: () => Array<{ x: number; y: number }>;
  /** Quad tour carriers out on their ride (optional: absent = none). */
  quads?: () => Array<{ x: number; y: number }>;
  /** Horse sleigh carriers out on their ride (optional: absent = none). */
  sleighs?: () => Array<{ x: number; y: number }>;
  /** Farm tractors out working (optional: absent = none; summer farm vehicles). */
  tractors?: () => Array<{ x: number; y: number }>;
  /** Open campgrounds (centre tile; the fire crackles in the evening). Optional: absent = none. */
  campfires?: () => Array<{ x: number; y: number }>;
  /** Mountain concert stages while an event runs (centre tile). Optional: absent = none. */
  concerts?: () => Array<{ x: number; y: number }>;
  /** Carnival parade streets while it runs (chain centre tile; M7.4). Optional: absent = none. */
  carnivals?: () => Array<{ x: number; y: number }>;
  /** Snowmaking cannons that are RUNNING (centre tile; the recorded cannon hiss only near them). Optional: absent = none. */
  cannons?: () => Array<{ x: number; y: number }>;
  /** OPEN, serving Apres-Ski Bars (centre tile): closed / outside-hours bars are left out, so they never sound. Optional: absent = none. */
  apresBars?: () => Array<{ x: number; y: number }>;
  /** Flow class (0 calm, 1 brisk, 2 rapids) of the stream tile at (x, y). Optional: absent = brisk. */
  streamClassAt?: (x: number, y: number) => number;
  /** Tree trunks within r tiles of (x, z) (walk-mode wind shelter; optional). */
  trunks?: (x: number, z: number, r: number) => number;
  /** World height (render units) at a tile. */
  heightAt: (x: number, y: number) => number;
  maxHeight: number;
  env: () => { season: SeasonId; weather: WeatherKind; hour: number; wind: number; sunrise?: number; sunset?: number; /** Global river / pond ice. */ iceFrozen?: boolean; /** Total guests in the resort (music busy-ness) and whether a festival is on. */ guests?: number; festival?: boolean };
}

const LISTEN_TILES = 28;

/** Samples the sim around the camera target into an AmbienceState. Runs at ~10 Hz; O(radius²/4) tile reads, no allocation besides the result. */
export class WorldProbe {
  private out: AmbienceState = { season: 'winter', weather: 'clear', hour: 12, zoom: 36, altitude: 0, wind: 0, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
  /** Pan of the nearest active lift for clanks. */
  liftPan = 0;
  constructor(private d: ProbeDeps) {}

  sample(l: Listener, zoom: number): AmbienceState {
    const o = this.out, d = this.d, e = d.env();
    o.season = e.season; o.weather = e.weather; o.hour = e.hour; o.sunrise = e.sunrise; o.sunset = e.sunset; o.wind = e.wind; o.zoom = zoom;
    const r = Math.min(LISTEN_TILES, Math.max(8, zoom * 0.6));
    o.altitude = d.maxHeight > 0 ? Math.min(1, Math.max(0, d.heightAt(l.x, l.z) / d.maxHeight)) : 0;
    o.crowd = d.guests.count(l.x, l.z, r);
    // water: fraction of sampled tiles within r/2 that are water, mapped so a few tiles already register
    const g = d.grid, wr = Math.min(10, Math.max(4, Math.floor(r / 2)));
    let wet = 0, tot = 0;
    for (let dy = -wr; dy <= wr; dy += 2) for (let dx = -wr; dx <= wr; dx += 2) {
      const x = Math.floor(l.x) + dx, y = Math.floor(l.z) + dy;
      if (!g.inBounds(x, y)) continue;
      tot++;
      if (isWaterType(g.tileType[g.tileIndex(x, y)]!)) wet++;
    }
    o.water = tot ? Math.min(1, (wet / tot) * 4) : 0;
    // streams / rivers: nearest Stream tile within PROX.stream.reach, scanned only while zoomed in enough to hear it (cheap: <= 25 x 25 reads at ~10 Hz)
    o.streamDist = Infinity; o.streamCls = 1; o.iceFrozen = !!e.iceFrozen;
    if (zoom < PROX.stream.zoomFar && !o.iceFrozen) {
      const reach = Math.ceil(PROX.stream.reach), cx = Math.floor(l.x), cy = Math.floor(l.z);
      let best = Infinity, bx = 0, by = 0;
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!g.inBounds(x, y) || g.tileType[g.tileIndex(x, y)] !== TileType.Stream) continue;
        const dd = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.z);
        if (dd < best) { best = dd; bx = x; by = y; }
      }
      if (best < Infinity) { o.streamDist = best; o.streamCls = d.streamClassAt ? d.streamClassAt(bx, by) : 1; }
    }
    o.shelter = d.trunks && o.zoom <= AMB.walkZoom + 1 ? shelterFromTrunks(d.trunks(l.x, l.z, SHELTER.radius)) : 0; // only the walker's near-field view hears the forest shelter
    const lift = nearestSource(l, d.lifts());
    o.lifts = lift ? proximity(lift.dist, 40) : 0;
    this.liftPan = lift ? spatialParams(l, lift.item.x, lift.item.y, 14).pan : 0;
    o.gondola = 0; o.cablecar = 0; o.funicular = 0;
    if (d.stationSources) for (const st of d.stationSources()) { const p = proximity(Math.hypot(st.x - l.x, st.y - l.z), PROX.stations.reach); if (p > o[st.family]!) o[st.family] = p; }
    const b = nearestSource(l, d.buildings()); o.buildings = b ? proximity(b.dist, 35) : 0;
    let cows = 0;
    for (const c of d.cows()) if (Math.hypot(c.x - l.x, c.y - l.z) < 30) cows++;
    o.cows = cows;
    const cat = nearestSource(l, d.cats()); o.snowcat = cat ? 0.3 + 0.7 * proximity(cat.dist, 60) : 0;
    const heli = nearestSource(l, d.helis()); o.heli = heli ? 0.4 + 0.6 * proximity(heli.dist, 80) : 0;
    const fire = d.campfires ? nearestSource(l, d.campfires()) : null; o.campfire = fire ? proximity(fire.dist, 14) : 0;
    const concert = d.concerts ? nearestSource(l, d.concerts()) : null; o.concert = concert ? proximity(concert.dist, 30) : 0;
    const carn = d.carnivals ? nearestSource(l, d.carnivals()) : null; o.carnival = carn ? proximity(carn.dist, 24) : 0;
    o.apres = d.apresBars ? apresProximity(d.apresBars().map((b) => Math.hypot(b.x - l.x, b.y - l.z))) : 0;
    const cannon = d.cannons ? nearestSource(l, d.cannons()) : null; o.cannon = cannon ? proximity(cannon.dist, 14) : 0;
    const quad = d.quads ? nearestSource(l, d.quads()) : null; o.quad = quad ? 0.3 + 0.7 * proximity(quad.dist, 40) : 0;
    const sleigh = d.sleighs ? nearestSource(l, d.sleighs()) : null; o.sleigh = sleigh ? 0.3 + 0.7 * proximity(sleigh.dist, 30) : 0;
    const tr = d.tractors ? nearestSource(l, d.tractors()) : null; o.tractor = tr ? proximity(tr.dist, FARM_WORK.audioReach) : 0;
    return o;
  }
}

/** Guests within ~r tiles of (x,y) from SpatialHash cell counts (cell-granular: no per-guest loop). */
export function hashCount(hash: { cell: number; cells: number; countAt(x: number, y: number): number }, x: number, y: number, r: number): number {
  let n = 0;
  const c = hash.cell, max = hash.cells * c - 1;
  for (let yy = Math.max(0, y - r); yy <= Math.min(max, y + r + c); yy += c) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(max, x + r + c); xx += c) if (Math.hypot(xx - x, yy - y) <= r + c) n += hash.countAt(xx, yy);
  }
  return n;
}

const TREE_KINDS = new Set<number>([PropKind.Conifer, PropKind.Deciduous, PropKind.Pine, PropKind.Larch, PropKind.Birch, PropKind.Oak, PropKind.Snag]);
/** Tree trunks (not rocks / shrubs) within `r` tiles of (x, z). Walks only the prop chunks the circle touches. */
export function countTrunks(props: Pick<PropStore, 'chunks' | 'chunksPerRow'>, x: number, z: number, r: number, chunkSize = CHUNK_SIZE): number {
  const cx0 = Math.max(0, Math.floor((x - r) / chunkSize)), cx1 = Math.min(props.chunksPerRow - 1, Math.floor((x + r) / chunkSize));
  const cy0 = Math.max(0, Math.floor((z - r) / chunkSize)), cy1 = Math.min(props.chunksPerRow - 1, Math.floor((z + r) / chunkSize));
  let n = 0;
  const r2 = r * r;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const c = props.chunks[cy * props.chunksPerRow + cx];
    if (!c) continue;
    for (let i = 0; i < c.kind.length; i++) {
      if (!TREE_KINDS.has(c.kind[i]!)) continue;
      const dx = c.tx[i]! + c.ox[i]! - x, dz = c.ty[i]! + c.oy[i]! - z;
      if (dx * dx + dz * dz <= r2) n++;
    }
  }
  return n;
}
