import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { RaceCourse, CourseInfo } from '@/sim/race/RaceCourse';
import type { RaceDay } from '@/sim/race/RaceDay';
import { courseGates, fmtTime } from '@/sim/race/RaceCourse';
import { surfaceHeightAt } from '@/render/meshes/Paths';

/**
 * Race course view (0.8.0, docs/race-course.md): gate poles + flags of every marked, valid course (TWO instanced meshes for ALL courses: 2 draw calls, 14 triangles a gate)
 * and the live timing boards (ONE mesh with a small canvas atlas: one 256 x 64 slot per course, two back-to-back quads each so the text reads from both sides; 1 draw call).
 * Read-only: everything comes from `RaceCourse`; the gate line is a pure function of the run. The board is redrawn at most once per sim hour (or when a lap lands).
 */
export const GATE_CAP = 640;
export const BOARD_SLOTS = 3;
const SLOT_W = 256, SLOT_H = 64;
export const GATE_TRIS = 14;

export { fmtTime };
/** The three lines of a board (pure: tested). */
export function boardLines(name: string, bestMs: number | null, racers: number, race?: { winnerMs: number | null; sponsor: string | null; live: boolean }, mtb = false): [string, string, string] {
  // Race days (0.8.1): while a race runs the second line says so; after it the winner's time stays up; the sponsor takes the third line.
  const l2 = race?.live ? 'RACE DAY - LIVE' : race?.winnerMs != null ? `WIN ${fmtTime(race.winnerMs)}` : bestMs === null ? 'BEST --:--.-' : `BEST ${fmtTime(bestMs)}`;
  return [name.slice(0, 16).toUpperCase(), l2, race?.sponsor ? race.sponsor.toUpperCase().slice(0, 28) : `${mtb ? 'RIDERS' : 'RACERS'} ${racers}`];
}

export class RaceCourseView {
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private board: THREE.Mesh;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private sig = ''; private boardSig = '';
  private acc = 0;
  /** Gates drawn / boards drawn (tests, debug). */
  gateCount = 0; boardCount = 0;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private colour = new THREE.Color();

  constructor(private grid: Grid, private race: RaceCourse, private hourStamp: () => number, private nameOf: (c: CourseInfo) => string, private raceDay?: RaceDay) {
    this.group.name = 'raceCourse';
    const poleGeo = new THREE.BoxGeometry(0.035, 0.6, 0.035); poleGeo.translate(0, 0.3, 0);
    const flagGeo = new THREE.PlaneGeometry(0.3, 0.17); flagGeo.translate(0.15, 0.5, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); poleMat.name = 'raceGatePole';
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }); flagMat.name = 'raceGateFlag';
    this.poles = new THREE.InstancedMesh(poleGeo, poleMat, GATE_CAP); this.flags = new THREE.InstancedMesh(flagGeo, flagMat, GATE_CAP);
    for (const m of [this.poles, this.flags]) { m.name = 'raceGates'; m.count = 0; m.frustumCulled = false; m.castShadow = true; this.group.add(m); }
    // board: BOARD_SLOTS x 2 quads, UVs into the atlas
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOARD_SLOTS * 2 * 12), 3));
    const uv = new Float32Array(BOARD_SLOTS * 2 * 8);
    for (let k = 0; k < BOARD_SLOTS * 2; k++) { const slot = k >> 1, v0 = 1 - (slot + 1) / BOARD_SLOTS, v1 = 1 - slot / BOARD_SLOTS; uv.set([0, v0, 1, v0, 1, v1, 0, v1], k * 8); }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx: number[] = []; for (let k = 0; k < BOARD_SLOTS * 2; k++) idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    geo.setIndex(idx); geo.setDrawRange(0, 0);
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas'); this.canvas.width = SLOT_W; this.canvas.height = SLOT_H * BOARD_SLOTS;
      this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    }
    const bm = new THREE.MeshBasicMaterial({ map: this.tex ?? null, side: THREE.FrontSide, transparent: false }); bm.name = 'raceBoard';
    this.board = new THREE.Mesh(geo, bm); this.board.name = 'raceBoard'; this.board.frustumCulled = false;
    this.group.add(this.board);
    this.mats.push(poleMat, flagMat, bm); this.geos.push(poleGeo, flagGeo, geo);
  }

  /** Per frame: cheap throttle; rebuilds the gates when the courses change and redraws a board at most once per sim hour. */
  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.4) return;
    this.acc = 0;
    const list = this.race.courses().filter((c) => c.valid);
    const sig = list.map((c) => `${c.id}:${c.run.tiles.length}:${c.run.poly.length}:${c.run.difficulty}`).join('|');
    if (sig !== this.sig) { this.sig = sig; this.rebuildGates(list); this.boardSig = ''; }
    const bsig = `${this.hourStamp()}|${this.race.version}|${this.raceDay?.version ?? 0}|${list.map((c) => `${c.id}${c.timing ? `${c.timing.x},${c.timing.y},${c.timing.rot ?? 0}` : ''}`).join('|')}`;
    if (bsig !== this.boardSig) { this.boardSig = bsig; this.redrawBoards(list); }
  }

  private rebuildGates(list: CourseInfo[]): void {
    let n = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const c of list) {
      for (const g of courseGates(c.run, this.grid.size)) {
        if (n >= GATE_CAP) break;
        p.set(g.x, surfaceHeightAt(this.grid, g.x, g.y), g.y);
        e.set(0, Math.atan2(g.dx, g.dy), 0); q.setFromEuler(e); m.compose(p, q, sc);
        this.poles.setMatrixAt(n, m); this.flags.setMatrixAt(n, m);
        this.colour.setHex(g.red ? 0xd9453a : 0x2f6fd0);
        this.poles.setColorAt(n, this.colour); this.flags.setColorAt(n, this.colour);
        n++;
      }
    }
    this.poles.count = this.flags.count = n; this.gateCount = n;
    this.poles.instanceMatrix.needsUpdate = this.flags.instanceMatrix.needsUpdate = true;
    if (this.poles.instanceColor) this.poles.instanceColor.needsUpdate = this.flags.instanceColor!.needsUpdate = true;
  }

  private redrawBoards(list: CourseInfo[]): void {
    const pos = this.board.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ctx = this.canvas?.getContext('2d') ?? null;
    if (ctx) { ctx.fillStyle = '#1d2733'; ctx.fillRect(0, 0, SLOT_W, SLOT_H * BOARD_SLOTS); }
    let slot = 0;
    for (const c of list) {
      if (!c.timing || slot >= BOARD_SLOTS) continue;
      const t = c.timing, cx = t.x + t.w / 2, cz = t.y + t.h / 2, y = surfaceHeightAt(this.grid, cx, cz) + 1.1;
      const yaw = -((t.rot ?? 0) % 4) * (Math.PI / 2), ux = Math.cos(yaw), uz = -Math.sin(yaw), nx = Math.sin(yaw), nz = Math.cos(yaw);
      const hw = 0.42, hh = 0.17;
      for (let side = 0; side < 2; side++) {
        const k = slot * 2 + side, s = side === 0 ? 1 : -1, off = 0.025 * s, fx = nx * s, fz = nz * s, rx = ux * s, rz = uz * s; // right vector flips on the back face so the text never mirrors
        const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        corners.forEach(([a, b], i) => pos.setXYZ(k * 4 + i, cx + rx * a * hw + fx * off, y + b * hh, cz + rz * a * hw + fz * off));
      }
      if (ctx) {
        const [l1, l2, l3] = boardLines(this.nameOf(c), this.race.bestMs(c.id), this.race.racersToday(c.mtb), this.raceDay ? { winnerMs: ((r) => (r && Math.floor(this.hourStamp() / 24) - r.day <= 3 ? r.winnerMs : null))(this.raceDay.lastResult(c.id)), sponsor: this.raceDay.sponsorOf(c.id)?.name ?? null, live: this.raceDay.raceOn(c.id) } : undefined);
        const oy = slot * SLOT_H;
        ctx.fillStyle = '#f5d90a'; ctx.font = 'bold 15px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(l1, 8, oy + 12);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px monospace'; ctx.fillText(l2, 8, oy + 34);
        ctx.fillStyle = '#9ad1ff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(l3, 8, oy + 53);
      }
      slot++;
    }
    pos.needsUpdate = true; this.board.geometry.setDrawRange(0, slot * 12); this.board.visible = slot > 0;
    this.boardCount = slot;
    if (this.tex) this.tex.needsUpdate = true;
  }

  /** Triangles drawn (tests: the budget). */
  triangles(): number { return this.gateCount * GATE_TRIS + this.boardCount * 4; }
  dispose(): void { for (const m of this.mats) m.dispose(); for (const g of this.geos) g.dispose(); this.tex?.dispose(); }
}
