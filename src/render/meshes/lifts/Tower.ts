import type * as THREE from 'three';
import { C, PartBuilder } from '../common';
import type { LiftKind } from '../../../config/lifts';
import { liftDef } from '../../../config/lifts';
import { finishGeometry } from './geo';
import { STEEL, STEEL_DARK } from './stationKit';

/** Sheave train: `n` small wheels in a row along the line (axis along x) under the cable at lateral x, top at height. */
function sheaves(b: PartBuilder, x: number, height: number, n: number, r: number, spacing: number, color = C.black): void {
  for (let i = 0; i < n; i++) b.cyl(x, height - 2 * r, (i - (n - 1) / 2) * spacing, r, 0.08, color, 'wood', 8, { rz: Math.PI / 2 });
  b.box(x, height - 2 * r - 0.03, 0, 0.04, 0.03, (n - 1) * spacing + 0.1, STEEL_DARK);
}

/** Tapering two-legged mast (legs at ±w0 at the base, ±w1 at height) with X bracing every `step`. */
function mast(b: PartBuilder, height: number, w0: number, w1: number, t: number, color: number, brace: number, step: number): void {
  for (const s of [-1, 1]) b.beam(s * w0, 0, 0, s * w1, height, 0, t, color);
  const levels = Math.max(1, Math.round(height / step));
  for (let i = 0; i < levels; i++) {
    const y0 = (height * i) / levels, y1 = (height * (i + 1)) / levels;
    const a0 = w0 + (w1 - w0) * (y0 / height), a1 = w0 + (w1 - w0) * (y1 / height);
    b.beam(-a0, y0, 0, a1, y1, 0, brace, color);
    b.beam(a0, y0, 0, -a1, y1, 0, brace, color);
    b.box(0, y1, 0, 2 * a1, brace, brace, color);
  }
}

/**
 * Tower: origin at ground, cable head at `height` (strands at x = ±0.3 across the line, running along z).
 * Distinct per lift family: T-bar poles, tubular chair towers with sheave pairs, A-frame towers for fast chairs, tall steel
 * gondola masts with big sheave trains, heavy four-legged lattice pylons for the cable car, concrete trestles for the funicular.
 */
export function buildTowerGeometry(height: number, kind: LiftKind = 'chair4', armHalfWidth = 0.3, near = false): THREE.BufferGeometry {
  const b = new PartBuilder(1, 1);
  const d = liftDef(kind);
  b.box(0, -0.2, 0, 0.5, 0.2, 0.5, C.stone, 'stone');
  const topY = height;
  switch (d.family) {
    case 'tbar': { // slim wooden pole with a small crossarm and single sheaves
      b.cyl(0, 0, 0, 0.045, topY - 0.06, C.wood, 'wood', 10);
      b.box(0, topY - 0.1, 0, 0.5, 0.04, 0.05, C.dark);
      for (const x of [-armHalfWidth, armHalfWidth]) sheaves(b, x, topY, 1, 0.05, 0.1);
      b.box(0, topY * 0.5, 0, 0.05, 0.03, 0.2, C.yellow); // yellow marker plate
      break;
    }
    case 'chair': {
      if (kind === 'chair2' || kind === 'chair4') { // tubular steel pole + T arm, two-wheel sheave trains
        b.cyl(0, 0, 0, 0.07, topY - 0.1, STEEL, 'stone', 10);
        b.cyl(0, 0, 0, 0.1, 0.12, STEEL_DARK, 'stone', 8);
        b.box(0, topY - 0.1, 0, 0.74, 0.06, 0.1, d.capacityPerCarrier > 2 ? C.red : C.dark);
        for (const x of [-armHalfWidth, armHalfWidth]) sheaves(b, x, topY, 2, 0.06, 0.13);
      } else if (kind === 'chair4d') { // tube + ladder + 3-wheel trains
        b.cyl(0, 0, 0, 0.08, topY - 0.1, STEEL, 'stone', 12);
        b.box(0, topY - 0.1, 0, 0.8, 0.07, 0.12, C.red);
        b.box(0.1, 0.1, 0, 0.03, topY * 0.8, 0.03, STEEL_DARK); b.box(0.16, 0.1, 0, 0.03, topY * 0.8, 0.03, STEEL_DARK);
        for (const x of [-armHalfWidth, armHalfWidth]) sheaves(b, x, topY, 3, 0.055, 0.12);
      } else { // 6-seat / bubble: A-frame steel tower with red cap
        mast(b, topY - 0.1, 0.32, 0.18, 0.06, STEEL, 0.035, 0.7);
        b.box(0, topY - 0.1, 0, 0.8, 0.08, 0.14, C.red);
        for (const x of [-armHalfWidth, armHalfWidth]) sheaves(b, x, topY, 4, 0.055, 0.13);
        if (d.bubble) b.box(0, topY * 0.5, 0.06, 0.34, 0.12, 0.03, C.white);
      }
      break;
    }
    case 'gondola': { // tall steel mast, large sheave trains and a service platform
      const big = d.capacityPerCarrier >= 10;
      const w0 = big ? 0.46 : 0.4, w1 = big ? 0.3 : 0.26;
      mast(b, topY - 0.12, w0, w1, 0.07, STEEL, 0.04, 0.6);
      b.box(0, topY - 0.12, 0, 0.9, 0.09, 0.2, big ? 0xc0392b : C.blue);
      for (const x of [-armHalfWidth, armHalfWidth]) sheaves(b, x, topY, 5, 0.06, 0.12, C.black);
      for (const x of [-armHalfWidth, armHalfWidth]) b.box(x, topY - 0.36, 0, 0.1, 0.06, 0.55, STEEL_DARK);
      b.box(0, topY * 0.55, 0.15, 0.6, 0.03, 0.18, STEEL_DARK); // platform
      break;
    }
    case 'cablecar': { // heavy lattice pylon: four legs, braced faces, big saddle
      const w0 = 0.46, w1 = 0.2;
      const levels = Math.max(2, Math.round(topY / 0.7));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam(sx * w0, 0, sz * w0, sx * w1, topY - 0.15, sz * w1, 0.09, C.red);
      for (let i = 0; i < levels; i++) {
        const y0 = ((topY - 0.15) * i) / levels, y1 = ((topY - 0.15) * (i + 1)) / levels;
        const a0 = w0 + (w1 - w0) * (y0 / (topY - 0.15)), a1 = w0 + (w1 - w0) * (y1 / (topY - 0.15));
        for (const s of [-1, 1]) {
          b.beam(-a0, y0, s * a0, a1, y1, s * a1, 0.045, C.grey); b.beam(a0, y0, s * a0, -a1, y1, s * a1, 0.045, C.grey);
          b.beam(s * a0, y0, -a0, s * a1, y1, a1, 0.045, C.grey); b.beam(s * a0, y0, a0, s * a1, y1, -a1, 0.045, C.grey);
        }
        b.box(0, y1 - 0.02, 0, 2 * a1 + 0.05, 0.05, 2 * a1 + 0.05, C.dark);
      }
      b.box(0, topY - 0.15, 0, 0.9, 0.1, 0.5, C.yellow); // saddle
      for (const x of [-armHalfWidth, armHalfWidth]) { sheaves(b, x, topY, 3, 0.09, 0.2); b.box(x, topY - 0.25, 0, 0.12, 0.1, 0.5, C.black); }
      b.box(0, 0, 0, 1.0, 0.12, 1.0, C.stone, 'stone');
      break;
    }
    case 'funicular': { // concrete trestle: two raked legs, deck beam under the track, diagonal bracing
      const w0 = 0.42, w1 = 0.3;
      for (const s of [-1, 1]) b.beam(s * w0, 0, 0, s * w1, topY - 0.1, 0, 0.12, C.stone);
      b.box(0, topY - 0.14, 0, 0.9, 0.1, 0.5, C.stone, 'stone');
      b.box(0, topY - 0.04, 0, 0.8, 0.02, 0.5, C.dark);
      const levels = Math.max(1, Math.round(topY / 0.8));
      for (let i = 0; i < levels; i++) {
        const y0 = ((topY - 0.14) * i) / levels, y1 = ((topY - 0.14) * (i + 1)) / levels;
        const a0 = w0 + (w1 - w0) * (y0 / topY), a1 = w0 + (w1 - w0) * (y1 / topY);
        b.beam(-a0, y0, 0, a1, y1, 0, 0.045, C.grey); b.beam(a0, y0, 0, -a1, y1, 0, 0.045, C.grey);
      }
      break;
    }
  }
  if (near) { // sheave assembly: side plates, axle bolts, rubber rim rings, balancing beam, rope catcher, ladder rungs
    for (const x of [-armHalfWidth, armHalfWidth]) {
      for (const sx of [-0.05, 0.05]) b.box(x + sx, topY - 0.17, 0, 0.012, 0.16, 0.5, STEEL_DARK);
      b.cyl(x, topY - 0.09, 0, 0.012, 0.12, C.grey, 'stone', 6, { rz: Math.PI / 2 });
      b.box(x, topY + 0.02, 0, 0.012, 0.05, 0.3, C.dark); // rope catcher
      b.box(x, topY + 0.04, -0.15, 0.1, 0.012, 0.012, C.dark);
      b.box(x, topY + 0.04, 0.15, 0.1, 0.012, 0.012, C.dark);
    }
    for (let y = 0.25; y < topY - 0.3; y += 0.16) b.box(0, y, 0.07, 0.1, 0.012, 0.012, STEEL_DARK); // ladder rungs
    b.box(0, 0, 0, 0.22, 0.05, 0.22, C.stone, 'stone'); // base flange
    for (const x of [-0.09, 0.09]) for (const z of [-0.09, 0.09]) b.cyl(x, 0.05, z, 0.012, 0.02, C.grey, 'stone', 6);
  }
  return finishGeometry(b);
}
