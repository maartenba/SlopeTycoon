import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STRAND_OFFSET, samplePath, type CablePath } from '../../../sim/Lift';

/** Min strand radius (tiles): thinner cables alias to a shimmering hairline at iso zoom. Visual only (clearance logic uses the sim path). */
export const CABLE_RADIUS = 0.036;

/** Two thin tube strands (uphill/downhill) following the sagged path. Pure geometry. */
export function buildCableGeometry(path: CablePath, radius = CABLE_RADIUS): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const lat of [STRAND_OFFSET, -STRAND_OFFSET]) {
    const pts = path.cum.map((d) => {
      const s = samplePath(path, d, lat);
      return new THREE.Vector3(s.x, s.y, s.z);
    });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const g = new THREE.TubeGeometry(curve, Math.max(2, pts.length), radius, 4, false);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    geos.push(g);
  }
  return mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
}

/**
 * NEAR cable (ground cameras): a proper round tube (8 radial segments, ~1.3x radius) rendered with the lit vertex-colour material, with a spiral of
 * light / mid steel-grey stripes that reads as twisted strands (not a flat dark band). Same path as the base cable; extra ring subdivisions keep it smooth.
 */
export function buildCableNearGeometry(path: CablePath, radius = 0.032, radial = 8): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const light = new THREE.Color(0xc9ced4), mid = new THREE.Color(0x8e959d);
  for (const lat of [STRAND_OFFSET, -STRAND_OFFSET]) {
    const pts = path.cum.map((d) => { const s = samplePath(path, d, lat); return new THREE.Vector3(s.x, s.y, s.z); });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const tubular = Math.max(4, pts.length * 3);
    const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const col = new Float32Array(g.getAttribute('position').count * 3);
    const row = radial + 1;
    for (let i = 0; i <= tubular; i++) for (let j = 0; j < row; j++) {
      const c = ((j + Math.floor(i / 2)) % 4) < 2 ? light : mid; // spiral stripes
      const o = (i * row + j) * 3;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
}
