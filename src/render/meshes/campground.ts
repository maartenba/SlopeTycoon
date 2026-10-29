import * as THREE from 'three';
import { C, PartBuilder, picnicTable } from './common';

/** Horizontal cylinder (log, wheel) whose CENTRE is at height `yc`: `PartBuilder.cyl` takes the bottom, and a rotated cylinder turns about its middle. */
const lay = (b: PartBuilder, x: number, yc: number, z: number, r: number, len: number, color: number, seg: number, o: Parameters<PartBuilder['cyl']>[8]): void => { b.cyl(x, yc - len / 2, z, r, len, color, 'wood', seg, o); };

/** Where the fire burns, in building-local coordinates (the footprint centre, slightly towards the front). Smoke and glow use it. */
export const CAMPFIRE = { x: 0, z: 0.2, /** Tip of the tallest flame (smoke starts here; the catalog chimney offset). */ top: { x: 0.05, y: 0.42, z: 0.17 } } as const;

/** A-frame tent: a gable in `color`, a dark doorway flap, two guy pegs. Ridge runs along x when `ridgeX`. */
function tent(b: PartBuilder, x: number, z: number, color: number, ry = 0): void {
  b.gable(x, 0.02, z, 0.78, 0.9, 0.52, color, false, 'roof');
  const c = Math.cos(ry), s = Math.sin(ry);
  // door opening on the front gable end (rotated with the tent)
  b.box(x + s * 0.46, 0.02, z + c * 0.46, 0.2, 0.3, 0.04, C.black, 'wood', { ry });
  b.box(x + s * 0.0, 0.5, z + c * 0.0, 0.03, 0.04, 0.96, C.dark, 'wood', { ry }); // ridge pole
  for (const k of [-1, 1]) b.box(x + c * k * 0.5, 0.0, z - s * k * 0.5, 0.04, 0.12, 0.04, C.dark); // pegs
}

/** Caravan: cream body, rounded-ish roof, glass windows (warm at night), wheel and a tow hitch. Long axis along x. */
function caravan(b: PartBuilder, x: number, z: number, color: number): void {
  b.box(x, 0.1, z, 1.0, 0.36, 0.42, color);
  b.box(x, 0.46, z, 0.96, 0.05, 0.38, C.white, 'roof');
  b.gable(x, 0.46, z, 0.38, 0.96, 0.07, C.white, true);
  b.box(x, 0.28, z + 0.215, 0.26, 0.14, 0.02, C.glass);
  b.box(x - 0.32, 0.28, z + 0.215, 0.14, 0.14, 0.02, C.glass);
  b.box(x + 0.25, 0.1, z + 0.215, 0.14, 0.26, 0.02, C.dark); // door
  b.box(x, 0.17, z + 0.215, 0.96, 0.03, 0.02, C.red); // stripe
  lay(b, x + 0.05, 0.09, z + 0.22, 0.09, 0.04, C.black, 8, { rx: Math.PI / 2 });
  lay(b, x + 0.05, 0.09, z - 0.22, 0.09, 0.04, C.black, 8, { rx: Math.PI / 2 });
  b.box(x - 0.62, 0.12, z, 0.26, 0.03, 0.04, C.grey, 'wood'); // hitch
}

/**
 * Campground (5x4, about 400 triangles): a fire ring with crossed logs and flames in the middle, four tents and two caravans around it,
 * four log seats, a picnic table, firewood, a lantern post and a CAMP sign. The flames are plain orange; the night glow is a separate additive disc (`campfireGlow`).
 */
export function campground(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.3, 0.02, h - 0.3, 0x7fb069, 'wood'); // trampled meadow patch
  // fire ring: 8 stones, a hearth of ash, crossed logs and three flames
  const fx = CAMPFIRE.x, fz = CAMPFIRE.z;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.box(fx + Math.cos(a) * 0.3, 0.02, fz + Math.sin(a) * 0.3, 0.13, 0.1, 0.13, i % 2 ? C.stone : C.grey, 'wood', { ry: a }); }
  b.cyl(fx, 0.02, fz, 0.24, 0.03, 0x3a3532, 'wood', 10);
  lay(b, fx, 0.07, fz, 0.035, 0.46, C.dark, 6, { rz: Math.PI / 2, ry: 0.5 });
  lay(b, fx, 0.11, fz, 0.035, 0.46, C.wood, 6, { rz: Math.PI / 2, ry: -0.7 });
  b.cone(fx, 0.08, fz, 0.13, 0.3, C.orange, 'wood', 7);
  b.cone(fx + 0.05, 0.08, fz - 0.03, 0.08, 0.34, C.yellow, 'wood', 6);
  b.cone(fx - 0.06, 0.08, fz + 0.04, 0.07, 0.24, C.red, 'wood', 6);
  // log seats around the fire
  for (const [dx, dz, ry] of [[0, 0.72, 0], [0, -0.62, 0], [0.8, 0.05, Math.PI / 2], [-0.8, 0.05, Math.PI / 2]] as const) lay(b, fx + dx, 0.09, fz + dz, 0.085, 0.55, C.wood, 6, { rz: Math.PI / 2, ry });
  // tents (corners) and caravans (back row)
  tent(b, -1.75, -0.35, C.orange); tent(b, 1.8, -0.4, C.blue, 0.4);
  tent(b, -1.7, 1.2, C.green, -0.3); tent(b, 1.75, 1.25, C.red);
  caravan(b, -0.55, -1.55, C.cream); caravan(b, 0.75, -1.55, C.yellow);
  picnicTable(b, 0.95, 1.4, 0.2);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 3 - r; i++) lay(b, -0.85 + i * 0.1 + r * 0.05, 0.05 + r * 0.08, 1.55, 0.045, 0.5, i % 2 ? C.wood : C.dark, 6, { rx: Math.PI / 2 }); // firewood
  // lantern post (glass bulb = warm glow at night) and the sign
  b.cyl(1.2, 0, 0.6, 0.02, 0.6, C.dark, 'wood', 6);
  b.box(1.2, 0.58, 0.6, 0.08, 0.1, 0.08, C.glass);
  b.sign('CAMP', -0.1, 0.5, h / 2 - 0.1, 0.6, 0.22);
  b.box(-0.35, 0, h / 2 - 0.11, 0.05, 0.5, 0.05, C.dark); b.box(0.15, 0, h / 2 - 0.11, 0.05, 0.5, 0.05, C.dark);
}

/** Night glow of the fire: a flat additive disc (orange centre fading to black) on the ground plus a smaller one standing up in the flames, building-local. */
export function campfireGlowGeometry(): THREE.BufferGeometry {
  const disc = (r: number, y: number, seg: number, inner: number): THREE.BufferGeometry => {
    const g = new THREE.CircleGeometry(r, seg).toNonIndexed();
    g.rotateX(-Math.PI / 2); g.translate(CAMPFIRE.x, y, CAMPFIRE.z);
    const pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - CAMPFIRE.x, pos.getZ(i) - CAMPFIRE.z) / r, k = Math.max(0, 1 - d) ** 1.6 * inner;
      col[i * 3] = 1.0 * k; col[i * 3 + 1] = 0.5 * k; col[i * 3 + 2] = 0.16 * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    return g;
  };
  const flame = disc(0.32, 0.3, 12, 1.2); // a lens of light around the flames (horizontal: seen from the iso camera as a bright blob)
  const ground = disc(1.7, 0.045, 24, 0.95);
  const merged = new THREE.BufferGeometry();
  const a = ground.getAttribute('position'), c = flame.getAttribute('position');
  const pos = new Float32Array((a.count + c.count) * 3), col = new Float32Array((a.count + c.count) * 3);
  pos.set(a.array as Float32Array, 0); pos.set(c.array as Float32Array, a.count * 3);
  col.set(ground.getAttribute('color').array as Float32Array, 0); col.set(flame.getAttribute('color').array as Float32Array, a.count * 3);
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3)); merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}
