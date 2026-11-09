import { blob, disc, spow, sweep, tube, wingRings, type AirPart, type V3 } from './sweepGeo';

/**
 * The light single-engine high-wing utility plane (Cessna / Pilatus-Porter feel) shared by the Altiport arrival plane, the parked Altiport plane and the Skydive
 * jump plane. Lofted rounded fuselage with a tapered tail boom, red cowling + spinner, cabin windows (the right-hand jump door stands open: a dark recess),
 * tapered high wing with a curved leading edge and rounded red tips, a wing strut each side, tailplane + fin with rounded tips, tricycle gear with wheel pants,
 * red stripe + belly, a blade antenna, pitot and a beacon. Model frame: forward = +z, up = +y, origin on the ground, about 1.8 long and 2.2 across; the callers scale.
 * Render only; pure and deterministic. 'full' ~1,000 triangles, 'lite' (parked, far) ~600.
 */
export type AircraftLod = 'full' | 'lite';
export const PLANE_COL = { white: 0xf4f1ea, red: 0xd9453a, glass: 0x2b3d52, dark: 0x2c2f34, grey: 0xaab3bd, black: 0x151618, hub: 0x4a4f57, strut: 0x8c939c } as const;
const C = PLANE_COL;

export interface Aircraft {
  body: AirPart[]; spinner: AirPart[]; blades: AirPart[]; disc: AirPart[];
  /** Unlit nav lights / beacon: centre, size, rgb. */
  lights: Array<{ c: V3; s: V3; rgb: V3 }>;
  propPivot: V3;
}

/** Fuselage sections: [z, centre y, half width, half height], tail tip to nose. */
const FUSE: Array<[number, number, number, number]> = [
  [-1.0, 0.5, 0.012, 0.02], [-0.92, 0.5, 0.03, 0.05], [-0.7, 0.485, 0.055, 0.09], [-0.42, 0.45, 0.092, 0.135], [-0.15, 0.41, 0.125, 0.175],
  [0.04, 0.395, 0.14, 0.19], [0.12, 0.39, 0.14, 0.19], [0.29, 0.386, 0.14, 0.19], [0.38, 0.384, 0.138, 0.188], [0.5, 0.375, 0.128, 0.172],
  [0.6, 0.36, 0.118, 0.15], [0.7, 0.35, 0.105, 0.13], [0.78, 0.345, 0.075, 0.095],
];

export function buildAircraft(lod: AircraftLod = 'full'): Aircraft {
  const full = lod === 'full';
  const seg = full ? 14 : 10;
  const rings: V3[][] = FUSE.map(([z, cy, rx, ry]) => Array.from({ length: seg }, (_, i) => {
    const t = (i / seg) * Math.PI * 2; return [rx * spow(Math.cos(t), 0.77), cy + ry * spow(Math.sin(t), 0.77), z] as V3;
  }));
  const fuse = sweep(rings, (c, n) => {
    const z = c[2], ny = n[1], ax = Math.abs(n[0]);
    if (z > 0.7 && n[2] > 0.8) return C.dark;
    if (z > 0.52) return C.red;
    if (z > 0.38) return ny > 0.3 ? C.glass : ny > -0.4 && ny < -0.05 && ax > 0.5 ? C.red : C.white;
    if (ny > 0.08 && ny < 0.8 && ax > 0.4) {
      if (z > -0.15 && z < 0.04) return C.glass;
      if (z > 0.12 && z < 0.29) return n[0] < 0 ? C.dark : C.glass; // the right-hand jump door slid open: a dark recess
    }
    if (z < -0.8) return C.red;
    if (ny > -0.4 && ny < -0.05 && ax > 0.5) return C.red;
    if (ny < -0.8) return C.grey;
    return C.white;
  });
  const body: AirPart[] = [...fuse];

  // high wing: tapered, curved leading edge (sweeps back with the span), elliptical rounded tips in red
  const wing = wingRings({
    sections: full ? [0, 0.2, 0.4, 0.6, 0.78, 0.9, 0.97, 1] : [0, 0.45, 0.78, 0.95, 1], halfSpan: 1.1, mirror: true,
    chord: (s) => 0.4 - 0.16 * s, zLE: (s) => 0.34 - 0.05 * s * s - 0.07 * s * s * s, thick: 0.085, tipFrom: 0.78,
    up: full ? [0, 0.05, 0.25, 0.55, 1] : [0, 0.12, 0.5, 1], lo: full ? [0.55, 0.25, 0.05] : [0.5, 0.12],
    place: (a, z, t) => [a, 0.6 + t, z],
  });
  body.push(...sweep(wing, (c) => (Math.abs(c[0]) > 0.995 ? C.red : C.white), true));
  // tailplane and fin (rounded tips)
  const stab = wingRings({
    sections: full ? [0, 0.4, 0.75, 0.92, 1] : [0, 0.6, 0.95, 1], halfSpan: 0.42, mirror: true, chord: (s) => 0.22 - 0.09 * s, zLE: (s) => -0.72 - 0.06 * s, thick: 0.07, tipFrom: 0.7,
    up: [0, 0.2, 0.6, 1], lo: [0.6, 0.2], place: (a, z, t) => [a, 0.505 + t, z],
  });
  body.push(...sweep(stab, (c) => (Math.abs(c[0]) > 0.3 ? C.red : C.white), true));
  const fin = wingRings({
    sections: full ? [0, 0.4, 0.75, 0.92, 1] : [0, 0.65, 0.95, 1], halfSpan: 0.42, mirror: false, chord: (s) => 0.3 - 0.15 * s, zLE: (s) => -0.62 - 0.19 * s, thick: 0.08, tipFrom: 0.72,
    up: [0, 0.2, 0.6, 1], lo: [0.6, 0.2], place: (a, z, t) => [t, 0.46 + a, z],
  });
  body.push(...sweep(fin, () => C.red, true));
  // wing struts (one each side), pitot, blade antenna, beacon
  const sg = full ? 5 : 4;
  for (const sx of [1, -1]) body.push(...tube([[sx * 0.13, 0.27, 0.2], [sx * 0.62, 0.6, 0.2]], [0.02, 0.02], sg, C.strut));
  body.push(...tube([[0.5, 0.6, 0.35], [0.5, 0.59, 0.5]], [0.018, 0.018], 4, C.strut));
  body.push(...tube([[0, 0.57, -0.1], [0, 0.65, -0.17]], [0.026, 0.012], 4, C.dark));
  body.push(...blob([0, 0.97, -0.8], [0.03, 0.03, 0.03], 6, 3, 0xe03a2e));

  // landing gear: tricycle, main-wheel pants (red) over the wheels, nose wheel on a leg
  const ws = full ? 8 : 6;
  const wheel = (x: number, y: number, z: number, r: number, w: number): AirPart[] => sweep([
    Array.from({ length: ws }, (_, i) => { const t = (i / ws) * Math.PI * 2; return [x - w / 2, y + r * Math.cos(t), z + r * Math.sin(t)] as V3; }),
    Array.from({ length: ws }, (_, i) => { const t = (i / ws) * Math.PI * 2; return [x + w / 2, y + r * Math.cos(t), z + r * Math.sin(t)] as V3; }),
  ], (_c, n) => (Math.abs(n[0]) > 0.9 ? C.hub : C.black), true);
  for (const sx of [1, -1]) {
    body.push(...tube([[sx * 0.1, 0.25, 0.12], [sx * 0.27, 0.12, 0.2]], [0.02, 0.02], sg, C.strut));
    body.push(...wheel(sx * 0.27, 0.065, 0.2, 0.065, 0.055));
    body.push(...blob([sx * 0.27, 0.125, 0.2], [0.045, 0.07, 0.13], full ? 7 : 6, full ? 4 : 3, C.red, 'z'));
  }
  body.push(...tube([[0, 0.26, 0.5], [0, 0.07, 0.58]], [0.022, 0.02], sg, C.strut));
  body.push(...wheel(0, 0.055, 0.58, 0.055, 0.045));

  // spinner + propeller (the Vehicles model spins `blades`, the static ones add the blur `disc`)
  const spinner = tube([[0, 0.345, 0.77], [0, 0.345, 0.84], [0, 0.345, 0.9]], [0.07, 0.056, 0.016], full ? 10 : 8, C.red, true);
  const blade = (rot: number): AirPart[] => {
    const ct = Math.cos(rot), st = Math.sin(rot), p = (x: number, y: number, z: number): V3 => [x * ct - y * st, x * st + y * ct, z];
    const ring = (y: number, w: number, th: number): V3[] => [p(-w, y, -th), p(w, y, -th), p(w, y, th), p(-w, y, th)];
    return sweep([ring(0.04, 0.026, 0.006), ring(0.15, 0.024, 0.005), ring(0.25, 0.018, 0.004)], () => C.dark, true);
  };
  const blades = [...blade(0), ...blade(Math.PI)];
  const lights = [
    { c: [1.09, 0.6, 0.12] as V3, s: [0.05, 0.04, 0.05] as V3, rgb: [0.9, 0.08, 0.06] as V3 },
    { c: [-1.09, 0.6, 0.12] as V3, s: [0.05, 0.04, 0.05] as V3, rgb: [0.1, 0.9, 0.2] as V3 },
    { c: [0, 0.97, -0.8] as V3, s: [0.05, 0.05, 0.05] as V3, rgb: [1, 1, 1] as V3 },
  ];
  return { body, spinner, blades, disc: disc([0, 0.345, 0.85], 0.26, full ? 14 : 10, 0xaab3bd), lights, propPivot: [0, 0.345, 0.77] };
}
