import { BUILDINGS } from '../config/buildings';
import { OccFlag } from '../world/Occupancy';
import type { Occupancy } from '../world/Occupancy';
import type { CornerChange } from '../world/Terraform';
import type { GameBus } from '../core/events';
import { onRemove, reevaluateAll, type BuildingInstance, type DepContext, type Pt } from './Dependencies';

export interface PlacedBuilding extends BuildingInstance {
  /** 0..3, quarter-turns. */
  rot: number;
  /** Footprint after rotation. */
  w: number;
  h: number;
}

/** Plain serialisable data. */
export type BuildingData = PlacedBuilding;

export function footprintOf(type: string, rot: number): { w: number; h: number } {
  const d = BUILDINGS[type];
  if (!d) throw new Error(`Unknown building '${type}'`);
  return rot % 2 === 0 ? { w: d.w, h: d.h } : { w: d.h, h: d.w };
}

/** World-side building store. Writes/clears Occupancy; no rendering. */
export class Buildings {
  private items = new Map<number, PlacedBuilding>();
  private nextId = 1;
  /** Optional gameplay bus: emits building:placed / building:removed. */
  bus?: Pick<GameBus, 'emit'>;
  lakeTiles: Pt[] = [];
  /** Stream-tile lookup for the hydro rule (wired by createSim). */
  streamAt?: (x: number, y: number) => boolean;
  core: Pt | null = null;

  constructor(private occ: Occupancy) {}

  get size(): number { return this.items.size; }
  all(): PlacedBuilding[] { return [...this.items.values()]; }
  get(id: number): PlacedBuilding | undefined { return this.items.get(id); }
  has(type: string): boolean { return this.all().some((b) => b.type === type); }

  /** Building covering tile (x,y), if any. */
  at(x: number, y: number): PlacedBuilding | undefined {
    if (x < 0 || y < 0 || x >= this.occ.size || y >= this.occ.size) return undefined;
    if (!this.occ.has(x, y, OccFlag.Building)) return undefined;
    return this.items.get(this.occ.entityId[this.occ.index(x, y)]!);
  }

  /** Walking-radius override (New Game advanced option); undefined = WALKING_RADIUS_TILES. */
  walkingRadius?: number;
  private network: Pick<DepContext, 'pathDistance' | 'roadConnected' | 'access'> = {};
  /** Lift cable-clearance guard used by auto-flatten previews (wire from the lift store). */
  liftClearance?: (changed: CornerChange[]) => number;

  /** Plug in real path/road networks used by dependency evaluation. */
  setNetwork(n: Pick<DepContext, 'pathDistance' | 'roadConnected' | 'access'> | null): void { this.network = n ?? {}; }

  /** Re-evaluate all dependencies (call after path/road changes); returns ids whose status changed. */
  reevaluate(): number[] { return reevaluateAll(this.depContext()); }

  depContext(): DepContext {
    return { buildings: this.all(), lakeTiles: this.lakeTiles, streamAt: this.streamAt, core: this.core, walkingRadius: this.walkingRadius, ...this.network };
  }

  /** Adds a building (no validation: use validatePlacement first). Returns it plus ids whose status changed. */
  add(type: string, x: number, y: number, rot = 0, id?: number): { building: PlacedBuilding; changed: number[] } {
    const { w, h } = footprintOf(type, rot);
    const bid = id ?? this.nextId;
    this.nextId = Math.max(this.nextId, bid + 1);
    const b: PlacedBuilding = { id: bid, type, x, y, rot, w, h, active: true };
    this.items.set(bid, b);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.occ.set(i, j, OccFlag.Building, bid);
    const changed = reevaluateAll(this.depContext()).filter((c) => c !== bid);
    this.bus?.emit('building:placed', { id: bid, type, x, y });
    return { building: b, changed };
  }

  /** Run `fn` with building `id` temporarily absent (occupancy + store, no events), then restore it. For validating a re-placement (rotation). */
  without<T>(id: number, fn: () => T): T {
    const b = this.items.get(id);
    if (!b) return fn();
    this.items.delete(id);
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.occ.clear(i, j, OccFlag.Building);
    try { return fn(); } finally {
      this.items.set(id, b);
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.occ.set(i, j, OccFlag.Building, id);
    }
  }

  /** Re-seat building `id` with a new rotation/anchor (no validation: see PlaceBuilding.rotateBuilding). Returns ids whose status changed. */
  rotate(id: number, rot: number, x: number, y: number): { building: PlacedBuilding; changed: number[] } | null {
    const b = this.items.get(id);
    if (!b) return null;
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.occ.clear(i, j, OccFlag.Building);
    const { w, h } = footprintOf(b.type, rot);
    b.rot = ((rot % 4) + 4) % 4; b.x = x; b.y = y; b.w = w; b.h = h;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.occ.set(i, j, OccFlag.Building, id);
    const changed = reevaluateAll(this.depContext()).filter((c) => c !== id);
    return { building: b, changed };
  }

  /** Position of building `id` in store order (-1 when absent). Used by undo to re-insert at the same place. */
  indexOf(id: number): number { let i = 0; for (const k of this.items.keys()) { if (k === id) return i; i++; } return -1; }

  /** Undo of a placement: if `id` was the most recent id handed out, hand it out again (keeps ids/save data identical to before the placement). */
  rewindId(id: number): void { if (this.nextId === id + 1) this.nextId = id; }

  /** Undo of a bulldoze: put the exact building record back (same id, rotation, status inputs) at store position `index`. No validation: callers check first. */
  reinsert(data: PlacedBuilding, index: number): { building: PlacedBuilding; changed: number[] } {
    const b: PlacedBuilding = { ...data };
    const list = [...this.items.values()];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, b);
    this.items = new Map(list.map((x) => [x.id, x]));
    this.nextId = Math.max(this.nextId, b.id + 1);
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.occ.set(i, j, OccFlag.Building, b.id);
    const changed = reevaluateAll(this.depContext()).filter((c) => c !== b.id);
    this.bus?.emit('building:placed', { id: b.id, type: b.type, x: b.x, y: b.y });
    return { building: b, changed };
  }

  /** Removes a building, frees its tiles, cascades dependents. */
  remove(id: number): { removed: PlacedBuilding; changed: number[] } | null {
    const b = this.items.get(id);
    if (!b) return null;
    this.items.delete(id);
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) this.occ.clear(i, j, OccFlag.Building);
    const changed = onRemove(b, this.depContext());
    this.bus?.emit('building:removed', { id: b.id, type: b.type });
    return { removed: b, changed };
  }

  /** Save/load (Task 33): replace the store wholesale (occupancy is restored separately with the grid; no events, no re-evaluation). */
  restore(data: BuildingData[], nextId: number): void {
    this.items = new Map(data.map((b) => [b.id, { ...b }]));
    this.nextId = Math.max(nextId, ...data.map((b) => b.id + 1), 1);
  }
  nextIdValue(): number { return this.nextId; }

  serialize(): BuildingData[] { return this.all().map((b) => ({ ...b })); }

  load(data: BuildingData[]): void {
    for (const b of [...this.items.values()]) this.remove(b.id);
    for (const d of data) this.add(d.type, d.x, d.y, d.rot, d.id);
  }
}
