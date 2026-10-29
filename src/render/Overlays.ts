import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import { HEIGHT_UNIT } from '@/config/balance';

export interface TooltipData {
  /** Cost in money (0 if nothing to do). */
  cost: number;
  text: string;
  blocked: boolean;
  /** Optional structured lines (error/warn/info/ok); the UI falls back to `text`. */
  lines?: Array<{ kind: 'error' | 'warn' | 'info' | 'ok'; text: string }>;
  /** Screen position hint (client px) if known. */
  x: number;
  y: number;
}

const LIFT = 0.06;
const MAX_POINTS = 4 * (5 + 1) * 8 + 64;
const MAX_PREVIEW_POINTS = 12000;
const RIVER_COLD = new THREE.Color(0x4fc3ff), RIVER_HOT = new THREE.Color(0xff8a2a);
const CUT_COLOR = new THREE.Color(0xff9a3c), FILL_COLOR = new THREE.Color(0x4fb4ff);

/** Hover/brush outline draped on terrain heights. Uses grid data, so it works with any LOD. */
export class Overlays {
  readonly group = new THREE.Group();
  /** Latest tooltip data for the UI (null when nothing hovered). */
  tooltip: TooltipData | null = null;
  onTooltip: ((t: TooltipData | null) => void) | null = null;
  /** Fired with the latest outline rect (vertex coords) or null when hidden; used for range rings. */
  onRect: ((r: { vx0: number; vy0: number; vx1: number; vy1: number } | null) => void) | null = null;
  private readonly line: THREE.LineSegments;
  private readonly pos: THREE.BufferAttribute;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly prevPos: THREE.BufferAttribute;
  private readonly prevCol: THREE.BufferAttribute;
  private readonly prev: THREE.LineSegments;

  constructor(private grid: Grid) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ color: 0xffee55, depthTest: false, transparent: true });
    this.line = new THREE.LineSegments(geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 10;
    this.group.add(this.line);
    // Faint terraform preview: outline of the levelled area + a tick per changed corner (orange = cut, blue = fill).
    const pg = new THREE.BufferGeometry();
    this.prevPos = new THREE.BufferAttribute(new Float32Array(MAX_PREVIEW_POINTS * 3), 3);
    this.prevCol = new THREE.BufferAttribute(new Float32Array(MAX_PREVIEW_POINTS * 3), 3);
    this.prevPos.setUsage(THREE.DynamicDrawUsage); this.prevCol.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.prevPos); pg.setAttribute('color', this.prevCol);
    pg.setDrawRange(0, 0);
    this.prev = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.55 }));
    this.prev.frustumCulled = false;
    this.prev.renderOrder = 9;
    this.group.add(this.prev);
    this.group.visible = false;
  }

  /** Levelling preview (null clears): faint outline of the changed area in `hex`, cut/fill ticks per changed corner. */
  setTerraformPreview(changes: ReadonlyArray<{ vx: number; vy: number; from: number; to: number }> | null, hex = 0xffffff): void {
    const pos = this.prevPos.array as Float32Array, col = this.prevCol.array as Float32Array;
    let n = 0;
    const put = (x: number, y: number, z: number, c: THREE.Color): void => {
      if (n >= MAX_PREVIEW_POINTS) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
      n++;
    };
    if (changes && changes.length) {
      const g = this.grid, tiles = new Set<number>();
      const base = new THREE.Color(hex);
      for (const c of changes) for (let ty = c.vy - 1; ty <= c.vy; ty++) for (let tx = c.vx - 1; tx <= c.vx; tx++) if (g.inBounds(tx, ty)) tiles.add(ty * g.size + tx);
      const P = (vx: number, vy: number): [number, number, number] => [vx, g.getCorner(vx, vy) * HEIGHT_UNIT + LIFT, vy];
      const has = (tx: number, ty: number): boolean => tiles.has(ty * g.size + tx);
      for (const t of tiles) {
        const tx = t % g.size, ty = (t / g.size) | 0;
        const seg = (a: [number, number, number], b: [number, number, number]): void => { put(...a, base); put(...b, base); };
        if (!has(tx, ty - 1)) seg(P(tx, ty), P(tx + 1, ty));
        if (!has(tx, ty + 1)) seg(P(tx, ty + 1), P(tx + 1, ty + 1));
        if (!has(tx - 1, ty)) seg(P(tx, ty), P(tx, ty + 1));
        if (!has(tx + 1, ty)) seg(P(tx + 1, ty), P(tx + 1, ty + 1));
      }
      for (const c of changes) {
        const y0 = c.from * HEIGHT_UNIT + LIFT, y1 = c.to * HEIGHT_UNIT + LIFT;
        const k = c.to < c.from ? CUT_COLOR : FILL_COLOR;
        put(c.vx, y0, c.vy, k); put(c.vx, y1, c.vy, k);
      }
    }
    this.prevPos.needsUpdate = true; this.prevCol.needsUpdate = true;
    this.prev.geometry.setDrawRange(0, n);
  }

  /**
   * River ghost (Phase 6 Task 14): outlines the channel tiles (edges shared with the next channel tile are skipped) coloured by cut depth (blue = no digging,
   * orange = deepest cut) and ticks the corners the dig moves. Shares the preview line buffer, so it costs no extra draw call. `null` / empty clears.
   */
  setRiverGhost(path: ReadonlyArray<{ x: number; y: number }> | null, depth: ReadonlyArray<number> = [], changed: ReadonlyArray<{ vx: number; vy: number; from: number; to: number }> = [], maxDepth = 6): void {
    const pos = this.prevPos.array as Float32Array, col = this.prevCol.array as Float32Array;
    let n = 0;
    const put = (x: number, y: number, z: number, c: THREE.Color): void => {
      if (n >= MAX_PREVIEW_POINTS) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
      n++;
    };
    if (path && path.length) {
      const g = this.grid, have = new Set(path.map((p) => p.y * g.size + p.x)), c = new THREE.Color();
      const P = (vx: number, vy: number): [number, number, number] => [vx, g.getCorner(vx, vy) * HEIGHT_UNIT + LIFT, vy];
      const has = (tx: number, ty: number): boolean => have.has(ty * g.size + tx);
      path.forEach((t, k) => {
        c.copy(RIVER_COLD).lerp(RIVER_HOT, Math.max(0, Math.min(1, (depth[k] ?? 0) / Math.max(1, maxDepth))));
        const seg = (a: [number, number, number], b: [number, number, number]): void => { put(...a, c); put(...b, c); };
        if (!has(t.x, t.y - 1)) seg(P(t.x, t.y), P(t.x + 1, t.y));
        if (!has(t.x, t.y + 1)) seg(P(t.x, t.y + 1), P(t.x + 1, t.y + 1));
        if (!has(t.x - 1, t.y)) seg(P(t.x, t.y), P(t.x, t.y + 1));
        if (!has(t.x + 1, t.y)) seg(P(t.x + 1, t.y), P(t.x + 1, t.y + 1));
        // a cross through the tile centre so a one-tile-wide channel reads as a ribbon
        const a = P(t.x, t.y), b = P(t.x + 1, t.y + 1), a2 = P(t.x + 1, t.y), b2 = P(t.x, t.y + 1);
        put(...a, c); put(...b, c); put(...a2, c); put(...b2, c);
      });
      for (const ch of changed) {
        const k = ch.to < ch.from ? CUT_COLOR : FILL_COLOR;
        put(ch.vx, ch.from * HEIGHT_UNIT + LIFT, ch.vy, k); put(ch.vx, ch.to * HEIGHT_UNIT + LIFT, ch.vy, k);
      }
    }
    this.prevPos.needsUpdate = true; this.prevCol.needsUpdate = true;
    this.prev.geometry.setDrawRange(0, n);
    if (n > 0) this.group.visible = true;
  }

  setColor(hex: number): void {
    this.mat.color.setHex(hex);
  }

  /** Outline of an inclusive vertex rect; a degenerate rect draws a corner marker diamond. */
  setVertexRect(vx0: number, vy0: number, vx1: number, vy1: number): void {
    const pts: number[] = [];
    const g = this.grid;
    const P = (vx: number, vy: number): [number, number, number] =>
      [vx, g.getCorner(Math.max(0, Math.min(g.size, vx)), Math.max(0, Math.min(g.size, vy))) * HEIGHT_UNIT + LIFT, vy];
    const seg = (a: [number, number, number], b: [number, number, number]): void => { pts.push(...a, ...b); };
    if (vx0 === vx1 && vy0 === vy1) {
      const c = P(vx0, vy0);
      const r = 0.3;
      const q: Array<[number, number, number]> = [
        [c[0] - r, c[1], c[2]], [c[0], c[1], c[2] - r], [c[0] + r, c[1], c[2]], [c[0], c[1], c[2] + r],
      ];
      for (let i = 0; i < 4; i++) seg(q[i]!, q[(i + 1) % 4]!);
    } else {
      for (let x = vx0; x < vx1; x++) { seg(P(x, vy0), P(x + 1, vy0)); seg(P(x, vy1), P(x + 1, vy1)); }
      for (let y = vy0; y < vy1; y++) { seg(P(vx0, y), P(vx0, y + 1)); seg(P(vx1, y), P(vx1, y + 1)); }
    }
    const n = Math.min(pts.length / 3, MAX_POINTS);
    (this.pos.array as Float32Array).set(pts.slice(0, n * 3));
    this.pos.needsUpdate = true;
    this.line.geometry.setDrawRange(0, n);
    this.group.visible = true;
    this.onRect?.({ vx0, vy0, vx1, vy1 });
  }

  hide(): void {
    this.setTerraformPreview(null);
    this.group.visible = false;
    this.onRect?.(null);
    this.setTooltip(null);
  }

  setTooltip(t: TooltipData | null): void {
    this.tooltip = t;
    this.onTooltip?.(t);
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.prev.geometry.dispose();
    this.mat.dispose();
  }
}
