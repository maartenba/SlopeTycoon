import * as THREE from 'three';
import { C, PartBuilder, type Layer, type PartOpts } from '../common';
import { LIFT_STATION_HEAD } from '../../../config/balance';

export const HEAD = LIFT_STATION_HEAD;
export const PANE = 0xbfe3f5; // lift glazing (does not glow)
export const STEEL = 0x9aa3ad;
export const STEEL_DARK = 0x5d6670;
export const CONCRETE = 0xb9bcc0;

/**
 * Station builder in "bottom-station space": u is the distance along the line (+u = towards the line, -u = the back of the
 * station); for the top station everything is mirrored along z so the back sits on the far side of the cable.
 */
export class SB {
  constructor(readonly b: PartBuilder, readonly top: boolean) {}
  private z(u: number): number { return this.top ? -u : u; }
  box(cx: number, y0: number, u: number, sx: number, sy: number, su: number, color: number, o: PartOpts = {}): this {
    this.b.box(cx, y0, this.z(u), sx, sy, su, color, 'wood', this.top && o.ry ? { ...o, ry: -o.ry } : o); return this;
  }
  cyl(cx: number, y0: number, u: number, r: number, h: number, color: number, seg = 10, o: PartOpts = {}): this {
    this.b.cyl(cx, y0, this.z(u), r, h, color, 'wood', seg, o); return this;
  }
  cone(cx: number, y0: number, u: number, r: number, h: number, color: number, seg = 8, o: PartOpts = {}): this {
    this.b.cone(cx, y0, this.z(u), r, h, color, 'roof', seg, o); return this;
  }
  /** Gable with ridge along the line direction (symmetric, so mirroring is free). */
  gable(cx: number, y0: number, u: number, span: number, len: number, rise: number, color: number): this {
    this.b.gable(cx, y0, this.z(u), span, len, rise, color, false); return this;
  }
  /** Ramp rising towards +u (dir=1) or -u (dir=-1) along the line. */
  ramp(cx: number, y0: number, u: number, len: number, rise: number, width: number, color: number, dir: 1 | -1 = 1): this {
    const toward = (dir * (this.top ? -1 : 1)) as 1 | -1; // z direction of the rise
    this.b.wedge(cx, y0, this.z(u), len, rise, width, color, toward > 0 ? -Math.PI / 2 : Math.PI / 2, 'wood' as Layer); return this;
  }
  /** Sign boards (front and back faces) across the line and on both sides so the text reads from several angles. */
  signs(text: string, cx: number, cy: number, u: number, sx: number, sy: number, bg: string, fg = '#ffffff'): this {
    const z = this.z(u);
    this.b.sign(text, cx, cy, z + 0.02, sx, sy, 0, bg, fg);
    this.b.sign(text, cx, cy, z - 0.02, sx, sy, Math.PI, bg, fg);
    this.b.sign(text, cx + 0.02, cy, z, sx, sy, Math.PI / 2, bg, fg);
    this.b.sign(text, cx - 0.02, cy, z, sx, sy, -Math.PI / 2, bg, fg);
    return this;
  }
}

/** Bull wheel at (x=0, u): axis along x, groove top at cable height. Two tyres at the strand positions, hub and spokes. */
export function bullwheel(s: SB, u: number, r: number, color = STEEL, tyre = C.black): void {
  const cy = HEAD - r;
  for (const x of [-0.3, 0.3]) s.cyl(x, cy - r, u, r, 0.1, tyre, 14, { rz: Math.PI / 2 });
  s.cyl(0, cy - 0.06, u, 0.07, 0.9, color, 8, { rz: Math.PI / 2 });
  for (const x of [-0.3, 0.3]) {
    s.box(x, cy - 0.015, u, 0.04, 0.03, r * 1.8, color);
    s.box(x, cy - r * 0.9, u, 0.04, r * 1.8, 0.03, color);
  }
}

/** Support frame carrying a wheel axle: two posts and a cross-beam. */
export function wheelFrame(s: SB, u: number, r: number, color: number, width = 0.9): void {
  const cy = HEAD - r;
  for (const x of [-width / 2, width / 2]) s.box(x, 0, u, 0.07, cy + 0.05, 0.1, color);
  s.box(0, cy + 0.02, u + r + 0.06, width + 0.1, 0.05, 0.05, color);
  s.box(0, cy + 0.02, u - r - 0.06, width + 0.1, 0.05, 0.05, color);
}

/** Row of turnstile gates across the boarding area (bottom stations). */
export function turnstiles(s: SB, u: number, xs: number[], color = STEEL_DARK, arm = C.red): void {
  for (const x of xs) {
    s.box(x, 0, u, 0.06, 0.4, 0.06, color);
    for (let a = 0; a < 3; a++) s.box(x, 0.35, u, 0.2, 0.02, 0.02, arm, { ry: (a * Math.PI) / 3 + 0.3 });
  }
}

/** Half-pipe tunnel roof made from flat panels and ribs: spans u0..u1, radius R about height yc. */
export function archTunnel(s: SB, u0: number, u1: number, R: number, yc: number, rib: number, pane: number, ribs = 4, panels = 7): void {
  const len = u1 - u0, um = (u0 + u1) / 2;
  const chord = (2 * R * Math.sin(Math.PI / (2 * panels))) * 1.04;
  for (let i = 0; i < panels; i++) {
    const a = ((i + 0.5) / panels) * Math.PI; // 0 -> +x side, PI -> -x side
    s.box(Math.cos(a) * R, yc + Math.sin(a) * R - 0.015, um, chord, 0.03, len, pane, { rz: a - Math.PI / 2 });
  }
  for (let k = 0; k < ribs; k++) {
    const u = u0 + (len * k) / Math.max(1, ribs - 1);
    for (let i = 0; i <= panels; i++) {
      const a = (i / panels) * Math.PI;
      s.box(Math.cos(a) * R, yc + Math.sin(a) * R - 0.04, u, 0.05, 0.05, 0.05, rib);
    }
    s.box(R, 0, u, 0.06, yc, 0.06, rib); s.box(-R, 0, u, 0.06, yc, 0.06, rib);
  }
  s.box(0, yc + R - 0.01, um, 0.06, 0.05, len, rib); // ridge beam
}

/** Chair/cabin parking rail: two rails at the strand positions at carrier hang height. */
export function guideRails(s: SB, u0: number, u1: number, y: number, color = STEEL): void {
  for (const x of [-0.3, 0.3]) s.box(x, y, (u0 + u1) / 2, 0.04, 0.04, u1 - u0, color);
}

/** Tower sheave wheel + body helper for geometry: a vertical cylinder wheel at (x, y, z) with axis along the line. */
export function sheave(b: PartBuilder, x: number, y: number, z: number, r: number, color = C.black): void {
  b.cyl(x, y - r, z, r, 0.08, color, "wood", 10, { rz: Math.PI / 2 });
}

export const vec = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
