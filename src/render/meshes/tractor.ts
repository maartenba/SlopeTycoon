import * as THREE from 'three';
import { blob, mergeParts, tube, triCount, type AirPart, type V3 } from './sweepGeo';

/**
 * Farm tractor, hay trailer and round bale (docs/farm-work.md). Forward = +x, up = +y, tiles. Smooth lofted bonnet (sweepGeo `blob`), cab with a glass band, big lugged rear wheels, small
 * front wheels, exhaust stack and a farmer in a straw hat at the wheel; vertex-coloured, merged into ONE geometry each (one instanced draw call per kind).
 * Budget: tractor <= ~1,000 triangles, trailer <= ~450, bale 96, hay loaf <= 90; three liveries (`LIVERY`). All pure and deterministic.
 */
export const TRACTOR = {
  /** Where the trailer hooks on (behind the tractor, tiles from its centre) and the trailer's own axle offset behind the hitch. */
  hitch: 0.3, trailerAxle: 0.58,
  /** Exhaust stack top in tractor space. */
  stack: [0.2, 0.46, 0.09] as V3,
  /** Colours (variant 0 = red; `LIVERY` holds the green and blue ones): cream roof, straw hat. */
  body: 0xc2362e, roof: 0xeee6d2, glass: 0x7da6be, tyre: 0x1c1c1e, hub: 0xe3be4a, hat: 0xd9b95a, coat: 0x35609a,
} as const;
/** Livery per farm (stable hash picks the index): body, darker chassis / mudguard shade, farmer's jacket. */
export const LIVERY = [
  { body: 0xc2362e, dark: 0x7e2420, coat: 0x35609a, hub: 0xe3be4a },
  { body: 0x3f8a3c, dark: 0x27592a, coat: 0x8a3a2e, hub: 0xe3be4a },
  { body: 0x2f68a8, dark: 0x1f4470, coat: 0x6b7f3a, hub: 0xd9d9d0 },
] as const;
export const LIVERY_COUNT = LIVERY.length;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): AirPart => ({ geo: new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed(), color });
const cyl = (r: number, len: number, seg: number, x: number, y: number, z: number, color: number, axis: 'z' | 'y' = 'z'): AirPart => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return { geo: g.translate(x, y, z).toNonIndexed(), color };
};
/** A tyre on the z axis: rim-less black cylinder, hub, and `lugs` radial tread blocks (rear wheels). */
function wheel(x: number, y: number, z: number, r: number, w: number, seg: number, lugs: number, hub: number = TRACTOR.hub): AirPart[] {
  const out = [cyl(r, w, seg, x, y, z, TRACTOR.tyre)];
  if (lugs > 0) out.push(cyl(r * 0.5, w + 0.014, 6, x, y, z, hub));
  for (let i = 0; i < lugs; i++) {
    const a = ((i + 0.5) / lugs) * Math.PI * 2, g = new THREE.BoxGeometry(r * 0.34, r * 0.24, w * 1.04).rotateZ(a + Math.PI / 2).translate(x + Math.cos(a) * (r + 0.004), y + Math.sin(a) * (r + 0.004), z).toNonIndexed();
    out.push({ geo: g, color: TRACTOR.tyre });
  }
  return out;
}

export function tractorParts(variant = 0): AirPart[] {
  const T = TRACTOR, L = LIVERY[((variant % LIVERY_COUNT) + LIVERY_COUNT) % LIVERY_COUNT]!, P: AirPart[] = [];
  const dark = 0x2a2a2e;
  P.push(...blob([0.17, 0.2, 0], [0.23, 0.085, 0.1], 10, 5, L.body, 'x')); // lofted, curved bonnet
  P.push(...blob([0.2, 0.275, 0], [0.12, 0.03, 0.06], 8, 3, L.dark, 'x')); // darker hood crown stripe
  P.push(box(0.025, 0.07, 0.15, 0.4, 0.15, 0, 0xcfd2d4)); // grille
  for (const s of [-1, 1]) P.push(cyl(0.022, 0.02, 5, 0.41, 0.25, s * 0.075, 0xf6efc0, 'z')); // round headlights
  P.push(box(0.1, 0.03, 0.17, 0.4, 0.09, 0, 0x3b3b40)); // front weight / bumper
  P.push(box(0.5, 0.05, 0.12, 0.0, 0.1, 0, L.dark)); // darker chassis (sits between the wheels)
  P.push(box(0.03, 0.06, 0.25, 0.25, 0.2, 0, dark)); // front axle
  // cab: glass band, rounded roof with a visor, posts
  P.push(box(0.24, 0.12, 0.2, -0.12, 0.3, 0, T.glass));
  P.push(box(0.3, 0.025, 0.26, -0.12, 0.42, 0, T.roof)); P.push(box(0.05, 0.02, 0.26, 0.05, 0.415, 0, T.roof)); // roof + sun visor
  for (const [x, z] of [[-0.23, 0.1], [-0.23, -0.1], [-0.01, 0.1], [-0.01, -0.1]] as const) P.push(box(0.025, 0.12, 0.025, x, 0.3, z, L.body));
  P.push(box(0.1, 0.05, 0.12, -0.19, 0.21, 0, 0x3a3226)); // seat
  // farmer at the wheel: jacket, head, hat with a band
  P.push(box(0.07, 0.1, 0.09, -0.13, 0.25, 0, L.coat));
  P.push(...blob([-0.13, 0.4, 0], [0.035, 0.038, 0.036], 6, 4, 0xe3b48f, 'y'));
  P.push(cyl(0.062, 0.012, 8, -0.13, 0.43, 0, T.hat, 'y'), cyl(0.034, 0.03, 6, -0.13, 0.45, 0, T.hat, 'y'), cyl(0.036, 0.008, 6, -0.13, 0.436, 0, 0x8a3a2e, 'y'));
  // exhaust stack with a cap + rotating-beacon housing on the roof
  P.push(cyl(0.011, 0.22, 5, T.stack[0], 0.36, T.stack[2], 0x151515, 'y'), cyl(0.017, 0.012, 6, T.stack[0], 0.468, T.stack[2], 0x3b3b40, 'y'));
  P.push(cyl(0.016, 0.03, 5, -0.22, 0.45, 0.0, 0xf0a030, 'y'));
  // rear mudguards over the big wheels (curved: flattened blobs) + headlight bar behind the grille
  for (const s of [-1, 1]) P.push(...blob([-0.14, 0.27, s * 0.195], [0.15, 0.025, 0.055], 8, 3, L.dark, 'x'));
  P.push(box(0.04, 0.03, 0.04, -0.33, 0.14, 0, 0x3b3b40)); // rear hitch
  // wheels: big deep-lugged rears, small fronts
  for (const s of [-1, 1]) { P.push(...wheel(-0.14, 0.14, s * 0.185, 0.14, 0.08, 10, 6, L.hub)); P.push(...wheel(0.26, 0.075, s * 0.135, 0.075, 0.05, 8, 0, L.hub)); }
  return P;
}
export function trailerParts(): AirPart[] {
  const P: AirPart[] = [], wood = 0x8a6a42, side = 0xb08a55, post = 0x6e5233, A = TRACTOR.trailerAxle, dark = 0x2a2a2e;
  P.push(box(0.64, 0.03, 0.32, -A, 0.13, 0, wood)); // deck
  for (const s of [-1, 1]) { P.push(box(0.64, 0.025, 0.015, -A, 0.165, s * 0.155, side), box(0.64, 0.025, 0.015, -A, 0.2, s * 0.155, side)); } // slatted side boards (two slats, a gap)
  for (const e of [-1, 1]) P.push(box(0.015, 0.025, 0.3, -A + e * 0.315, 0.165, 0, side), box(0.015, 0.025, 0.3, -A + e * 0.315, 0.2, 0, side)); // slatted ends
  for (const s of [-1, 1]) for (const x of [-0.3, 0, 0.3]) P.push(box(0.02, 0.1, 0.02, -A + x, 0.15, s * 0.16, post)); // stakes
  P.push(...tube([[-A + 0.3, 0.13, 0.05], [0.04, 0.12, 0]], [0.011, 0.011], 4, dark), ...tube([[-A + 0.3, 0.13, -0.05], [0.04, 0.12, 0]], [0.011, 0.011], 4, dark)); // A-frame drawbar
  P.push(box(0.03, 0.04, 0.38, -A - 0.02, 0.08, 0, dark)); // axle
  for (const s of [-1, 1]) { P.push(...wheel(-A - 0.02, 0.085, s * 0.2, 0.085, 0.05, 10, 0)); P.push(...blob([-A - 0.02, 0.19, s * 0.2], [0.1, 0.02, 0.035], 6, 3, side, 'x')); } // wheels + rounded arches
  return P;
}
const setColors = (g: THREE.BufferGeometry, f: (cx: number, cy: number, cz: number, tri: number) => number): THREE.BufferGeometry => {
  const pos = g.getAttribute('position'), n = pos.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let t = 0; t < n / 3; t++) {
    const cx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3, cy = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3, cz = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
    c.setHex(f(cx, cy, cz, t));
    for (let k = 0; k < 3; k++) { col[(t * 3 + k) * 3] = c.r; col[(t * 3 + k) * 3 + 1] = c.g; col[(t * 3 + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
};
/** A unit round bale lying on its side: radius 1 (x, y), width 1 (z): scale per instance. Straw net stripes, a pale-green wrap band in the middle, darker cut ends (96 triangles). */
export function baleGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 12, 3).rotateX(Math.PI / 2).toNonIndexed();
  return setColors(g, (cx, cy, cz) => {
    if (Math.abs(cz) > 0.499 && Math.hypot(cx, cy) < 0.95) return 0xc29a3c;
    if (Math.abs(cz) < 0.2) return 0xcfdcc2; // wrap band
    return Math.floor(((Math.atan2(cy, cx) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? 0xdcbc5a : 0xe6c868;
  });
}
/** The hay heap on the trailer: a unit dome (radius 1, base on y = 0, length along z) with straw strand stripes (84 triangles at most). */
export function loafGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  return setColors(g, (cx, cy, cz, t) => { const a = Math.floor(((Math.atan2(cy, cx) + Math.PI) / (Math.PI * 2)) * 12) + Math.floor((cz + 1) * 2); return (a + (t & 1)) % 3 === 0 ? 0xc9a84c : a % 2 ? 0xdcbc5a : 0xe8cc70; });
}
export const tractorGeometry = (variant = 0): THREE.BufferGeometry => mergeParts(tractorParts(variant));
export const trailerGeometry = (): THREE.BufferGeometry => mergeParts(trailerParts());
export const tractorTris = (variant = 0): number => triCount(tractorParts(variant));
export const trailerTris = (): number => triCount(trailerParts());
