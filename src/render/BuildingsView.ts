import * as THREE from 'three';
import type { Grid } from '../world/Grid';
import { BUILDING_BUILDERS, DEFAULT_FOUNDATION, type BuildingMeshes } from './meshes';
import { baseHeight, rootedSeatOf, seatOf } from '../sim/PlaceBuilding';
import { BUILDINGS } from '../config/buildings';

/** The slice of the Buildings store the view reads. */
export interface BuildingsSource {
  all(): Array<{ id: number; type: string; x: number; y: number; w: number; h: number; rot: number }>;
}

interface Entry { group: THREE.Group; type: string; sig: string; depth: number }

/**
 * Single source of truth for building meshes: mirrors the Buildings store into the scene.
 * `sync()` adds meshes for ALL buildings (incl. those that existed at boot / loaded from a save), removes stale ones,
 * and re-seats meshes whose position, rotation or ground height changed (terraform/flatten, rotate). Idempotent: one mesh per building id.
 * Call sync() after boot and after any building/terrain edit; `update(dt)` also re-syncs every ~0.25 s as a safety net.
 */
export class BuildingsView {
  private entries = new Map<number, Entry>();
  private since = 0;

  /** Rotor spin speed (rad/s) of a wind turbine building (wired by main: from the energy grid; absent = still). */
  spin?: (id: number) => number;

  constructor(private scene: Pick<THREE.Scene, 'add' | 'remove'>, private meshes: BuildingMeshes, private grid: Grid, private source: BuildingsSource) {}

  get size(): number { return this.entries.size; }
  get(id: number): THREE.Group | undefined { return this.entries.get(id)?.group; }
  ids(): number[] { return [...this.entries.keys()]; }
  /** Group lookup for effects that attach to building meshes (smoke). */
  objects(): ReadonlyMap<number, THREE.Group> { return new Map([...this.entries].map(([id, e]) => [id, e.group])); }

  sync(): void {
    const seen = new Set<number>();
    for (const b of this.source.all()) {
      seen.add(b.id);
      // gentle-slope types (magic carpet) follow the slope on the lowest corner; everything else sits on a pad at the highest corner
      // with a stone plinth reaching down to the lowest one, so no part is buried.
      const gentle = BUILDINGS[b.type]?.site.slopeKind === 'gentleSlope';
      const rooted = BUILDING_BUILDERS[BUILDINGS[b.type]?.meshBuilder ?? b.type]?.rooted === true;
      const seat = gentle ? { y: baseHeight(this.grid, b.x, b.y, b.w, b.h), depth: DEFAULT_FOUNDATION } : rooted ? rootedSeatOf(this.grid, b.x, b.y, b.w, b.h) : seatOf(this.grid, b.x, b.y, b.w, b.h, DEFAULT_FOUNDATION);
      const y = seat.y;
      const sig = `${b.x},${b.y},${b.w},${b.h},${b.rot},${y}`;
      let e = this.entries.get(b.id);
      if (e && (e.type !== b.type || e.depth !== seat.depth)) { this.scene.remove(e.group); this.entries.delete(b.id); e = undefined; }
      if (!e) {
        const group = this.meshes.create(b.type, seat.depth, b.id);
        e = { group, type: b.type, sig: '', depth: seat.depth };
        this.entries.set(b.id, e);
        this.scene.add(group);
      }
      if (e.sig !== sig) {
        e.sig = sig;
        e.group.position.set(b.x + b.w / 2, y, b.y + b.h / 2);
        e.group.rotation.y = -(b.rot % 4) * (Math.PI / 2);
      }
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) { this.scene.remove(e.group); this.entries.delete(id); }
    }
  }

  update(dt: number): void {
    if (this.spin) {
      for (const [id, e] of this.entries) {
        if (e.type !== 'windTurbine') continue;
        const r = e.group.getObjectByName('rotor');
        if (r) r.rotation.z -= this.spin(id) * Math.min(dt, 0.1);
      }
    }
    this.since += dt;
    if (this.since >= 0.25) { this.since = 0; this.sync(); }
  }
}
