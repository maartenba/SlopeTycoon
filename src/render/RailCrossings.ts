import * as THREE from 'three';
import type { Grid } from '../world/Grid';
import type { CrossingInfo, RailCrossings } from '../sim/RailCrossings';
import { surfaceHeightAt } from './meshes/Paths';

const BOOM_UP = 1.32; // radians: raised boom
const BOOM_LERP_SECONDS = 1; // up <-> down
const BLINK_SECONDS = 0.5;
const BELL_EVERY = 0.9; // seconds between bell strikes while closed

const WHITE = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
const RED = new THREE.MeshLambertMaterial({ color: 0xc8322b });
const GREY = new THREE.MeshLambertMaterial({ color: 0x6d7178 });
/** Lamps are unlit (emissive look, no scene light): lit red / dim red. */
const LAMP_ON = new THREE.MeshBasicMaterial({ color: 0xff3b2a });
const LAMP_OFF = new THREE.MeshBasicMaterial({ color: 0x4a1612 });

const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh => {
  const o = new THREE.Mesh(BOX, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); parent.add(o); return o;
};

interface Post { group: THREE.Group; boom: THREE.Group; lamps: [THREE.Mesh, THREE.Mesh] }
interface Entry { info: CrossingInfo; root: THREE.Group; posts: Post[]; angle: number; blink: number; bell: number }

/**
 * Barriers, crossbucks and blinking lamps of every level crossing (docs/crossings.md). Purely visual: reads `RailCrossings` (closed state),
 * animates the booms with a 1 s lerp, blinks the lamps alternately while closed, and asks `onBell` for a quiet bell strike every 0.9 s.
 * No sim state is written; no lights are added (lamps are unlit materials); no gl_FragCoord. ~18 tiny meshes per crossing.
 */
export class RailCrossingsView {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private listRef: CrossingInfo[] | null = null;
  /** Bell strike request: world position of the crossing (tile centre). Set by main (distance-attenuated sfx). */
  onBell: ((x: number, z: number) => void) | null = null;

  constructor(private grid: Grid, private crossings: RailCrossings) { this.group.name = 'railCrossings'; }

  /** Per frame. `dt` in real seconds (the barriers animate in real time, independent of the sim speed). */
  update(dt: number): void {
    const list = this.crossings.list();
    if (list !== this.listRef) this.sync(list);
    for (const e of this.entries.values()) {
      const closed = this.crossings.isClosed(e.info.tile);
      const target = closed ? 0 : BOOM_UP;
      const step = (BOOM_UP / BOOM_LERP_SECONDS) * dt;
      e.angle += Math.max(-step, Math.min(step, target - e.angle));
      for (const p of e.posts) {
        p.boom.rotation.z = e.angle;
      }
      if (closed) {
        e.blink += dt; e.bell += dt;
        const phase = Math.floor(e.blink / BLINK_SECONDS) % 2;
        for (const p of e.posts) { p.lamps[0].material = phase ? LAMP_ON : LAMP_OFF; p.lamps[1].material = phase ? LAMP_OFF : LAMP_ON; }
        if (e.bell >= BELL_EVERY) { e.bell = 0; this.onBell?.(e.info.x + 0.5, e.info.y + 0.5); }
      } else {
        e.blink = 0; e.bell = BELL_EVERY * 0.9;
        for (const p of e.posts) { p.lamps[0].material = LAMP_OFF; p.lamps[1].material = LAMP_OFF; }
      }
    }
  }

  /** Rebuild the posts when the set of crossings changed (cheap: a handful of crossings). */
  private sync(list: CrossingInfo[]): void {
    this.listRef = list;
    const keep = new Set<number>();
    for (const c of list) {
      if (c.kind !== 1 && c.kind !== 2) continue; // footbridges have no barriers
      keep.add(c.tile);
      const old = this.entries.get(c.tile);
      if (old && old.info.kind === c.kind && old.info.axis === c.axis) continue;
      if (old) this.remove(c.tile);
      this.entries.set(c.tile, this.build(c));
    }
    for (const t of [...this.entries.keys()]) if (!keep.has(t)) this.remove(t);
  }

  private remove(tile: number): void {
    const e = this.entries.get(tile);
    if (!e) return;
    this.group.remove(e.root);
    this.entries.delete(tile);
  }

  private build(c: CrossingInfo): Entry {
    const root = new THREE.Group();
    const ns = c.axis === 'ns'; // rail runs N-S, so the path runs E-W
    const cx = c.x + 0.5, cz = c.y + 0.5;
    const hw = c.kind === 2 ? 0.36 : 0.25;
    const posts: Post[] = [];
    for (const s of [-1, 1] as const) {
      // post on the right-hand side of traffic arriving from side s, just outside the rails; boom reaches across the path / road
      const wx = ns ? cx + s * 0.46 : cx + s * (hw + 0.07), wz = ns ? cz - s * (hw + 0.07) : cz + s * 0.46;
      const g = new THREE.Group();
      g.position.set(wx, surfaceHeightAt(this.grid, wx, wz), wz);
      // local +x = across the path towards its centre line (the boom's free end), local z = along the path (pivot axis)
      g.rotation.y = ns ? (wz > cz ? Math.PI / 2 : -Math.PI / 2) : (wx > cx ? Math.PI : 0);
      box(GREY, 0.03, 0.36, 0.03, 0, 0.18, 0, g);
      // crossbuck (two crossed white boards) facing the path
      for (const a of [0.6, -0.6]) { const b = box(WHITE, 0.2, 0.026, 0.008, 0, 0.3, 0.02, g); b.rotation.z = a; }
      const l1 = box(LAMP_OFF, 0.04, 0.04, 0.02, 0, 0.385, -0.05, g), l2 = box(LAMP_OFF, 0.04, 0.04, 0.02, 0, 0.385, 0.05, g);
      const boom = new THREE.Group(); boom.position.set(0, 0.2, 0); g.add(boom);
      const L = hw * 2 + 0.1, seg = L / 5;
      for (let k = 0; k < 5; k++) box(k % 2 ? WHITE : RED, seg, 0.018, 0.018, seg * (k + 0.5), 0, 0, boom);
      root.add(g);
      posts.push({ group: g, boom, lamps: [l1, l2] });
    }
    this.group.add(root);
    return { info: c, root, posts, angle: BOOM_UP, blink: 0, bell: BELL_EVERY * 0.9 };
  }

  /** Boom angle of a crossing (rad; 0 = down / closed, ~1.32 = raised) for tests; null = no such crossing. */
  boomAngle(tile: number): number | null { return this.entries.get(tile)?.angle ?? null; }
  /** Number of crossings drawn (tests). */
  get count(): number { return this.entries.size; }

  dispose(): void { for (const t of [...this.entries.keys()]) this.remove(t); }
}
