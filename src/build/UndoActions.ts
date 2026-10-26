import type { Sim } from '../game/createSim';
import type { Grid } from '../world/Grid';
import { CHUNK_SIZE } from '../world/Grid';
import type { PropChunk, PropStore } from '../world/Props';
import { LIFT_STATION_SIZE } from '../config/balance';
import { displayName } from '../ui/text';
import { placeBuilding, type PlaceOutcome } from '../sim/PlaceBuilding';
import type { LiftKind } from '../config/lifts';
import { placeLift, type LiftData, type LiftPlaceOutcome, type StationSite } from '../sim/Lift';
import { footprintOf, type PlacedBuilding } from '../sim/Buildings';
import { GState } from '../sim/guests/Guest';
import type { InstanceSave } from '../sim/attractions/Attraction';
import type { TileSnap } from '../world/Networks';
import { bulldoze, type BulldozeResult } from './Bulldoze';
import { UndoStack, type UndoApplied, type UndoCommand, type UndoReport } from './UndoStack';

/** The slice of the sim that undo needs (headless-friendly: no DOM, no three). */
export type UndoEnv = Pick<Sim, 'grid' | 'props' | 'buildings' | 'lifts' | 'networks' | 'economy' | 'names' | 'attractions' | 'guestSim' | 'game'> & { gate?: Sim['gate'] };

interface Rect { x0: number; y0: number; x1: number; y1: number }
const MARGIN = 10; // auto-flatten reaches ~10 tiles beyond the footprint (FlattenPlanner margin)

const clampRect = (g: Grid, r: Rect): Rect => ({ x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(g.size - 1, r.x1), y1: Math.min(g.size - 1, r.y1) });
const cloneChunk = (c: PropChunk): PropChunk => ({ kind: [...c.kind], tx: [...c.tx], ty: [...c.ty], ox: [...c.ox], oy: [...c.oy], scale: [...c.scale], rot: [...c.rot], seed: [...c.seed], born: [...c.born] });
const sameChunk = (a: PropChunk, b: PropChunk): boolean => JSON.stringify(a) === JSON.stringify(b);
const chunksOf = (g: Grid, r: Rect): number[] => {
  const out: number[] = [];
  for (let cy = Math.floor(r.y0 / CHUNK_SIZE); cy <= Math.floor(r.y1 / CHUNK_SIZE); cy++) for (let cx = Math.floor(r.x0 / CHUNK_SIZE); cx <= Math.floor(r.x1 / CHUNK_SIZE); cx++) out.push(cy * g.chunksPerRow + cx);
  return out;
};

/**
 * What a placement did to the terrain: the vertices auto-flatten moved (from -> to) and the prop chunks that lost trees/rocks.
 * Recorded as an exact diff so undo restores the heights/props from BEFORE the placement; `stale()` says when the world moved on
 * (somebody terraformed, planted or built there since), in which case undo is refused instead of corrupting the map.
 */
class TerrainDelta {
  private verts: Array<{ i: number; from: number; to: number }> = [];
  private chunks: Array<{ ci: number; pre: PropChunk; post: PropChunk }> = [];
  private netSig = '';
  private constructor(private readonly g: Grid, private readonly props: PropStore | undefined, private readonly net: UndoEnv['networks'],
    private readonly preH: Map<number, number>, private readonly preChunks: Map<number, PropChunk>) {}

  static capture(g: Grid, props: PropStore | undefined, net: UndoEnv['networks'], heightRects: Rect[], propRect: Rect): TerrainDelta {
    const preH = new Map<number, number>();
    for (const r0 of heightRects) {
      const r = clampRect(g, r0);
      for (let vy = r.y0; vy <= r.y1 + 1; vy++) for (let vx = r.x0; vx <= r.x1 + 1; vx++) { const i = vy * g.vsize + vx; preH.set(i, g.heights[i]!); }
    }
    const preChunks = new Map<number, PropChunk>();
    if (props) for (const ci of chunksOf(g, clampRect(g, propRect))) preChunks.set(ci, cloneChunk(props.chunks[ci]!));
    return new TerrainDelta(g, props, net, preH, preChunks);
  }

  /** Call right after the action: records what changed. */
  seal(): void {
    for (const [i, from] of this.preH) { const to = this.g.heights[i]!; if (to !== from) this.verts.push({ i, from, to }); }
    for (const [ci, pre] of this.preChunks) { const post = this.props!.chunks[ci]!; if (!sameChunk(pre, post)) this.chunks.push({ ci, pre, post: cloneChunk(post) }); }
    this.netSig = this.netSigNow();
    this.preH.clear(); this.preChunks.clear();
  }

  /** Network state on the tiles around moved vertices (a road laid on the levelled pad since would be re-sloped by the revert). */
  private netSigNow(): string {
    const seen = new Set<number>(), out: string[] = [];
    for (const v of this.verts) {
      const vx = v.i % this.g.vsize, vy = (v.i / this.g.vsize) | 0;
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) {
        if (!this.g.inBounds(tx, ty)) continue;
        const t = ty * this.g.size + tx;
        if (seen.has(t)) continue;
        seen.add(t);
        if (this.net.kind[t] || this.net.layers[t]) out.push(`${t}:${this.net.kind[t]}:${this.net.layers[t]}`);
      }
    }
    return out.join(',');
  }

  get changedVertices(): number { return this.verts.length; }

  stale(): string | null {
    for (const v of this.verts) if (this.g.heights[v.i] !== v.to) return 'The terrain has changed since';
    for (const c of this.chunks) if (!sameChunk(this.props!.chunks[c.ci]!, c.post)) return 'The terrain has changed since (trees or rocks moved)';
    if (this.netSigNow() !== this.netSig) return 'A path, road or piste was built on the levelled ground since';
    return null;
  }

  /** Put the heights and props back as they were before the action. Returns the touched chunk indices. */
  revert(): number[] {
    const touched = new Set<number>();
    for (let k = this.verts.length - 1; k >= 0; k--) {
      const v = this.verts[k]!, vx = v.i % this.g.vsize, vy = (v.i / this.g.vsize) | 0;
      this.g.setCornerUnchecked(vx, vy, v.from);
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) if (this.g.inBounds(tx, ty)) touched.add(Math.floor(ty / CHUNK_SIZE) * this.g.chunksPerRow + Math.floor(tx / CHUNK_SIZE));
    }
    for (const c of this.chunks) { this.props!.chunks[c.ci] = cloneChunk(c.pre); this.props!.chunkVersion[c.ci]!++; touched.add(c.ci); }
    return [...touched];
  }
}

/** Absolute in-game day (year-aware, so 'same day' also holds across New Year). */
export const absDay = (g: UndoEnv['game']): number => g.date.year * 10000 + g.date.day;

export type { UndoReport };

/** Records placements / bulldozes as undo commands. One instance per game; the UI calls these instead of the raw sim functions. */
export class Undo {
  readonly stack = new UndoStack();
  constructor(private readonly env: UndoEnv) {}

  private day(): number { return absDay(this.env.game); }

  // ---------- guests ----------

  /** Number of guests inside / queueing at / riding on the thing (undo is refused while > 0). */
  guestsAtBuilding(id: number): number {
    const { guestSim, attractions } = this.env;
    const st = guestSim.store;
    let n = 0;
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i] || st.target[i] !== id) continue;
      const s = st.state[i];
      if (s === GState.Using || s === GState.Queueing || s === GState.Sleeping) n++;
    }
    const a = attractions.get(id);
    return Math.max(n, a ? a.users.length + a.queue.length : 0, attractions.rooms.occupied(id));
  }

  guestsAtLift(id: number): number {
    const { guestSim } = this.env;
    const st = guestSim.store;
    let n = 0;
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i] || st.liftId[i] !== id) continue;
      if (st.state[i] === GState.Queueing || st.state[i] === GState.Riding) n++;
    }
    return Math.max(n, guestSim.queues.ridersOn(id) + guestSim.queues.queueLength(id, 0) + guestSim.queues.queueLength(id, 1));
  }

  // ---------- buildings ----------

  /** Place a building (same rules as `placeBuilding`) and record it. */
  placeBuilding(type: string, x: number, y: number, rot: number, autoFlatten: boolean): PlaceOutcome {
    const { grid, props, networks, buildings, economy } = this.env;
    const { w, h } = footprintOf(type, rot);
    const r: Rect = { x0: x - MARGIN, y0: y - MARGIN, x1: x + w + MARGIN, y1: y + h + MARGIN };
    const delta = TerrainDelta.capture(grid, props, networks, [r], r);
    const day = this.day();
    let out!: PlaceOutcome;
    const cmd: UndoCommand = {
      label: displayName(type), verb: 'placed', day, cost: 0,
      do: () => { out = placeBuilding({ grid, buildings, economy, props, gate: this.env.gate }, props, type, x, y, rot, autoFlatten); return out.ok; },
      check: () => {
        const b = buildings.get(out.building!.id);
        if (!b || b.x !== x || b.y !== y || b.rot !== out.building!.rot) return 'The building is gone or was changed';
        if (this.guestsAtBuilding(b.id) > 0) return `Guests are inside the ${displayName(type)}`;
        return delta.stale();
      },
      undo: () => {
        const id = out.building!.id;
        const rem = buildings.remove(id);
        buildings.rewindId(id);
        economy.refund(out.cost);
        return { touchedChunks: delta.revert(), changed: rem?.changed ?? [], kind: 'building' } satisfies UndoApplied;
      },
    };
    if (!cmd.do()) return out;
    delta.seal();
    cmd.cost = out.cost;
    this.stack.push(cmd);
    return out;
  }

  /** Bulldoze a building (50% refund) and record it. */
  bulldozeBuilding(id: number): BulldozeResult {
    const { buildings, economy, names, attractions, guestSim, grid } = this.env;
    const before = buildings.get(id);
    if (!before) return { ok: false, refund: 0, changed: [] };
    const rec: PlacedBuilding = { ...before };
    const index = buildings.indexOf(id);
    const inst: InstanceSave | undefined = attractions.snapshotInstance(id);
    const nameKey = `building:${id}`;
    const custom = names.serialize().custom.find(([k]) => k === nameKey)?.[1];
    const school = before.type === 'skiSchoolHQ' ? structuredClone(guestSim.families.school(id).serialize()) : undefined;
    const label = displayName(before.type);
    const sig = (): string => this.footprintSig(rec);
    const res = bulldoze(buildings, economy, id);
    if (!res.ok) return res;
    const after = sig();
    const refund = res.refund;
    this.stack.push({
      label, verb: 'bulldozed', day: this.day(), cost: -refund,
      do: () => true,
      check: () => {
        if (buildings.get(id)) return 'The tile is occupied again';
        if (sig() !== after) return 'The tile is occupied or the terrain has changed since';
        for (let j = rec.y; j < rec.y + rec.h; j++) for (let i = rec.x; i < rec.x + rec.w; i++) if (!grid.inBounds(i, j)) return 'The tile is no longer available';
        return null;
      },
      undo: () => {
        economy.charge(refund);
        const r = buildings.reinsert(rec, index);
        if (inst) attractions.restoreInstance(id, inst);
        if (school) guestSim.families.school(id).load(school as Parameters<ReturnType<typeof guestSim.families.school>['load']>[0]);
        if (custom && !names.serialize().custom.some(([k]) => k === nameKey)) names.rename('building', id, custom);
        return { touchedChunks: [], changed: r.changed, kind: 'building' };
      },
    });
    return res;
  }

  /** Terrain + occupancy fingerprint of the footprint (heights, tile types, occupancy bits, network tiles, props). */
  private footprintSig(b: { x: number; y: number; w: number; h: number }): string {
    const { grid, networks, props } = this.env;
    const parts: number[] = [];
    for (let vy = b.y; vy <= b.y + b.h; vy++) for (let vx = b.x; vx <= b.x + b.w; vx++) parts.push(grid.getCorner(vx, vy));
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const t = grid.tileIndex(x, y);
      parts.push(grid.tileType[t]!, grid.occupancy.flags[t]!, grid.occupancy.entityId[t]!, networks.kind[t]!, networks.layers[t]!);
    }
    parts.push(props ? props.countInRect(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1) : 0);
    return parts.join(',');
  }

  // ---------- lifts ----------

  placeLift(env: Parameters<typeof placeLift>[0], props: PropStore | undefined, kind: LiftKind, bottom: StationSite, top: StationSite, autoFlatten = true, clearLane = true): LiftPlaceOutcome {
    const { grid, networks, lifts, economy } = this.env;
    const S = LIFT_STATION_SIZE;
    const rb: Rect = { x0: bottom.x - MARGIN, y0: bottom.y - MARGIN, x1: bottom.x + S + MARGIN, y1: bottom.y + S + MARGIN };
    const rt: Rect = { x0: top.x - MARGIN, y0: top.y - MARGIN, x1: top.x + S + MARGIN, y1: top.y + S + MARGIN };
    const bbox: Rect = { x0: Math.min(rb.x0, rt.x0), y0: Math.min(rb.y0, rt.y0), x1: Math.max(rb.x1, rt.x1), y1: Math.max(rb.y1, rt.y1) };
    const delta = TerrainDelta.capture(grid, props, networks, [rb, rt], bbox);
    let out!: LiftPlaceOutcome;
    const name = displayName(kind);
    const cmd: UndoCommand = {
      label: name, verb: 'placed', day: this.day(), cost: 0,
      do: () => { out = placeLift(env, props, kind, bottom, top, autoFlatten, clearLane); return out.ok; },
      check: () => {
        const l = lifts.get(out.lift!.id);
        if (!l) return 'The lift is gone';
        if (this.guestsAtLift(l.id) > 0) return `Guests are queueing for or riding the ${name}`;
        return delta.stale();
      },
      undo: () => {
        const id = out.lift!.id;
        lifts.remove(id);
        lifts.rewindId(id);
        economy.refund(out.cost);
        return { touchedChunks: delta.revert(), changed: [], kind: 'lift' };
      },
    };
    if (!cmd.do()) return out;
    delta.seal();
    cmd.cost = out.cost;
    this.stack.push(cmd);
    return out;
  }

  /** Demolish a lift (50% refund) and record it. */
  demolishLift(id: number): { ok: boolean; refund: number } {
    const { lifts, economy, names, grid, networks } = this.env;
    const before = lifts.get(id);
    if (!before) return { ok: false, refund: 0 };
    const rec: LiftData = structuredClone(before);
    const index = lifts.indexOf(id);
    const nameKey = `lift:${id}`;
    const custom = names.serialize().custom.find(([k]) => k === nameKey)?.[1];
    const label = displayName(rec.kind);
    const tilesSig = (): string => rec.tiles.map((t) => `${grid.occupancy.flags[t]}:${grid.occupancy.entityId[t]}:${networks.kind[t]}:${grid.tileType[t]}`).join(',');
    const refund = Math.round(rec.cost * 0.5);
    lifts.remove(id);
    economy.refund(refund);
    const after = tilesSig();
    this.stack.push({
      label, verb: 'bulldozed', day: this.day(), cost: -refund,
      do: () => true,
      check: () => (lifts.get(id) ? 'The tile is occupied again' : tilesSig() !== after ? 'The tile is occupied or the terrain has changed since' : null),
      undo: () => {
        economy.charge(refund);
        lifts.reinsert(rec, index);
        if (custom && !names.serialize().custom.some(([k]) => k === nameKey)) names.rename('lift', id, custom);
        return { touchedChunks: [], changed: [], kind: 'lift' };
      },
    });
    return { ok: true, refund };
  }

  // ---------- network tiles (path / road / rail / piste bulldozed by tile) ----------

  /** Record a tile-level bulldoze that already happened: `diff` = pre-change snapshots (Networks journal), `refund` = money given back. */
  recordNetworkBulldoze(label: string, diff: TileSnap[], refund: number): void {
    const { networks, economy } = this.env;
    if (!diff.length) return;
    const sig = (): string => diff.map((s) => `${s.i}:${networks.kind[s.i]}:${networks.bridge[s.i]}:${networks.layers[s.i]}:${networks.difficulty[s.i]}:${this.env.grid.occupancy.flags[s.i]}`).join(',');
    const after = sig();
    this.stack.push({
      label, verb: 'bulldozed', day: this.day(), cost: -refund,
      do: () => true,
      check: () => (sig() !== after ? 'The tile has changed since' : null),
      undo: () => { economy.charge(refund); networks.restore(diff); return { touchedChunks: [], changed: [], kind: 'network' }; },
    });
  }

  // ---------- undo ----------

  undo(): UndoReport {
    const { economy } = this.env;
    return this.stack.undo({ day: this.day(), canAfford: (n) => economy.canAfford(n) });
  }

  /** Short description of what the next undo would revert ('Café' / null). */
  next(): { label: string; verb: UndoCommand['verb'] } | null { const c = this.stack.peek(); return c ? { label: c.label, verb: c.verb } : null; }
  get size(): number { return this.stack.size; }
}

/** Toast text for a report: 'Undid: placing Café' style, sentence-case. */
export function undoMessage(r: UndoReport): string {
  if (r.ok) return `Undid: ${r.verb === 'placed' ? 'placing' : 'bulldozing'} ${r.label}`;
  return r.label ? `Can't undo ${r.label}: ${r.reason}` : r.reason;
}
