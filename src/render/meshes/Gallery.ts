import * as THREE from 'three';
import { BUILDINGS } from '../../config/buildings';
import { LIFT_KIND_IDS, LIFTS, type LiftKind } from '../../config/lifts';
import { LIFT_STATION_HEAD } from '../../config/balance';
import type { BuildingMeshes } from './index';
import { buildStationParts } from './lifts/Station';
import { buildTowerGeometry } from './lifts/Tower';
import { buildCarrierGeometry } from './lifts';
import { glassGroups, liftGlassMaterial, liftMaterial } from './lifts/geo';
import { createSignTexture } from '../textures/sign';

/** Small canvas-text sprite used for gallery labels. Null without a DOM. */
export function makeLabelSprite(text: string, w = 3.2, h = 0.8): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = 'rgba(20,24,32,0.78)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#fff';
  g.font = 'bold 28px sans-serif';
  g.textBaseline = 'middle';
  let size = 28;
  while (g.measureText(text).width > 240 && size > 10) { size -= 2; g.font = `bold ${size}px sans-serif`; }
  g.textAlign = 'center';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w, h, 1);
  s.renderOrder = 10;
  return s;
}

export interface ModelGallery { group: THREE.Group; dispose(): void }

/**
 * Debug gallery: every catalog building in a labelled grid, then one labelled row per lift kind showing
 * bottom station, top station, a tower and the carrier. Laid out from (ox, oy, oz) towards -z at a flat height.
 */
export function buildModelGallery(meshes: BuildingMeshes, ox: number, oy: number, oz: number): ModelGallery {
  const group = new THREE.Group();
  group.name = 'model-gallery';
  const disposables: Array<{ dispose(): void }> = [];
  const label = (text: string, x: number, y: number, z: number, w?: number): void => {
    const s = makeLabelSprite(text, w);
    if (!s) return;
    s.position.set(x, y, z);
    group.add(s);
    disposables.push(s.material, s.material.map!);
  };
  const defs = Object.values(BUILDINGS);
  const cols = 8, cell = 7.5;
  defs.forEach((d, i) => {
    const g = meshes.create(d.id, undefined, d.id);
    const x = ox + ((i % cols) - (cols - 1) / 2) * cell, z = oz - 4 - Math.floor(i / cols) * cell;
    g.position.set(x, oy, z);
    group.add(g);
    label(d.name, x, oy + 3.2, z + d.h / 2 + 0.8);
  });
  const rows = Math.ceil(defs.length / cols);
  const mat = liftMaterial(), glass = liftGlassMaterial();
  const cableMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  disposables.push(mat, glass, cableMat);
  const z0 = oz - 4 - rows * cell - 2;
  LIFT_KIND_IDS.forEach((kind: LiftKind, i) => {
    const z = z0 - i * 4.6;
    const x0 = ox - 14;
    label(LIFTS[kind].name, x0 - 2.6, oy + 1.6, z, 4.2);
    const add = (geo: THREE.BufferGeometry, x: number, y = 0, zz = 0, m: THREE.Material | THREE.Material[] = mat): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, oy + y, z + zz);
      group.add(mesh);
      disposables.push(geo);
      return mesh;
    };
    ([['bottom', false, x0 + 2], ['top', true, x0 + 6]] as const).forEach(([name, isTop, x]) => {
      const p = buildStationParts(kind, isTop);
      add(p.geometry, x);
      if (p.sign) {
        const tex = createSignTexture(p.sign.text, p.sign.bg, p.sign.fg);
        const sm = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        disposables.push(sm); if (tex) disposables.push(tex);
        add(p.sign.geometry, x, 0, 0, sm);
      }
      label(name, x, oy + 2.9, z + 1.2, 1.6);
    });
    add(buildTowerGeometry(3, kind), x0 + 9.5);
    label('tower', x0 + 9.5, oy + 3.5, z + 1.2, 1.6);
    const cg = buildCarrierGeometry(kind);
    const funi = LIFTS[kind].family === 'funicular';
    const cm = add(cg, x0 + 12, funi ? 0.1 : LIFT_STATION_HEAD, 0, glassGroups(cg) ? [mat, glass] : mat);
    if (funi) {
      for (const dx of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.05, 0.05, 2.4), x0 + 12 + dx, 0.06, 0, cableMat);
      cm.rotation.x = 0;
    } else add(new THREE.BoxGeometry(0.04, 0.04, 2.4), x0 + 12, LIFT_STATION_HEAD, 0, cableMat);
    label('carrier', x0 + 12, oy + 2.4, z + 1.2, 1.6);
  });
  return { group, dispose: () => { for (const d of disposables) d.dispose(); group.clear(); } };
}
