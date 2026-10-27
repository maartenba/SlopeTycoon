import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import { HEIGHT_UNIT } from '@/config/balance';
import { paintOverlay, type Coverage, type CoverageBuilding, type NetworkProvider, type OverlayMode, type SnowView } from '@/sim/Coverage';

const LIFT = 0.05;

/**
 * Ground-draped tinted decal: one shared-vertex heightfield mesh (N+1)^2 verts sampling one N*N RGBA DataTexture.
 * Also draws a service-radius ring. NOT verified at runtime (no WebGL in agent env).
 */
export class CoverageOverlay {
  readonly group = new THREE.Group();
  mode: OverlayMode = 'off';
  private readonly N: number;
  private readonly data: Uint8Array;
  private readonly tex: THREE.DataTexture;
  private readonly mesh: THREE.Mesh;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly ring: THREE.LineLoop;
  private readonly ringPos: THREE.BufferAttribute;
  private static readonly RING_SEGS = 128;
  private dirty = true;
  private heightsDirty = true;
  /** Minimum ms between repaints+texture uploads (frequent invalidations - snow, quality, networks - are coalesced). */
  minRepaintMs = 250;
  private lastPaint = -Infinity;
  repaints = 0;

  constructor(private grid: Grid, private cov: Coverage, private getBuildings: () => Iterable<CoverageBuilding>, private net: () => NetworkProvider, private getSnow?: () => SnowView | null, private getQuality?: () => Uint8Array | null, private getThreat?: () => Uint8Array | null, private getTraffic?: () => Uint16Array | null, private getGain?: () => Float32Array | null, private getRuns?: () => Uint16Array | null) {
    const N = this.N = grid.size, V = N + 1;
    this.data = new Uint8Array(N * N * 4);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    const pos = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
    for (let vy = 0; vy < V; vy++) for (let vx = 0; vx < V; vx++) {
      const i = vy * V + vx;
      pos[i * 3] = vx; pos[i * 3 + 2] = vy;
      uv[i * 2] = vx / N; uv[i * 2 + 1] = vy / N;
    }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = y * V + x, b = a + 1, c = a + V, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    const S = CoverageOverlay.RING_SEGS;
    this.ringPos = new THREE.BufferAttribute(new Float32Array(S * 3), 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', this.ringPos);
    this.ring = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 11;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  setMode(m: OverlayMode): void { this.mode = m; this.dirty = true; this.lastPaint = -Infinity; this.mesh.visible = m !== 'off'; }
  /** Call after placement/status/network changes. */
  invalidate(): void { this.dirty = true; }
  /** Call after terraforming. */
  invalidateHeights(): void { this.heightsDirty = true; }

  private heightAt(vx: number, vy: number): number {
    const g = this.grid;
    return g.getCorner(Math.max(0, Math.min(g.size, Math.round(vx))), Math.max(0, Math.min(g.size, Math.round(vy)))) * HEIGHT_UNIT + LIFT;
  }

  /** Per-frame: lazily rebuilds heights/texture only when dirty and visible. */
  update(): void {
    if (!this.mesh.visible) return;
    if (this.heightsDirty) {
      const V = this.N + 1, p = this.posAttr.array as Float32Array;
      for (let vy = 0; vy < V; vy++) for (let vx = 0; vx < V; vx++) p[(vy * V + vx) * 3 + 1] = this.grid.getCorner(vx, vy) * HEIGHT_UNIT + LIFT;
      this.posAttr.needsUpdate = true;
      this.heightsDirty = false;
    }
    if (this.dirty) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now - this.lastPaint < this.minRepaintMs) return; // coalesce bursts; stays dirty, painted on a later frame
      this.lastPaint = now; this.repaints++;
      paintOverlay(this.data, this.N, this.mode, this.cov, this.net(), this.getBuildings(), this.getSnow?.() ?? null, this.getQuality?.() ?? null, this.getThreat?.() ?? null, this.getTraffic?.() ?? null, this.getGain?.() ?? null, this.getRuns?.() ?? null);
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** Range ring centred on (cx,cy) tile coords with radius in tiles; null hides it. */
  setRing(cx: number | null, cy = 0, radius = 0, color = 0xffffff): void {
    if (cx === null || radius <= 0) { this.ring.visible = false; return; }
    const S = CoverageOverlay.RING_SEGS, p = this.ringPos.array as Float32Array;
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      const x = Math.max(0, Math.min(this.N, cx + Math.cos(a) * radius)), y = Math.max(0, Math.min(this.N, cy + Math.sin(a) * radius));
      p[i * 3] = x; p[i * 3 + 1] = this.heightAt(x, y) + 0.05; p[i * 3 + 2] = y;
    }
    this.ringPos.needsUpdate = true;
    (this.ring.material as THREE.LineBasicMaterial).color.setHex(color);
    this.ring.visible = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.dispose();
    this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
  }
}
