import * as THREE from 'three';
import type { Grid } from '@/world/Grid';
import type { Wedding } from '@/sim/events/Wedding';
import { surfaceHeightAt } from '@/render/meshes/Paths';
import { PartySet, GUEST_VARIANTS, type FigureFrame, type FigureKind } from '@/render/meshes/weddingParty';

/**
 * Wedding party view (0.7.1, docs/chapel.md): up to six small people, one Lambert vertex-coloured mesh each (shared geometry, ONE material: <= 6 draw calls, only while a wedding is on).
 * Read-only: positions come from `Wedding.poseOf` (a pure function of the saved record and the clock); the view only smooths the per-minute steps and draws the stride.
 */
export class WeddingView {
  readonly group = new THREE.Group();
  private set = new PartySet();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private figs: Array<{ mesh: THREE.Mesh; kind: FigureKind; variant: number; x: number; z: number; yaw: number; seen: boolean }> = [];
  /** Figures drawn last frame (tests / debug). */
  visibleCount = 0;

  constructor(private grid: Grid, private wedding: Wedding, private now: () => number) {
    this.group.name = 'weddingParty'; this.mat.name = 'weddingParty';
    for (let i = 0; i < 6; i++) {
      const kind: FigureKind = i === 0 ? 'bride' : i === 1 ? 'groom' : 'guest', variant = i % GUEST_VARIANTS;
      const mesh = new THREE.Mesh(this.set.get(kind, 'stand', variant), this.mat); mesh.name = 'weddingParty'; mesh.visible = false; mesh.castShadow = true;
      this.group.add(mesh); this.figs.push({ mesh, kind, variant, x: 0, z: 0, yaw: 0, seen: false });
    }
  }

  update(dt: number): void {
    const t = this.now(), n = this.wedding.rec?.guests ?? 0;
    let shown = 0;
    for (let i = 0; i < this.figs.length; i++) {
      const f = this.figs[i]!, p = i < n ? this.wedding.poseOf(i, t) : null;
      if (!p) { f.mesh.visible = false; f.seen = false; continue; }
      if (!f.seen) { f.x = p.x; f.z = p.y; f.yaw = p.yaw; f.seen = true; }
      const dx = p.x - f.x, dz = p.y - f.z;
      if (Math.hypot(dx, dz) > 3) { f.x = p.x; f.z = p.y; } else { const k = 1 - Math.exp(-Math.max(0, dt) * 8); f.x += dx * k; f.z += dz * k; }
      let dy = p.yaw - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); f.yaw += dy * (1 - Math.exp(-Math.max(0, dt) * 6));
      const frame: FigureFrame = p.mode === 'stand' ? 'stand' : Math.floor(p.dist / 0.2) % 2 === 0 ? 'walkA' : 'walkB';
      const g = this.set.get(f.kind, frame, f.variant);
      if (f.mesh.geometry !== g) f.mesh.geometry = g;
      f.mesh.rotation.y = f.yaw;
      f.mesh.position.set(f.x, surfaceHeightAt(this.grid, f.x, f.z), f.z);
      f.mesh.visible = true; shown++;
    }
    this.visibleCount = shown;
  }

  dispose(): void { this.set.dispose(); this.mat.dispose(); }
}
