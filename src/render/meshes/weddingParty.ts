import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Wedding party figures (0.7.1, docs/chapel.md): small vertex-coloured people, ~0.5 tile tall, forward = +z. The bride (white dress, veil, a pink bouquet), the groom (dark suit,
 * red bow tie) and the guests (festive coats). Three frames each (stand, two walking strides): geometry is built once and shared, about 120-220 triangles per figure.
 */
export type FigureKind = 'bride' | 'groom' | 'guest';
export type FigureFrame = 'stand' | 'walkA' | 'walkB';
const GUEST_COATS = [0x3f6fb0, 0xb04a5a, 0x4f9a6a, 0xd9a441, 0x7a5aa8, 0x2f8f9a] as const;
const SKINS = [0xf1c9a5, 0xd9a47a, 0xb87a52, 0x8a5a3a] as const;
const HAIRS = [0x2a1f1a, 0x5a3a22, 0xc9a24a, 0x8a8a90] as const;
export const GUEST_VARIANTS = GUEST_COATS.length;

const paint = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count, c = new THREE.Color(color), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, color: number, seg = 7, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1); g.rotateX(rx); g.translate(x, y + h / 2, z); return paint(g.toNonIndexed(), color);
};
const ball = (r: number, x: number, y: number, z: number, color: number, sy = 1): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(r, 8, 6); g.scale(1, sy, 1); g.translate(x, y, z); return paint(g.toNonIndexed(), color);
};

/** One figure in one frame. `variant` picks the guest coat, skin and hair (0..n). */
export function partyFigure(kind: FigureKind, frame: FigureFrame, variant = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const skin = SKINS[variant % SKINS.length]!, hair = HAIRS[(variant * 3 + 1) % HAIRS.length]!;
  const stride = frame === 'walkA' ? 0.05 : frame === 'walkB' ? -0.05 : 0;
  const suit = kind === 'groom' ? 0x23262d : kind === 'bride' ? 0xfafafa : GUEST_COATS[variant % GUEST_COATS.length]!;
  const trouser = kind === 'groom' ? 0x23262d : kind === 'bride' ? 0xfafafa : 0x3a3a44;
  if (kind === 'bride') {
    parts.push(cyl(0.15, 0.06, 0.26, 0, 0.04, 0, 0xfafafa, 10)); // the dress: a cone from the hem to the waist
    parts.push(cyl(0.12, 0.17, 0.02, 0, 0.03, 0, 0xe9edf5, 10)); // hem ring
  } else {
    for (const s of [-1, 1]) parts.push(cyl(0.032, 0.03, 0.24, s * 0.045, 0.02, s * stride, trouser, 6)); // legs
  }
  parts.push(cyl(0.085, 0.07, 0.17, 0, 0.26, 0, suit, 8)); // torso
  for (const s of [-1, 1]) parts.push(cyl(0.024, 0.022, 0.17, s * 0.11, 0.26, -s * stride * 0.6, kind === 'bride' ? 0xf1c9a5 : suit, 5)); // arms
  parts.push(ball(0.062, 0, 0.47, 0, skin, 1.05)); // head
  parts.push(ball(0.066, 0, 0.485, -0.012, hair, 0.8)); // hair cap
  if (kind === 'bride') {
    const veil = new THREE.BoxGeometry(0.15, 0.3, 0.012); veil.translate(0, 0.35, -0.075); parts.push(paint(veil.toNonIndexed(), 0xf4f6fb)); // veil down the back
    parts.push(ball(0.04, 0.0, 0.3, 0.12, 0xf06292)); // bouquet
  } else if (kind === 'groom') {
    const tie = new THREE.BoxGeometry(0.05, 0.025, 0.012); tie.translate(0, 0.395, 0.073); parts.push(paint(tie.toNonIndexed(), 0xd9453a));
    parts.push(ball(0.012, 0.045, 0.37, 0.07, 0xfafafa)); // buttonhole flower
  }
  return mergeGeometries(parts)!;
}

export class PartySet {
  private cache = new Map<string, THREE.BufferGeometry>();
  get(kind: FigureKind, frame: FigureFrame, variant = 0): THREE.BufferGeometry {
    const k = `${kind}|${frame}|${kind === 'guest' ? variant : 0}`;
    let g = this.cache.get(k);
    if (!g) { g = partyFigure(kind, frame, variant); this.cache.set(k, g); }
    return g;
  }
  dispose(): void { for (const g of this.cache.values()) g.dispose(); this.cache.clear(); }
}
