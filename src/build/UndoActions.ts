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
export type UndoEnv = Pick<Sim, 'grid' | 'props' | 'buildings' | 'lifts' | 'networks' | 'economy' | 'names' | 'attractions' | 'guestSim' | 'game'> & { gate?: Sim['gate']; landscape?: Sim['landscape'] };

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
  /** Tiles (extra to the ones around moved vertices) whose occupancy must not change while the command is undoable (planting / clearing). */
  private watch = new Set<number>();
  private watchSig = '';
  watchRect(r: Rect): void {
    const g = this.g, c = clampRect(g, r);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) this.watch.add(y * g.size + x);
  }
  private watchNow(): string {
    const parts: string[] = [];
    for (const t of this.watch) parts.push(`${this.g.occupancy.flags[t]}:${this.g.occupancy.entityId[t]}:${this.net.kind[t]}:${this.net.layers[t]}`);
    return parts.join(',');
  }

  static capture(g: Grid, props: PropStore | undefined, net: UndoEnv['networks'], heightRects: Rect[], propRect: Rect): TerrainDelta {
    const d = new TerrainDelta(g, props, net, new Map(), new Map());
    d.grow(heightRects, propRect);
    return d;
  }

  /** Remember the CURRENT heights / prop chunks of a region not seen yet (call BEFORE each further stamp of a drag; the first value wins). */
  grow(heightRects: Rect[], propRect: Rect | null): void {
    const g = this.g;
    for (const r0 of heightRects) {
      const r = clampRect(g, r0);
      for (let vy = r.y0; vy <= r.y1 + 1; vy++) for (let vx = r.x0; vx <= r.x1 + 1; vx++) { const i = vy * g.vsize + vx; if (!this.preH.has(i)) this.preH.set(i, g.heights[i]!); }
    }
    if (this.props && propRect) for (const ci of chunksOf(g, clampRect(g, propRect))) if (!this.preChunks.has(ci)) this.preChunks.set(ci, cloneChunk(this.props.chunks[ci]!));
  }

  /** Call right after the action (and again after each further stamp): records what changed compared with the first capture. */
  seal(): void {
    this.verts = []; this.chunks = [];
    for (const [i, from] of this.preH) { const to = this.g.heights[i]!; if (to !== from) this.verts.push({ i, from, to }); }
    for (const [ci, pre] of this.preChunks) { const post = this.props!.chunks[ci]!; if (!sameChunk(pre, post)) this.chunks.push({ ci, pre, post: cloneChunk(post) }); }
    this.netSig = this.netSigNow();
    this.watchSig = this.watchNow();
  }

  /** Redo guard: the ground and props are exactly as they were before the action (i.e. right after undo). */
  preMatches(): string | null {
    for (const v of this.verts) if (this.g.heights[v.i] !== v.from) return 'The terrain has changed since';
    for (const c of this.chunks) if (!sameChunk(this.props!.chunks[c.ci]!, c.pre)) return 'The terrain has changed since (trees or rocks moved)';
    return null;
  }

  /** Put the heights and props back AFTER the action (redo). Returns the touched chunk indices. */
  reapply(): number[] {
    const touched = new Set<number>();
    for (const v of this.verts) {
      const vx = v.i % this.g.vsize, vy = (v.i / this.g.vsize) | 0;
      this.g.setCornerUnchecked(vx, vy, v.to);
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) if (this.g.inBounds(tx, ty)) touched.add(Math.floor(ty / CHUNK_SIZE) * this.g.chunksPerRow + Math.floor(tx / CHUNK_SIZE));
    }
    for (const c of this.chunks) { this.props!.chunks[c.ci] = cloneChunk(c.post); this.props!.chunkVersion[c.ci]!++; touched.add(c.ci); }
    return [...touched];
  }

  /** Chunk indices the action touched (heights + props), without changing anything. */
  touchedNow(): number[] {
    const touched = new Set<number>();
    for (const v of this.verts) {
      const vx = v.i % this.g.vsize, vy = (v.i / this.g.vsize) | 0;
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) if (this.g.inBounds(tx, ty)) touched.add(Math.floor(ty / CHUNK_SIZE) * this.g.chunksPerRow + Math.floor(tx / CHUNK_SIZE));
    }
    for (const c of this.chunks) touched.add(c.ci);
    return [...touched];
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
        if (this.net.kind[t] || this.net.layers[t] || this.g.occupancy.flags[t]) out.push(`${t}:${this.net.kind[t]}:${this.net.layers[t]}:${this.g.occupancy.flags[t]}:${this.g.occupancy.entityId[t]}`);
      }
    }
    return out.join(',');
  }

  get changedVertices(): number { return this.verts.length; }

  stale(): string | null {
    for (const v of this.verts) if (this.g.heights[v.i] !== v.to) return 'The terrain has changed since';
    for (const c of this.chunks) if (!sameChunk(this.props!.chunks[c.ci]!, c.post)) return 'The terrain has changed since (trees or rocks moved)';
    if (this.netSigNow() !== this.netSig) return 'A path, road or piste was built on the levelled ground since';
    if (this.watchNow() !== this.watchSig) return 'Something was built there since';
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
      checkRedo: () => delta.preMatches(),
      redo: () => {
        if (!cmd.do()) return { fail: out.reasons[0] ?? 'It cannot be placed any more' };
        delta.seal();
        return { touchedChunks: delta.touchedNow(), changed: out.changed, kind: 'building' } satisfies UndoApplied;
      },
    };
    if (!cmd.do()) return out;
    delta.seal();
    cmd.cost = out.cost;
    this.record(cmd);
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
    this.record({
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
      checkRedo: () => {
        const b = buildings.get(id);
        if (!b || b.x !== rec.x || b.y !== rec.y) return 'The building is gone or was changed';
        return this.guestsAtBuilding(id) > 0 ? `Guests are inside the ${label}` : null;
      },
      redo: () => {
        const r = buildings.remove(id);
        if (!r) return { fail: 'The building is gone' };
        economy.refund(refund);
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
      checkRedo: () => delta.preMatches(),
      redo: () => {
        if (!cmd.do()) return { fail: out.reasons[0] ?? 'It cannot be placed any more' };
        delta.seal();
        return { touchedChunks: delta.touchedNow(), changed: [], kind: 'lift' };
      },
    };
    if (!cmd.do()) return out;
    delta.seal();
    cmd.cost = out.cost;
    this.record(cmd);
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
    this.record({
      label, verb: 'bulldozed', day: this.day(), cost: -refund,
      do: () => true,
      check: () => (lifts.get(id) ? 'The tile is occupied again' : tilesSig() !== after ? 'The tile is occupied or the terrain has changed since' : null),
      undo: () => {
        economy.charge(refund);
        lifts.reinsert(rec, index);
        if (custom && !names.serialize().custom.some(([k]) => k === nameKey)) names.rename('lift', id, custom);
        return { touchedChunks: [], changed: [], kind: 'lift' };
      },
      checkRedo: () => (!lifts.get(id) ? 'The lift is gone' : this.guestsAtLift(id) > 0 ? `Guests are queueing for or riding the ${label}` : null),
      redo: () => { lifts.remove(id); economy.refund(refund); return { touchedChunks: [], changed: [], kind: 'lift' }; },
    });
    return { ok: true, refund };
  }

  // ---------- network tiles (path / road / rail / piste bulldozed by tile) ----------

  /** Record a tile-level bulldoze that already happened: `diff` = pre-change snapshots (Networks journal), `refund` = money given back. */
  recordNetworkBulldoze(label: string, diff: TileSnap[], refund: number): void {
    this.recordNetwork(label, 'bulldozed', diff, -refund);
  }

  /**
   * Record a path / road / rail / piste edit that already happened (`diff` = pre-change snapshots from the Networks journal).
   * `undoFlow` = signed money flow of the undo: +charged for a stroke (refunded), -refund for a bulldoze.
   */
  recordNetwork(label: string, verb: UndoCommand['verb'], diff: TileSnap[], undoFlow: number): void {
    const { networks, economy } = this.env;
    if (!diff.length) return;
    const idx = diff.map((s) => s.i);
    const sig = (): string => diff.map((s) => `${s.i}:${networks.kind[s.i]}:${networks.bridge[s.i]}:${networks.layers[s.i]}:${networks.difficulty[s.i]}:${this.env.grid.occupancy.flags[s.i]}`).join(',');
    const post = networks.snapshotTiles(idx);
    const after = sig();
    let before = '';
    this.record({
      label, verb, day: this.day(), cost: undoFlow,
      do: () => true,
      check: () => (sig() !== after ? 'The tile has changed since' : null),
      undo: () => {
        if (undoFlow >= 0) economy.refund(undoFlow); else economy.charge(-undoFlow);
        networks.restore(diff); before = sig();
        return { touchedChunks: [], changed: [], kind: 'network' };
      },
      checkRedo: () => (sig() !== before ? 'The tile has changed since' : null),
      redo: () => {
        if (undoFlow >= 0) economy.charge(undoFlow); else economy.refund(-undoFlow);
        networks.restore(post);
        return { touchedChunks: [], changed: [], kind: 'network' };
      },
    });
  }

  // ---------- terrain strokes (terraform / planting) ----------

  /**
   * Start recording one drag of a terrain tool as a SINGLE undo step. Each `stamp(rect, run)` captures the ground first, runs the edit
   * (`run` returns `{ ok, flow }`: `flow` = money the stamp cost, net of timber revenue), and extends the one command. `heightRect` is in
   * vertex space (inclusive corners), `propRect` in tile space.
   */
  terrainStroke(label: string, verb: 'terraformed' | 'planted'): { stamp(heightRect: Rect | null, propRect: Rect, run: () => { ok: boolean; flow: number }): boolean } {
    const { grid, props, networks, economy } = this.env;
    let delta: TerrainDelta | null = null;
    let cmd: UndoCommand | null = null;
    let flow = 0;
    return {
      stamp: (heightRect, propRect, run) => {
        // capture BEFORE the edit; vertex rect corners (x1,y1 inclusive) -> capture() adds +1 itself, so shrink by one
        const hr: Rect[] = heightRect ? [{ x0: heightRect.x0, y0: heightRect.y0, x1: heightRect.x1 - 1, y1: heightRect.y1 - 1 }] : [];
        const pr: Rect = { x0: propRect.x0 - 1, y0: propRect.y0 - 1, x1: propRect.x1 + 1, y1: propRect.y1 + 1 };
        if (!delta) delta = TerrainDelta.capture(grid, props, networks, hr, pr); else delta.grow(hr, pr);
        const res = run();
        if (!res.ok) return false;
        delta.watchRect(pr);
        delta.seal();
        flow += res.flow;
        if (!cmd) {
          const d = delta;
          cmd = {
            label, verb, day: this.day(), cost: flow,
            do: () => true,
            check: () => d.stale(),
            undo: () => { const t = d.revert(); if (cmd!.cost >= 0) economy.refund(cmd!.cost); else economy.charge(-cmd!.cost); return { touchedChunks: t, changed: [], kind: 'terrain' }; },
            checkRedo: () => d.preMatches(),
            redo: () => { if (cmd!.cost >= 0) economy.charge(cmd!.cost); else economy.refund(-cmd!.cost); return { touchedChunks: d.reapply(), changed: [], kind: 'terrain' }; },
          };
          this.record(cmd);
        } else cmd.cost = flow;
        return true;
      },
    };
  }

  /**
   * One undo step for a landscaping drag (pond / fill / boulders / decor). Like `terrainStroke`, but it also snapshots what ponds and decor change
   * besides heights and props: tile types, occupancy bits and the Landscape lists (ponds, decor). `rect` is in TILES (inclusive); `run` does charge + commit.
   */
  landscapeStroke(label: string): { stamp(rect: Rect, run: () => { ok: boolean; flow: number }): boolean } {
    const { grid, props, networks, economy, landscape } = this.env;
    if (!landscape) throw new Error('Undo.landscapeStroke needs env.landscape');
    const ls = landscape;
    type Tile = { tt: number; f: number; id: number; sn: number };
    const preTiles = new Map<number, Tile>();
    const snap = (i: number): Tile => ({ tt: grid.tileType[i]!, f: grid.occupancy.flags[i]!, id: grid.occupancy.entityId[i]!, sn: grid.snowDepth[i]! });
    const same = (a: Tile, b: Tile): boolean => a.tt === b.tt && a.f === b.f && a.id === b.id;
    const pre = JSON.stringify(ls.serialize()), preCount = { felled: props.treesFelled, planted: props.treesPlanted };
    let postCount = preCount;
    let post = pre, postTiles = new Map<number, Tile>();
    let delta: TerrainDelta | null = null, cmd: UndoCommand | null = null, flow = 0;
    const restoreTiles = (m: Map<number, Tile>): number[] => {
      const touched = new Set<number>();
      for (const [i, t] of m) {
        grid.tileType[i] = t.tt; grid.occupancy.flags[i] = t.f; grid.occupancy.entityId[i] = t.id; grid.snowDepth[i] = t.sn;
        const x = i % grid.size, y = (i / grid.size) | 0;
        grid.markDirty(x, y);
        touched.add(Math.floor(y / CHUNK_SIZE) * grid.chunksPerRow + Math.floor(x / CHUNK_SIZE));
      }
      return [...touched];
    };
    const tilesMatch = (m: Map<number, Tile>): boolean => { for (const [i, t] of m) if (!same(snap(i), t)) return false; return true; };
    return {
      stamp: (rect, run) => {
        const r = clampRect(grid, { x0: rect.x0 - 3, y0: rect.y0 - 3, x1: rect.x1 + 3, y1: rect.y1 + 3 });
        if (!delta) delta = TerrainDelta.capture(grid, props, networks, [r], r); else delta.grow([r], r);
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = y * grid.size + x; if (!preTiles.has(i)) preTiles.set(i, snap(i)); }
        const res = run();
        if (!res.ok) return false;
        delta.seal();
        flow += res.flow;
        post = JSON.stringify(ls.serialize());
        postCount = { felled: props.treesFelled, planted: props.treesPlanted };
        postTiles = new Map<number, Tile>();
        for (const i of preTiles.keys()) postTiles.set(i, snap(i));
        if (!cmd) {
          const d = delta;
          cmd = {
            label, verb: 'landscaped', day: this.day(), cost: flow,
            do: () => true,
            check: () => d.stale() ?? (post !== JSON.stringify(ls.serialize()) || !tilesMatch(postTiles) ? 'The landscape has changed since' : null),
            undo: () => {
              const t = new Set(d.revert());
              for (const c of restoreTiles(preTiles)) t.add(c);
              ls.load(JSON.parse(pre));
              props.treesFelled = preCount.felled; props.treesPlanted = preCount.planted; // sustainability counters follow the trees
              if (cmd!.cost >= 0) economy.refund(cmd!.cost); else economy.charge(-cmd!.cost);
              return { touchedChunks: [...t], changed: [], kind: 'terrain' };
            },
            checkRedo: () => d.preMatches() ?? (pre !== JSON.stringify(ls.serialize()) || !tilesMatch(preTiles) ? 'The landscape has changed since' : null),
            redo: () => {
              if (cmd!.cost >= 0) economy.charge(cmd!.cost); else economy.refund(-cmd!.cost);
              const t = new Set(d.reapply());
              for (const c of restoreTiles(postTiles)) t.add(c);
              ls.load(JSON.parse(post));
              props.treesFelled = postCount.felled; props.treesPlanted = postCount.planted;
              return { touchedChunks: [...t], changed: [], kind: 'terrain' };
            },
          };
          this.record(cmd);
        } else cmd.cost = flow;
        return true;
      },
    };
  }

  private record(c: UndoCommand): void { this.stack.push(c); }

  // ---------- undo ----------

  undo(): UndoReport {
    const { economy } = this.env;
    return this.stack.undo({ day: this.day(), canAfford: (n) => economy.canAfford(n) });
  }

  redo(): UndoReport {
    const { economy } = this.env;
    return this.stack.redo({ day: this.day(), canAfford: (n) => economy.canAfford(n) });
  }

  /** Short description of what the next redo would replay. */
  nextRedo(): { label: string; verb: UndoCommand['verb'] } | null { const c = this.stack.peekRedo(); return c ? { label: c.label, verb: c.verb } : null; }

  /** Short description of what the next undo would revert ('Café' / null). */
  next(): { label: string; verb: UndoCommand['verb'] } | null { const c = this.stack.peek(); return c ? { label: c.label, verb: c.verb } : null; }
  get size(): number { return this.stack.size; }
}

/** Toast text for a report: 'Undid: placing Café' style, sentence-case. */
const VERB_ING: Record<UndoCommand['verb'], string> = { placed: 'placing', bulldozed: 'bulldozing', painted: 'drawing', terraformed: 'terraforming', planted: 'planting', landscaped: 'landscaping' };
export const verbIng = (v: UndoCommand['verb']): string => VERB_ING[v];
export function undoMessage(r: UndoReport): string {
  if (r.ok) return `${r.redo ? 'Redid' : 'Undid'}: ${verbIng(r.verb)} ${r.label}`;
  return r.label ? `Can't undo ${r.label}: ${r.reason}` : r.reason;
}
/** Same for a failed REDO (the message says redo, not undo). */
export function redoMessage(r: UndoReport): string {
  if (r.ok) return undoMessage(r);
  return r.label ? `Can't redo ${r.label}: ${r.reason}` : r.reason;
}
