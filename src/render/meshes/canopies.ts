import { blob, sweep, tube, wingRings, type AirPart, type V3 } from './sweepGeo';

/**
 * Sky craft meshes (render only, pure, deterministic): the skydiver's square ram-air canopy and the hang glider of the Launch Ramp. Both are meant for ONE tinted
 * InstancedMesh each (SkyActivity), so every colour here is a grey level 0..1 (the instance colour multiplies it): 1 = the full tint, lower = darker panels, lines and gear.
 * Frame: forward = +x (SkyActivity heading), up = +y, span = z, origin at the pilot's feet. `lines` are thin triangular tubes (>= 0.011 radius: never sub-pixel at iso zoom).
 */
const g = (v: number): number => { const k = Math.round(v * 255); return (k << 16) | (k << 8) | k; };
export interface SkyCraft { parts: AirPart[] }
/** Detail tier of the sky craft (`SkyActivity`, Graphics quality): 'full' = High (the original models), 'med' = fewer rings and lines, 'low' = coarse wing, no lines, a one-blob jumper / pilot. */
export type SkyLod = 'full' | 'med' | 'low';

/** Rotates a model built with forward = +z, span = x into the SkyActivity frame (forward = +x, span = z). */
function toForwardX(parts: AirPart[]): AirPart[] {
  for (const p of parts) {
    const pos = p.geo.getAttribute('position'), nor = p.geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) { pos.setXYZ(i, pos.getZ(i), pos.getY(i), -pos.getX(i)); nor.setXYZ(i, nor.getZ(i), nor.getY(i), -nor.getX(i)); }
    // the rotation is proper (determinant 1), so the winding stays outward
  }
  return parts;
}

/** Square ram-air canopy with its jumper: arched cells, rounded tapered tips, a fan of lines to the harness. ~560 triangles. */
export function buildSquareCanopy(lod: SkyLod = 'full'): SkyCraft {
  const full = lod === 'full', low = lod === 'low';
  const A = 0.62, half = 0.24, R = half / A, hy = 0.36; // arch half angle, half arc length, arch radius, canopy apex height
  const sections = full ? [0, 0.22, 0.43, 0.62, 0.78, 0.9, 0.975, 1] : low ? [0, 0.55, 0.95, 1] : [0, 0.3, 0.62, 0.9, 1];
  const upP = full ? [0, 0.04, 0.2, 0.5, 1] : [0, 0.2, 1], loP = full ? [0.5, 0.2, 0.04] : [0.5, 0.04];
  const place = (a: number, z: number, t: number): V3 => { const an = (a / half) * A; return [(R + t) * Math.sin(an), hy + R * (Math.cos(an) - 1) + t * Math.cos(an), z]; };
  const rings = wingRings({
    sections, halfSpan: half, mirror: true, chord: (s) => 0.21 - 0.05 * s * s, zLE: (s) => 0.1 + 0.015 * s * s, thick: 0.085, tipFrom: 0.8,
    up: upP, lo: loP, place,
  });
  const nLoop = upP.length + loP.length; // loop points of the airfoil (5 up + 3 low on High)
  const parts: AirPart[] = sweep(rings, (c, n, a, k) => {
    if (a < 0) return g(0.6); // the closed tip ends
    const x = c[0] / R, under = n[1] * Math.sqrt(Math.max(0, 1 - x * x)) + n[0] * x < -0.2;
    const base = a % 2 === 0 ? 1 : 0.72; // one stripe per rib pair: the cell pattern, aligned with the ribs
    if (k === 0 || k === nLoop - 1) return g(0.5); // the leading-edge band (nose) across the whole span
    return g(under ? base * 0.82 : base);
  }, true);
  // lines: a fan from the harness shoulders to 5 points per side on the underside (thin triangular tubes)
  const lineCol = g(0.55);
  if (!low) for (const sx of [1, -1]) for (const s of full ? [0.12, 0.38, 0.62, 0.82, 0.95] : [0.2, 0.6, 0.92]) {
    const an = sx * s * A, ax = (R - 0.02) * Math.sin(an), ay = hy + R * (Math.cos(an) - 1) - 0.02;
    parts.push(...tube([[sx * 0.02, 0.15, 0], [ax, ay, 0.02 + 0.03 * s]].map((p) => [p[0]!, p[1]!, p[2]!] as V3), [0.011, 0.011], 3, lineCol));
  }
  // jumper: boots, legs, torso with a harness, arms up to the toggles, helmet
  const suit = g(0.42), harness = g(0.62), helmet = g(0.92);
  if (low) parts.push(...blob([0, 0.1, 0], [0.04, 0.1, 0.03], 6, 3, suit, 'y')); // Low: the jumper is one blob under the canopy
  else {
    for (const sx of [1, -1]) parts.push(...tube([[sx * 0.016, 0.0, 0.004], [sx * 0.018, 0.045, 0], [sx * 0.018, 0.085, 0]], [0.016, 0.017, 0.019], 5, suit));
    parts.push(...blob([0, 0.115, 0], [0.034, 0.04, 0.026], 7, 4, harness, 'y'));
    for (const sx of [1, -1]) parts.push(...tube([[sx * 0.036, 0.13, 0], [sx * 0.04, 0.19, 0.012]], [0.013, 0.012], 4, suit));
    parts.push(...blob([0, 0.168, 0.004], [0.026, 0.026, 0.028], 8, 4, helmet, 'y'));
  }
  return { parts: toForwardX(parts) };
}

/** Hang glider (Launch Ramp): a delta wing with a curved leading edge and a drooping rounded sail, keel + leading-edge spars, control frame and a prone pilot. ~420 triangles. */
export function buildHangGlider(lod: SkyLod = 'full'): SkyCraft {
  const full = lod === 'full', low = lod === 'low';
  const yw = 0.3, half = 0.36; // wing height, half span
  const SEC = full ? [0, 0.2, 0.4, 0.6, 0.8, 0.92, 1] : low ? [0, 0.6, 1] : [0, 0.35, 0.7, 0.92, 1];
  const rings = wingRings({
    sections: SEC, halfSpan: half, mirror: true,
    // delta planform: the leading edge sweeps back along a gentle curve, the trailing edge is nearly straight with a soft scallop
    chord: (s) => 0.4 * (1 - Math.pow(s, 1.7)) + 0.04, zLE: (s) => 0.22 - 0.34 * Math.pow(s, 1.25) + (0.4 * (1 - Math.pow(s, 1.7)) + 0.04) * 0, thick: 0.03, tipFrom: 0.9,
    up: [0, 0.08, 0.4, 1], lo: [0.4, 0.08], place: (a, z, t) => [a, yw + t - 0.09 * (a / half) * (a / half), z], // droops towards the tips
  });
  const ss = [...SEC].reverse().concat(SEC.slice(1)); // |s| of the ribs (13 on High): the panels follow the ribs, no diagonal edges
  const parts: AirPart[] = sweep(rings, (_c, n, a) => {
    const s = a < 0 ? 0 : (ss[a]! + ss[a + 1]!) / 2, under = n[1] < -0.2;
    // tri-panel sail: a dark centre panel, the full tint on the middle, a lighter outer band; the underside a touch darker
    const v = s < 0.22 ? 0.55 : s < 0.62 ? 1 : 0.8;
    return g(under ? v * 0.8 : v);
  }, true);
  const alu = g(0.7), dark = g(0.25);
  const drop = (a: number): number => yw - 0.09 * (a / half) * (a / half) - 0.012;
  if (!low) for (const sx of [1, -1]) parts.push(...tube([[sx * 0.02, drop(0.02), 0.2], [sx * half * 0.5, drop(half * 0.5), 0.22 - 0.34 * Math.pow(0.5, 1.25) + 0.015], [sx * half * 0.93, drop(half * 0.93), 0.22 - 0.34 * Math.pow(0.93, 1.25) + 0.01]], [0.013, 0.012, 0.011], 4, alu)); // leading-edge spars
  if (!low) parts.push(...tube([[0, yw - 0.02, 0.2], [0, yw - 0.02, -0.1]], [0.012, 0.012], 4, alu)); // keel
  if (full) parts.push(...tube([[0, yw - 0.02, 0.06], [-0.02, 0.11, 0.07]], [0.012, 0.012], 4, dark)); // king post / hang line to the pilot's harness
  if (full) parts.push(...tube([[0, yw - 0.02, 0.06], [0.02, 0.11, 0.07]], [0.012, 0.012], 4, dark));
  // control frame: a triangle hanging from the keel in front of the pilot
  if (full) parts.push(...tube([[-0.06, 0.06, 0.15], [0, yw - 0.02, 0.1], [0.06, 0.06, 0.15]], [0.012, 0.012, 0.012], 4, alu));
  // pilot: prone, head forward, suit and helmet, legs trailing behind
  if (low) parts.push(...blob([0, 0.09, 0.03], [0.03, 0.026, 0.1], 6, 3, g(0.5), 'z')); // Low: pilot and helmet as one blob
  else {
    parts.push(...blob([0, 0.09, 0.0], [0.03, 0.024, 0.07], 7, 4, g(0.5), 'z'));
    parts.push(...blob([0, 0.095, 0.092], [0.024, 0.024, 0.026], 8, 4, g(0.92), 'z'));
  }
  if (full) for (const sx of [1, -1]) parts.push(...tube([[sx * 0.012, 0.085, -0.06], [sx * 0.014, 0.08, -0.14], [sx * 0.014, 0.075, -0.2]], [0.016, 0.014, 0.012], 4, g(0.3)));
  return { parts: toForwardX(parts) };
}
