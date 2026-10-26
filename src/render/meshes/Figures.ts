import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Gear, GEAR_COUNT, HairStyle } from '../guestAppearance';

/**
 * Low-poly human figure geometry, one merged BufferGeometry per gear/pose batch. Feet at the origin, forward = +z, ~0.52 tall.
 *
 * Per-vertex attribute `aTag` (vec4): x = colour part, y = animation joint, z = kind*16 + id (visibility), w = t along the limb (0 tip .. 1 base)
 * which the fragment shader uses for clothing splits (shorts/sleeves/gloves/hips) so colour boundaries follow the pose.
 *   parts : 0 torso, 1 leg, 2 arm, 3 boot, 4 skin, 5 hair, 6 hat/pack (accent colour), 7 gear colour, 8 dark, 9 metal/white
 *   joints: 0 body, 1/2 leg L/R, 3/4 arm L/R, 5 rigid gear, 6/7 wheel front/rear, 9 head
 *   kinds : 0 always, 1 only when hairStyle == id, 2 only with a backpack
 * Poses are baked into the geometry; the vertex shader adds the walk / pedal / sway cycles on top.
 */
export const Part = { Torso: 0, Leg: 1, Arm: 2, Boot: 3, Skin: 4, Hair: 5, Hat: 6, Gear: 7, Dark: 8, Metal: 9 } as const;
export const Joint = { Body: 0, LegL: 1, LegR: 2, ArmL: 3, ArmR: 4, Rigid: 5, WheelF: 6, WheelR: 7, Head: 9 } as const;
export const BIKE_WHEEL_R = 0.09, BIKE_WHEEL_Z = 0.24;
export const ARM_PIVOT_Y = 0.385;
/** Hip pivot (y, z) per gear after the pose translation: the shader swings legs about this point. */
export const HIP_PIVOT: Record<number, [number, number]> = {
  [Gear.Walk]: [0.215, 0], [Gear.Hike]: [0.215, 0], [Gear.Ski]: [0.215, 0], [Gear.Board]: [0.215, 0], [Gear.Bike]: [0.24, -0.1],
  [Gear.Sit]: [0.04, 0], [Gear.Skate]: [0.235, 0], [Gear.Lie]: [0.215, 0],
};

type Tag = [part: number, joint: number, kind?: number, id?: number];
const rot = (axis: 'x' | 'y' | 'z', a: number, py = 0, pz = 0): THREE.Matrix4 => {
  const m = new THREE.Matrix4().makeTranslation(0, py, pz);
  m.multiply(axis === 'x' ? new THREE.Matrix4().makeRotationX(a) : axis === 'y' ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationZ(a));
  m.multiply(new THREE.Matrix4().makeTranslation(0, -py, -pz));
  return m;
};
const mul = (...ms: (THREE.Matrix4 | null)[]): THREE.Matrix4 => { const r = new THREE.Matrix4(); for (const m of ms) if (m) r.multiply(m); return r; };

class Builder {
  readonly geos: THREE.BufferGeometry[] = [];
  /** Adds a shape. `tFromY`: derive t from the shape's local y range. */
  add(g: THREE.BufferGeometry, tag: Tag, m: THREE.Matrix4 | null, tFromY = true): void {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, pos = geo.getAttribute('position'), n = pos.count;
    const t = new Float32Array(n * 4), h = Math.max(1e-6, bb.max.y - bb.min.y);
    for (let i = 0; i < n; i++) {
      t[i * 4] = tag[0]; t[i * 4 + 1] = tag[1]; t[i * 4 + 2] = (tag[2] ?? 0) * 16 + (tag[3] ?? 0);
      t[i * 4 + 3] = tFromY ? (pos.getY(i) - bb.min.y) / h : 0.5;
    }
    geo.setAttribute('aTag', new THREE.BufferAttribute(t, 4));
    if (m) geo.applyMatrix4(m);
    this.geos.push(geo);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, tag: Tag, m: THREE.Matrix4 | null, tFromY = true): void {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); this.add(g, tag, m, tFromY);
  }
  /** Rounded limb / body part: tapered cylinder with `seg` radial segments (smooth side normals), scaled to an ellipse (sx, sz). */
  limb(rTop: number, rBot: number, h: number, x: number, y: number, z: number, tag: Tag, m: THREE.Matrix4 | null, seg = 6, sx = 1, sz = 1, open = true): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open); g.scale(sx, 1, sz); g.translate(x, y, z); this.add(g, tag, m, true);
  }
  /** Low-poly ball with smooth (radial) normals instead of faceted ones: reads rounder for the same 20 triangles. */
  ball(r: number, sx: number, sy: number, x: number, y: number, z: number, tag: Tag, m: THREE.Matrix4 | null): void {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(sx, sy, 1);
    const p = g.getAttribute('position'), nr = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i) / sx, p.getY(i) / sy, p.getZ(i)).normalize(); nr[i * 3] = v.x; nr[i * 3 + 1] = v.y; nr[i * 3 + 2] = v.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    g.translate(x, y, z);
    this.add(g, tag, m, false);
  }
  finish(): THREE.BufferGeometry {
    const g = mergeGeometries(this.geos, false)!;
    this.geos.forEach((x) => x.dispose());
    return g;
  }
}

interface Cfg {
  lean?: number; legRot?: number; armRot?: number; armOut?: number; legX?: number; footZ?: number;
  dy?: number; dz?: number; yaw?: number; liftX?: number; pack?: boolean;
  /** Close-up variant (ground cameras, nearest guests only): mittens, soles, collar + zip, goggles + strap, helmet vent, hair volume, pack straps. */
  near?: boolean;
  /** Near variant without soles / zip (keeps the bike within the 400-triangle near budget). */
  lite?: boolean;
}

const HIP_Y = 0.215;

function figure(b: Builder, c: Cfg): { hand: (side: 1 | -1) => THREE.Vector3; post: THREE.Matrix4; lean: THREE.Matrix4 } {
  const lean = rot('x', c.lean ?? 0, HIP_Y, 0);
  const post = mul(
    new THREE.Matrix4().makeTranslation(0, c.dy ?? 0, c.dz ?? 0),
    c.liftX ? rot('x', c.liftX) : null,
    c.yaw ? rot('y', c.yaw) : null,
  );
  const up = mul(post, lean);
  const lx = c.legX ?? 0.045;
  for (const s of [1, -1] as const) {
    const j = s > 0 ? Joint.LegL : Joint.LegR;
    const legM = mul(post, rot('x', c.legRot ?? 0, HIP_Y, 0), new THREE.Matrix4().makeTranslation(0, 0, s * (c.footZ ?? 0)));
    b.limb(0.029, 0.025, 0.175, s * lx, 0.1275, 0, [Part.Leg, j], legM);
    b.box(0.056, 0.04, 0.095, s * lx, 0.02, 0.014, [Part.Boot, j], legM, false);
    if (c.near && !c.lite) {
      b.box(0.06, 0.012, 0.102, s * lx, 0.004, 0.014, [Part.Dark, j], legM, false); // boot sole
    }
  }
  const armM = (s: 1 | -1): THREE.Matrix4 => mul(up, rot('z', -s * (c.armOut ?? 0), ARM_PIVOT_Y, 0), rot('x', c.armRot ?? 0, ARM_PIVOT_Y, 0));
  for (const s of [1, -1] as const) b.limb(0.025, 0.021, 0.17, s * 0.105, 0.3, 0, [Part.Arm, s > 0 ? Joint.ArmL : Joint.ArmR], armM(s));
  if (c.near) {
    for (const s of [1, -1] as const) {
      b.box(0.05, 0.05, 0.056, s * 0.105, 0.2, 0, [Part.Dark, s > 0 ? Joint.ArmL : Joint.ArmR], armM(s), false); // mitten
    }
    if (!c.lite) b.box(0.006, 0.19, 0.004, 0, 0.3, 0.047, [Part.Dark, Joint.Body], up, false); // jacket zip
    b.box(0.1, 0.03, 0.072, 0, 0.402, 0, [Part.Hat, Joint.Body], up, false); // collar
  }
  b.limb(0.076, 0.066, 0.205, 0, 0.3, 0, [Part.Torso, Joint.Body], up, 8, 1.05, 0.62, false);
  const headM = mul(up, rot('x', -(c.lean ?? 0) * 0.8, 0.43, 0)); // the head stays level while the body leans
    b.ball(0.058, 1, 1, 0, 0.46, 0, [Part.Skin, Joint.Head], headM);
  const hb = (w: number, h: number, d: number, x: number, y: number, z: number, tag: Tag): void => b.box(w, h, d, x, y, z, tag, headM, false);
  const dome = (r: number, sy: number, y: number, z: number, tag: Tag, sx = 1): void => b.ball(r, sx, sy, 0, y, z, tag, headM);
  const hair = (style: number): void => dome(0.063, 0.8, 0.478, -0.006, [Part.Hair, Joint.Head, 1, style]);
  hair(HairStyle.Short);
  hair(HairStyle.Long); hb(0.118, 0.13, 0.04, 0, 0.43, -0.058, [Part.Hair, Joint.Head, 1, HairStyle.Long]);
  hair(HairStyle.Ponytail); hb(0.036, 0.11, 0.036, 0, 0.43, -0.08, [Part.Hair, Joint.Head, 1, HairStyle.Ponytail]);
  hair(HairStyle.Bun); b.ball(0.03, 1, 1, 0, 0.52, -0.045, [Part.Hair, Joint.Head, 1, HairStyle.Bun], headM);
  dome(0.068, 0.85, 0.482, -0.004, [Part.Hat, Joint.Head, 1, HairStyle.Beanie]); hb(0.028, 0.028, 0.028, 0, 0.54, 0, [Part.Metal, Joint.Head, 1, HairStyle.Beanie]);
  dome(0.07, 0.9, 0.48, -0.006, [Part.Hat, Joint.Head, 1, HairStyle.Helmet]); hb(0.12, 0.03, 0.02, 0, 0.466, 0.06, [Part.Dark, Joint.Head, 1, HairStyle.Helmet]);
  dome(0.064, 0.7, 0.494, 0, [Part.Hat, Joint.Head, 1, HairStyle.Cap]); hb(0.1, 0.01, 0.06, 0, 0.49, 0.075, [Part.Hat, Joint.Head, 1, HairStyle.Cap]);
  hb(0.21, 0.012, 0.21, 0, 0.5, 0, [Part.Hat, Joint.Head, 1, HairStyle.SunHat]); dome(0.062, 0.7, 0.505, 0, [Part.Hat, Joint.Head, 1, HairStyle.SunHat]);
  if (c.near) {
    if (!c.lite) hb(0.108, 0.014, 0.108, 0, 0.468, -0.004, [Part.Dark, Joint.Head]); // goggles strap (not on the bike: near budget)
    hb(0.092, 0.03, 0.02, 0, 0.466, 0.06, [Part.Metal, Joint.Head, 1, HairStyle.Short]); // goggles pushed on the forehead / lens
    hb(0.092, 0.03, 0.02, 0, 0.466, 0.06, [Part.Metal, Joint.Head, 1, HairStyle.Long]);
    hb(0.02, 0.016, 0.1, 0, 0.55, 0, [Part.Dark, Joint.Head, 1, HairStyle.Helmet]); // helmet vent ridge
    dome(0.066, 0.8, 0.486, -0.012, [Part.Hair, Joint.Head, 1, HairStyle.Short], 1.08); // hair volume
    dome(0.066, 0.8, 0.486, -0.012, [Part.Hair, Joint.Head, 1, HairStyle.Ponytail], 1.08);
    hb(0.07, 0.016, 0.07, 0, 0.5, 0, [Part.Hat, Joint.Head, 1, HairStyle.Beanie]); // beanie cuff
    hb(0.1, 0.008, 0.012, 0, 0.5, 0.06, [Part.Dark, Joint.Head, 1, HairStyle.Cap]); // cap seam
  }
  if (c.pack !== false) b.box(0.13, 0.15, 0.07, 0, 0.31, -0.08, [Part.Hat, Joint.Body, 2, 1], up, false);
  if (c.near && c.pack !== false) b.box(0.11, 0.17, 0.012, 0, 0.31, 0.046, [Part.Dark, Joint.Body, 2, 1], up, false); // pack straps (shoulder yoke)
  const hand = (s: 1 | -1): THREE.Vector3 => new THREE.Vector3(s * 0.105, 0.23, 0).applyMatrix4(armM(s));
  return { hand, post, lean };
}

/** Trekking / ski pole from a hand position, tilted by `tilt` (about x, +ve = tip backwards... sign: negative tips forward). */
function pole(b: Builder, hand: THREE.Vector3, side: 1 | -1, len: number, tilt: number, near = false): void {
  const g = new THREE.BoxGeometry(0.02, len, 0.02);
  g.translate(0, -len * 0.4, 0);
  g.applyMatrix4(rot('x', tilt));
  g.translate(hand.x + side * 0.01, hand.y, hand.z);
  b.add(g, [Part.Dark, side > 0 ? Joint.ArmL : Joint.ArmR], null, false);
  if (near) { // grip + basket near the tip
    const j = side > 0 ? Joint.ArmL : Joint.ArmR;
    for (const [w, h, y] of [[0.034, 0.006, -len * 0.8]] as const) {
      const e = new THREE.BoxGeometry(w, h, w);
      e.translate(0, y, 0); e.applyMatrix4(rot('x', tilt)); e.translate(hand.x + side * 0.01, hand.y, hand.z);
      b.add(e, [w > 0.03 ? Part.Metal : Part.Hat, j], null, false);
    }
  }
}

export function buildGearGeometry(gear: number, near = false): THREE.BufferGeometry {
  const b = new Builder();
  switch (gear) {
    case Gear.Hike: {
      const f = figure(b, { near, lean: 0.08, armRot: -0.25 });
      for (const s of [1, -1] as const) pole(b, f.hand(s), s, 0.38, -0.25, near);
      break;
    }
    case Gear.Ski: {
      const f = figure(b, { near, lite: true, lean: 0.34, legRot: -0.2, armRot: -1.05, armOut: 0.15, legX: 0.05, dy: 0.004 });
      for (const s of [1, -1] as const) {
        pole(b, f.hand(s), s, 0.4, 0.5, near);
        b.box(0.032, 0.012, 0.4, s * 0.05, 0.006, 0.045, [Part.Gear, Joint.Rigid], null, false);
        b.box(0.03, 0.02, 0.06, s * 0.05, 0.022, 0.25, [Part.Gear, Joint.Rigid], rot('x', -0.32, 0.012, 0.23), false); // raised, tilted tips
        if (near) { // bindings: toe + heel plate
          b.box(0.04, 0.02, 0.1, s * 0.05, 0.018, 0.02, [Part.Dark, Joint.Rigid], null, false);
        }
      }
      break;
    }
    case Gear.Board: {
      const f = figure(b, { near, lean: 0.12, armOut: 0.5, legX: 0.07, yaw: Math.PI / 2, dy: 0.016 });
      void f;
      b.box(0.075, 0.014, 0.4, 0, 0.007, 0, [Part.Gear, Joint.Rigid], null, false);
      b.box(0.06, 0.02, 0.05, 0, 0.012, 0.2, [Part.Gear, Joint.Rigid], null, false);
      b.box(0.06, 0.02, 0.05, 0, 0.012, -0.2, [Part.Gear, Joint.Rigid], null, false);
      if (near) for (const z of [-0.07, 0.07]) { // bindings: base plate, high-back, ratchet strap
        b.box(0.07, 0.016, 0.07, 0, 0.022, z, [Part.Dark, Joint.Rigid], null, false);
        b.box(0.07, 0.04, 0.012, 0, 0.05, z - 0.03, [Part.Dark, Joint.Rigid], null, false);
        b.box(0.074, 0.01, 0.02, 0, 0.05, z + 0.01, [Part.Metal, Joint.Rigid], null, false);
      }
      break;
    }
    case Gear.Bike: {
      figure(b, { near, lite: true, lean: 1.0, legRot: -0.55, armRot: -2.1, dy: 0.025, dz: -0.1, pack: false });
      const R = BIKE_WHEEL_R, Z = BIKE_WHEEL_Z;
      for (const [z, j] of [[Z, Joint.WheelF], [-Z, Joint.WheelR]] as const) {
        const tire = new THREE.CylinderGeometry(R, R, 0.022, 8); tire.rotateZ(Math.PI / 2); tire.translate(0, R, z);
        b.add(tire, [Part.Dark, j], null, false);
        b.box(0.03, R * 1.7, 0.012, 0, R, z, [Part.Metal, j], null, false);
        b.box(0.03, 0.012, R * 1.7, 0, R, z, [Part.Metal, j], null, false);
      }
      b.box(0.03, 0.03, 0.3, 0, 0.2, 0.04, [Part.Gear, Joint.Rigid], null, false); // top tube
      b.box(0.03, 0.2, 0.03, 0, 0.17, Z - 0.02, [Part.Gear, Joint.Rigid], rot('x', -0.35, 0.17, Z), false); // fork
      b.box(0.03, 0.17, 0.03, 0, 0.14, -0.1, [Part.Gear, Joint.Rigid], null, false); // seat tube
      b.box(0.19, 0.02, 0.02, 0, 0.265, Z - 0.05, [Part.Dark, Joint.Rigid], null, false); // bars
      b.box(0.045, 0.02, 0.08, 0, 0.235, -0.1, [Part.Dark, Joint.Rigid], null, false); // saddle
      break;
    }
    case Gear.Sit:
      // origin = the seat level (the sim places riders at the chair height): hips just above it, legs dangling forward/down
      figure(b, { near, lean: -0.1, legRot: -1.15, armRot: -0.6, dy: -0.175, pack: false });
      break;
    case Gear.Skate: {
      figure(b, { near, lean: 0.25, armRot: -0.35, dy: 0.02, legX: 0.04 });
      for (const s of [1, -1] as const) b.box(0.012, 0.02, 0.12, s * 0.04, 0.01 + 0.0, 0.015, [Part.Metal, s > 0 ? Joint.LegL : Joint.LegR], new THREE.Matrix4().makeTranslation(0, 0.0, 0), false);
      break;
    }
    case Gear.Lie: {
      figure(b, { near, liftX: -Math.PI / 2, dy: 0.052, pack: false, armOut: 0.15 });
      b.box(0.27, 0.012, 0.62, 0, 0.006, -0.22, [Part.Gear, Joint.Rigid], null, false);
      break;
    }
    default: figure(b, { near,});
  }
  const g = b.finish();
  g.computeBoundingSphere();
  g.boundingSphere!.radius = Math.max(g.boundingSphere!.radius, 0.9);
  return g;
}

/** Figure buffers for every gear (built once). */
export function buildAllGearGeometries(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < GEAR_COUNT; k++) out.push(buildGearGeometry(k));
  return out;
}

/** Triangles visible for one guest with the given hair style (everything of kind 0 + the chosen style + pack). */
export function visibleTriangles(g: THREE.BufferGeometry, style: number, pack: boolean): number {
  const tag = g.getAttribute('aTag'), n = tag.count;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const z = tag.getZ(i), kind = Math.floor(z / 16), id = z % 16;
    if (kind === 0 || (kind === 1 && id === style) || (kind === 2 && pack)) v++;
  }
  return v / 3;
}
