import * as THREE from 'three';
import { blob, mergeParts, tube, triCount, type AirPart, type V3 } from './sweepGeo';

/**
 * Farm tractor, hay trailer and round bale (docs/farm-work.md). Forward = +x, up = +y, tiles. Smooth lofted bonnet (sweepGeo `blob`), cab with a glass band, big lugged rear wheels, small
 * front wheels, exhaust stack and a farmer in a straw hat at the wheel; vertex-coloured, merged into ONE geometry each (one instanced draw call per kind).
 * Budget: tractor <= ~750 triangles, trailer <= ~400, bale 40. All pure and deterministic.
 */
export const TRACTOR = {
  /** Where the trailer hooks on (behind the tractor, tiles from its centre) and the trailer's own axle offset behind the hitch. */
  hitch: 0.3, trailerAxle: 0.58,
  /** Exhaust stack top in tractor space. */
  stack: [0.2, 0.46, 0.09] as V3,
  /** Colours: red body, cream roof, straw hat. */
  body: 0xc2362e, roof: 0xeee6d2, glass: 0x7da6be, tyre: 0x1c1c1e, hub: 0xe3be4a, hat: 0xd9b95a, coat: 0x35609a,
} as const;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): AirPart => ({ geo: new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed(), color });
const cyl = (r: number, len: number, seg: number, x: number, y: number, z: number, color: number, axis: 'z' | 'y' = 'z'): AirPart => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return { geo: g.translate(x, y, z).toNonIndexed(), color };
};
/** A tyre on the z axis: rim-less black cylinder, hub, and `lugs` radial tread blocks (rear wheels). */
function wheel(x: number, y: number, z: number, r: number, w: number, seg: number, lugs: number): AirPart[] {
  const out = [cyl(r, w, seg, x, y, z, TRACTOR.tyre), cyl(r * 0.5, w + 0.014, 6, x, y, z, TRACTOR.hub)];
  for (let i = 0; i < lugs; i++) {
    const a = ((i + 0.5) / lugs) * Math.PI * 2, g = new THREE.BoxGeometry(r * 0.3, r * 0.2, w * 1.02).rotateZ(a + Math.PI / 2).translate(x + Math.cos(a) * (r + 0.004), y + Math.sin(a) * (r + 0.004), z).toNonIndexed();
    out.push({ geo: g, color: TRACTOR.tyre });
  }
  return out;
}

export function tractorParts(): AirPart[] {
  const T = TRACTOR, P: AirPart[] = [];
  P.push(...blob([0.17, 0.2, 0], [0.22, 0.082, 0.095], 10, 5, T.body, 'x')); // lofted bonnet
  P.push(box(0.1, 0.03, 0.16, 0.36, 0.17, 0, 0x3b3b40)); // front weight / bumper
  P.push(box(0.48, 0.05, 0.12, 0.0, 0.1, 0, 0x2a2a2e)); // chassis (sits between the wheels)
  P.push(box(0.03, 0.07, 0.25, 0.25, 0.2, 0, 0x2a2a2e)); // front axle
  // cab: floor, glass band, cream roof, four slim posts
  P.push(box(0.24, 0.12, 0.2, -0.12, 0.3, 0, T.glass));
  P.push(box(0.29, 0.03, 0.25, -0.12, 0.43, 0, T.roof));
  for (const [x, z] of [[-0.23, 0.1], [-0.23, -0.1]] as const) P.push(box(0.03, 0.13, 0.03, x, 0.3, z, T.body));
  P.push(box(0.1, 0.05, 0.12, -0.19, 0.21, 0, 0x3a3226)); // seat
  // farmer at the wheel
  P.push(box(0.07, 0.1, 0.09, -0.13, 0.25, 0, T.coat));
  P.push(...blob([-0.13, 0.4, 0], [0.035, 0.038, 0.036], 6, 4, 0xe3b48f, 'y'));
  P.push(cyl(0.062, 0.012, 8, -0.13, 0.43, 0, T.hat, 'y'), cyl(0.034, 0.03, 6, -0.13, 0.45, 0, T.hat, 'y')); // straw hat: brim + crown
  // exhaust
  P.push(cyl(0.011, 0.22, 5, T.stack[0], 0.36, T.stack[2], 0x151515, 'y'));
  // rear mudguards + headlight bar
  for (const s of [-1, 1]) P.push(box(0.17, 0.02, 0.08, -0.14, 0.26, s * 0.19, T.body));
  P.push(box(0.025, 0.035, 0.2, 0.38, 0.22, 0, 0xf1e6b0));
  // wheels: big lugged rear, small front
  for (const s of [-1, 1]) { P.push(...wheel(-0.14, 0.14, s * 0.185, 0.14, 0.08, 10, 5)); P.push(...wheel(0.26, 0.075, s * 0.135, 0.075, 0.05, 8, 0)); }
  return P;
}
export function trailerParts(): AirPart[] {
  const P: AirPart[] = [], wood = 0x8a6a42, side = 0xa4814f, A = TRACTOR.trailerAxle;
  P.push(box(0.64, 0.03, 0.32, -A + 0.0, 0.13, 0, wood)); // deck
  for (const s of [-1, 1]) P.push(box(0.64, 0.07, 0.025, -A, 0.16, s * 0.15, side)); // low side boards
  P.push(box(0.025, 0.07, 0.3, -A - 0.31, 0.16, 0, side), box(0.025, 0.07, 0.3, -A + 0.31, 0.16, 0, side)); // end boards
  P.push(...tube([[-A + 0.3, 0.13, 0], [0.04, 0.12, 0]], [0.014, 0.014], 5, 0x2a2a2e)); // drawbar to the hitch
  P.push(box(0.03, 0.04, 0.38, -A - 0.02, 0.08, 0, 0x2a2a2e)); // axle
  for (const s of [-1, 1]) P.push(...wheel(-A - 0.02, 0.085, s * 0.2, 0.085, 0.05, 10, 0));
  return P;
}
/** A unit round bale lying on its side: radius 1 (x, y), width 1 (z): scale per instance. Straw sides, darker cut ends. */
export function baleGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2).toNonIndexed();
  const n = g.getAttribute('position').count, nor = g.getAttribute('normal'), col = new Float32Array(n * 3), side = new THREE.Color(0xdcbc5a), end = new THREE.Color(0xc29a3c);
  for (let i = 0; i < n; i++) { const c = Math.abs(nor.getZ(i)) > 0.9 ? end : side; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}
export const tractorGeometry = (): THREE.BufferGeometry => mergeParts(tractorParts());
export const trailerGeometry = (): THREE.BufferGeometry => mergeParts(trailerParts());
export const tractorTris = (): number => triCount(tractorParts());
export const trailerTris = (): number => triCount(trailerParts());
