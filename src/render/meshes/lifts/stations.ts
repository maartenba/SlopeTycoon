import { C } from '../common';
import { HEAD, PANE, STEEL, STEEL_DARK, CONCRETE, SB, archTunnel, bullwheel, guideRails, turnstiles, wheelFrame } from './stationKit';
import type { LiftKind } from '../../../config/lifts';

/**
 * Station designs, written once in bottom-station space (u: -back .. +towards the line) and mirrored for the top.
 * Each kind has its own silhouette; bottom stations add a ticket hall / gates, top stations a drive house, motor and exit ramp.
 * Footprint is the 2x2 tile station (x,z within about ±1). Cable head height = HEAD at the centre (u=0).
 */
export interface StationSign { text: string; bg: string }
export const STATION_SIGNS: Record<LiftKind, StationSign> = {
  tbar: { text: 'T-BAR', bg: '#e8a800' }, chair2: { text: 'CHAIR 2', bg: '#b03a2e' }, chair4: { text: 'CHAIR 4', bg: '#c0392b' },
  chair4d: { text: 'EXPRESS 4', bg: '#c0392b' }, chair6: { text: 'EXPRESS 6', bg: '#a93226' }, chair6d: { text: 'HSC 6', bg: '#1f7a6a' }, chair6b: { text: 'BUBBLE 6', bg: '#5d6d7e' },
  chair8b: { text: 'BUBBLE 8', bg: '#4a5a6a' }, gondola6: { text: 'GONDOLA', bg: '#2d5fa8' }, gondola10: { text: 'GONDOLA 10', bg: '#7b2d2d' },
  cablecar: { text: 'CABLE CAR', bg: '#a07a10' }, funicular: { text: 'FUNICULAR', bg: '#2e6b4a' },
};

type Design = (s: SB) => void;

// ---------------------------------------------------------------- T-bar: tiny open shed, motor housing and rail posts, NO canopy
const tbar: Design = (s) => {
  const T = s.top;
  s.box(0, 0, 0, 1.3, 0.08, 1.7, CONCRETE);
  // wheel on an A-frame of yellow posts
  const r = T ? 0.3 : 0.22, wu = T ? 0.1 : -0.15;
  bullwheel(s, wu, r, C.yellow);
  wheelFrame(s, wu, r, C.yellow, 0.9);
  s.box(0, 0.08, wu, 0.9, 0.06, 0.3, C.yellow);
  // tiny open shed with the motor (no roof canopy: just a slab-lid housing)
  s.box(-0.55, 0.08, T ? -0.1 : -0.75, 0.4, 0.3, 0.4, C.grey);
  s.box(-0.55, 0.38, T ? -0.1 : -0.75, 0.46, 0.04, 0.46, C.orange);
  s.box(-0.55, 0.12, T ? 0.12 : -0.53, 0.2, 0.2, 0.04, C.dark);
  s.cyl(-0.55, 0.38, T ? -0.1 : -0.75, 0.05, 0.14, C.black, 6);
  // rail posts along the loading lane
  for (let i = 0; i < 4; i++) {
    const u = -0.8 + i * 0.35;
    for (const x of [-0.5, 0.5]) { s.box(x, 0.08, u, 0.05, 0.3, 0.05, C.yellow); }
  }
  for (const x of [-0.5, 0.5]) s.box(x, 0.3, 0, 0.03, 0.03, 1.1, C.dark);
  if (T) { s.ramp(0, 0.0, -0.75, 0.55, 0.08, 0.7, CONCRETE, -1); s.box(0.5, 0.08, 0.7, 0.04, 0.4, 0.04, C.red); s.box(0.5, 0.42, 0.7, 0.3, 0.14, 0.02, C.yellow); }
  else { turnstiles(s, -0.5, [-0.25, 0.25], C.dark, C.yellow); s.box(0, 0.08, -0.95, 0.5, 0.35, 0.1, C.yellow); }
  s.signs('T-BAR', 0, 0.78, T ? 0.95 : -0.92, 0.7, 0.28, '#e8a800', '#2a2a2e');
  s.box(0, 0.4, T ? 0.95 : -0.92, 0.05, 0.4, 0.05, C.dark);
};

// ---------------------------------------------------------------- Fixed-grip chair 2: small wooden-clad hut, frame bullwheel, open platform with a little shelter
const chair2: Design = (s) => {
  const T = s.top;
  s.box(0, 0, 0, 1.7, 0.1, 1.8, 0xa0793e); // wooden deck
  // wooden-clad hut at the back
  const hu = T ? 0.55 : -0.55;
  s.box(0.45, 0.1, hu, 0.8, 0.55, 0.6, C.wood);
  for (let i = 0; i < 3; i++) s.box(0.45, 0.2 + i * 0.16, hu + (T ? -0.31 : 0.31) * 0, 0.82, 0.03, 0.62, C.dark);
  s.gable(0.45, 0.65, hu, 0.9, 0.75, 0.28, C.roofBrown);
  s.box(0.45, 0.1, hu + (T ? -0.31 : 0.31), 0.22, 0.38, 0.03, C.dark);
  // bullwheel on a red steel frame
  const r = T ? 0.3 : 0.25, wu = T ? 0.0 : -0.1;
  bullwheel(s, wu, r, C.red);
  wheelFrame(s, wu, r, C.red, 0.95);
  // open boarding platform with a tiny shelter
  if (!T) {
    for (const x of [-0.9, -0.5]) for (const u of [-0.85, -0.45]) s.box(x, 0.1, u, 0.05, 0.6, 0.05, C.dark);
    s.box(-0.7, 0.7, -0.65, 0.55, 0.04, 0.55, C.roofRed);
    s.gable(-0.7, 0.72, -0.65, 0.6, 0.6, 0.15, C.roofRed);
    s.box(-0.7, 0.1, -0.85, 0.5, 0.12, 0.08, C.wood); // bench
    s.box(0, 0.1, 0.45, 0.4, 0.04, 0.6, C.white); // boarding strip
  } else {
    s.ramp(0, 0.0, -0.8, 0.6, 0.1, 0.9, 0xa0793e, -1);
    s.box(-0.8, 0.1, 0.6, 0.04, 0.5, 0.04, C.dark);
  }
  s.signs('CHAIR 2', -0.1, 0.95, T ? 0.88 : -0.9, 0.7, 0.28, '#b03a2e');
  s.box(-0.1, 0.1, T ? 0.88 : -0.9, 0.05, 0.85, 0.05, C.dark);
};

// ---------------------------------------------------------------- Chair 4 / 4d: sloped canopy, visible bullwheel, boarding carpet + gates, control booth
const chair4 = (detach: boolean): Design => (s) => {
  const T = s.top;
  s.box(0, 0, 0, 1.9, 0.14, 1.9, CONCRETE);
  // boarding carpet
  s.box(0, 0.14, T ? 0.2 : 0.0, 0.5, 0.02, 1.2, detach ? C.black : C.dark);
  for (let i = 0; i < 6; i++) s.box(0, 0.16, (T ? 0.2 : 0.0) - 0.5 + i * 0.2, 0.5, 0.01, 0.05, C.yellow);
  // sloped canopy on posts (higher at the wheel end)
  const bu = T ? 0.45 : -0.45;
  for (const x of [-0.85, 0.85]) for (const u of [bu - 0.4, bu + 0.4]) s.box(x, 0.14, u, 0.08, 1.15, 0.08, C.red);
  s.box(0, 1.29, bu, 1.9, 0.07, 1.05, detach ? C.roofRed : C.dark, { rz: 0 });
  s.box(0, 1.36, bu, 1.96, 0.03, 1.1, C.white);
  s.gable(0, 1.36, bu, 2.0, 1.1, 0.18, detach ? C.roofRed : C.roofBrown);
  // bullwheel inside, with frame
  const r = 0.32, wu = T ? 0.5 : -0.5;
  bullwheel(s, wu, r, STEEL);
  wheelFrame(s, wu, r, C.red, 1.0);
  if (detach) { // tyre rails + guide rails along the platform
    s.box(-0.3, 0.7, bu, 0.03, 0.05, 1.0, STEEL_DARK); s.box(0.3, 0.7, bu, 0.03, 0.05, 1.0, STEEL_DARK);
    for (let i = 0; i < 5; i++) s.cyl(-0.3 + 0, 0.52, bu - 0.4 + i * 0.2, 0.05, 0.03, C.black, 6, { rz: Math.PI / 2 });
  }
  // control booth
  s.box(-0.75, 0.14, T ? -0.35 : 0.35, 0.35, 0.5, 0.35, C.white);
  s.box(-0.75, 0.38, T ? -0.35 : 0.35, 0.37, 0.15, 0.37, C.glass);
  s.box(-0.75, 0.64, T ? -0.35 : 0.35, 0.42, 0.04, 0.42, C.red);
  if (!T) { // gates
    turnstiles(s, 0.05, [-0.22, 0.22], STEEL_DARK, C.red);
    s.box(0.7, 0.14, 0.35, 0.03, 0.3, 0.8, C.red); // barrier
    s.box(0, 0.14, -0.88, 1.9, 0.5, 0.08, C.cream); // wall behind
  } else {
    s.box(0.75, 0.14, -0.4, 0.3, 0.3, 0.4, C.grey); // motor housing under the canopy
    s.cyl(0.75, 0.44, -0.4, 0.05, 0.12, C.black, 6);
    s.ramp(0, 0.0, -0.9, 0.7, 0.14, 1.0, CONCRETE, 1);
  }
  s.signs(detach ? 'EXPRESS 4' : 'CHAIR 4', 0, 1.7, bu + (T ? 0.45 : -0.45) * 0, 0.9, 0.3, detach ? '#c0392b' : '#a93226');
  s.box(0, 1.5, bu, 0.05, 0.2, 0.05, C.dark);
};

// ---------------------------------------------------------------- Chair 6 / 6b / 8b: modern station, long curved glazed canopy tunnel where chairs park
const chairBig = (bubble: boolean, seats: number, label?: { text: string; bg: string }, accent: number = C.red): Design => (s) => {
  const T = s.top;
  s.box(0, 0, 0, 1.96, 0.12, 1.96, CONCRETE);
  const R = seats >= 8 ? 0.96 : 0.9, yc = seats >= 8 ? 0.55 : 0.5;
  const u0 = T ? -0.35 : -0.95, u1 = T ? 0.95 : 0.35;
  archTunnel(s, u0, u1, R, yc, STEEL_DARK, bubble ? PANE : C.white, seats >= 8 ? 5 : 4);
  // end pylons with a red accent band
  for (const u of [u0, u1]) s.box(0, 0.12, u, 2.0, 0.08, 0.1, accent);
  const wu = T ? 0.45 : -0.45;
  bullwheel(s, wu, 0.32, STEEL);
  wheelFrame(s, wu, 0.32, STEEL_DARK, 1.0);
  guideRails(s, T ? -0.2 : 0.0, T ? 0.2 : 0.2, HEAD - 0.5, STEEL_DARK); // chair park rail (bubble chairs park under the tunnel)
  if (bubble) for (const x of [-0.3, 0.3]) for (let i = 0; i < 3; i++) s.cyl(x, HEAD - 0.62, (T ? 0.8 : -0.2) + i * 0.2 - (T ? 1.2 : 0), 0.02, 0.1, STEEL_DARK, 5);
  // concourse building + booth
  const bu = T ? 0.65 : -0.62;
  s.box(-0.7, 0.12, bu, 0.5, 0.7, 0.55, STEEL);
  s.box(-0.7, 0.4, bu + (T ? -0.28 : 0.28), 0.4, 0.3, 0.03, C.glass);
  s.box(-0.7, 0.82, bu, 0.56, 0.05, 0.6, accent);
  if (!T) { turnstiles(s, -0.05, [-0.25, 0.25], STEEL_DARK, accent); s.box(0.7, 0.12, -0.4, 0.4, 0.5, 0.5, C.white); s.box(0.7, 0.4, -0.4, 0.42, 0.2, 0.3, C.glass); }
  else { s.box(0.65, 0.12, 0.6, 0.5, 0.5, 0.6, C.grey); s.cyl(0.65, 0.62, 0.6, 0.08, 0.1, C.black, 8); s.ramp(0, 0.0, -0.7, 0.6, 0.12, 0.9, CONCRETE, -1); }
  s.signs(label?.text ?? (seats >= 8 ? 'BUBBLE 8' : bubble ? 'BUBBLE 6' : 'EXPRESS 6'), 0, 1.6, (T ? 0.95 : -0.95), 1.0, 0.32, label?.bg ?? (bubble ? '#4a5a6a' : '#a93226'));
  s.box(0, 1.35, T ? 0.95 : -0.95, 0.06, 0.2, 0.06, STEEL_DARK);
};

// ---------------------------------------------------------------- Gondola: large rectangular glazed terminal with cabin parking rails
const gondola = (big: boolean): Design => (s) => {
  const T = s.top;
  const W = big ? 0.96 : 0.9, roofY = big ? 1.6 : 1.4;
  s.box(0, 0, 0, 2.0, 0.12, 2.0, CONCRETE);
  const accent = big ? 0xc0392b : C.blue;
  const hu = T ? 0.0 : 0.0, len = big ? 1.9 : 1.7;
  // glazed side walls with steel mullions
  for (const x of [-W, W]) {
    s.box(x, 0.12, hu, 0.04, roofY - 0.12, len, PANE);
    for (let i = 0; i <= 4; i++) s.box(x, 0.12, hu - len / 2 + (len * i) / 4, 0.07, roofY - 0.12, 0.06, STEEL_DARK);
    s.box(x, 0.12, hu, 0.08, 0.1, len, STEEL_DARK);
  }
  s.box(0, roofY, hu, W * 2 + 0.2, 0.08, len + 0.1, STEEL);
  s.box(0, roofY + 0.08, hu, W * 2 + 0.25, 0.03, len + 0.15, accent);
  // second storey (big only): upper glazed band with a smaller roof
  if (big) {
    s.box(0, roofY + 0.11, T ? 0.35 : -0.35, W * 2 - 0.2, 0.3, 0.8, PANE);
    for (let i = 0; i <= 4; i++) s.box(-W + 0.1 + (i * (W * 2 - 0.2)) / 4, roofY + 0.11, T ? 0.35 : -0.35, 0.05, 0.3, 0.85, STEEL_DARK);
    s.box(0, roofY + 0.41, T ? 0.35 : -0.35, W * 2 - 0.1, 0.05, 0.9, accent);
  }
  // cabin parking rails and the wheel
  guideRails(s, -0.7, 0.7, HEAD - 0.25, STEEL_DARK);
  for (const x of [-0.3, 0.3]) for (const u of [-0.6, 0.0, 0.6]) s.box(x, HEAD - 0.25, u, 0.04, 0.25, 0.04, STEEL_DARK);
  const wu = T ? 0.3 : -0.3;
  bullwheel(s, wu, big ? 0.38 : 0.34, STEEL);
  wheelFrame(s, wu, big ? 0.38 : 0.34, STEEL_DARK, 1.0);
  // entrance hall with roof (bottom: ticket hall + gates) / drive house (top)
  if (!T) {
    s.box(0, 0.12, -0.93, W * 2, roofY - 0.4, 0.14, STEEL);
    s.box(0, 0.4, -0.99, W * 2 - 0.3, 0.6, 0.03, PANE);
    s.box(0, roofY - 0.28, -1.1, W * 2 + 0.1, 0.06, 0.4, accent); // entrance canopy
    turnstiles(s, -0.6, [-0.55, -0.35, 0.35, 0.55], STEEL_DARK, accent);
  } else {
    s.box(0, 0.12, 0.8, W * 2, roofY - 0.1, 0.3, STEEL_DARK); // drive house
    s.cyl(0.5, roofY + 0.0, 0.8, 0.1, 0.3, C.black, 8); s.box(-0.4, roofY, 0.8, 0.4, 0.2, 0.2, STEEL); // motor + vent
    s.ramp(0, 0.0, -0.95, 0.5, 0.12, 1.2, CONCRETE, -1);
  }
  s.signs(big ? 'GONDOLA 10' : 'GONDOLA', 0, roofY + (big ? 0.7 : 0.38), T ? 0.95 : -0.95, 0.9, 0.3, big ? '#7b2d2d' : '#2d5fa8');
  s.box(0, roofY, T ? 0.95 : -0.95, 0.05, big ? 0.7 : 0.38, 0.05, STEEL_DARK);
};

// ---------------------------------------------------------------- Cable car: heavy stone station, head-house tower, counterweight pit, big boarding hall
const cablecar: Design = (s) => {
  const T = s.top;
  const back = -0.7; // back of hall in bottom-space: head house sits behind the docked cabin
  s.box(0, -0.1, 0, 2.0, 0.2, 2.0, C.stone);
  // heavy stone hall around the cabin with open front toward the line
  for (const x of [-0.9, 0.9]) s.box(x, 0.1, 0.05, 0.2, 1.5, 1.7, C.stone);
  s.box(0, 0.1, back - 0.0, 1.8, 1.5, 0.3, C.stone);
  s.box(0, 1.6, 0.0, 2.0, 0.12, 1.9, C.roofRed);
  s.box(0, 1.72, 0.0, 1.9, 0.08, 1.8, C.grey);
  s.gable(0, 1.72, 0.0, 1.9, 1.9, 0.18, C.roofRed);
  s.box(0, 0.1, 0.9, 1.9, 0.12, 0.1, C.yellow); // front threshold with hazard stripe
  s.box(0, 1.35, 0.92, 1.9, 0.3, 0.16, C.yellow); // lintel
  s.box(0, 0.1, 0.95, 0.12, 0.3, 0.12, C.black);
  // head-house tower behind with the main sheave
  s.box(0, 0.1, back - 0.2, 0.9, 2.1, 0.5, C.stone);
  s.box(0, 2.2, back - 0.2, 1.0, 0.1, 0.6, C.roofRed);
  s.cone(0, 2.3, back - 0.2, 0.5, 0.35, C.roofRed, 4, { ry: Math.PI / 4 });
  for (const x of [-0.35, 0.35]) s.box(x, 1.0, back + 0.07, 0.15, 0.25, 0.04, C.glass);
  bullwheel(s, 0.1, 0.3, STEEL_DARK);
  // windows along the hall
  for (const x of [-0.9, 0.9]) for (const u of [-0.3, 0.2, 0.7]) s.box(x + (x < 0 ? -0.105 : 0.105), 0.7, u, 0.02, 0.35, 0.25, C.glass);
  if (!T) { // boarding hall: ticket counter + gates; counterweight pit in the back corner
    turnstiles(s, 0.55, [-0.55, 0.55], STEEL_DARK, C.yellow);
    s.box(0, 0.1, 0.2, 1.7, 0.02, 0.5, C.yellow);
  } else { // counterweight pit with ramp + the weight
    s.box(0.0, -0.12, back - 0.38, 0.8, 0.24, 0.36, C.black);
    s.box(0, -0.02, back - 0.38, 0.5, 0.5, 0.25, C.grey);
    s.ramp(0, 0.0, 0.0, 0.8, 0.12, 1.3, CONCRETE, 1);
  }
  s.box(0.0, 0.1, back + 0.4, 1.0, 0.05, 0.06, C.red); // buffer beam
  s.signs('CABLE CAR', 0, 1.95, 0.88, 1.0, 0.32, '#a07a10');
  s.box(0, 1.7, 0.88, 0.05, 0.25, 0.05, C.dark);
};

// ---------------------------------------------------------------- Funicular: stone tunnel portal, platform canopy, sleepers + rails, front window facade
const funicular: Design = (s) => {
  const T = s.top;
  s.box(0, -0.02, 0, 2.0, 0.1, 2.0, CONCRETE);
  // track bed with rails + sleepers
  s.box(0, 0.05, 0, 0.7, 0.04, 2.0, STEEL_DARK);
  for (let i = 0; i < 8; i++) s.box(0, 0.09, -0.9 + i * 0.26, 0.7, 0.03, 0.1, C.dark);
  for (const x of [-0.3, 0.3]) s.box(x, 0.12, 0, 0.05, 0.05, 2.0, STEEL);
  // platforms either side of the track with canopy
  for (const x of [-0.65, 0.65]) s.box(x, 0.08, 0.1, 0.5, 0.16, 1.6, C.stone);
  const cu = 0.0;
  for (const x of [-0.95, 0.95]) for (const u of [-0.55, 0.65]) s.box(x, 0.24, u, 0.07, 0.95, 0.07, C.roofGreen);
  s.box(0, 1.19, cu, 2.1, 0.07, 1.6, C.roofGreen);
  s.box(0, 1.26, cu, 2.0, 0.03, 1.5, C.cream);
  s.gable(0, 1.26, cu, 1.6, 1.6, 0.2, C.roofGreen);
  // tunnel portal at the far end (top: behind, bottom: below the facade): stone arch with a dark opening
  const pu = T ? 0.95 : -0.95;
  s.box(-0.6, 0.0, pu, 0.5, 1.1, 0.14, C.stone); s.box(0.6, 0.0, pu, 0.5, 1.1, 0.14, C.stone);
  s.box(0, 0.7, pu, 0.8, 0.5, 0.14, C.stone);
  s.box(0, 0.1, pu + (T ? -0.04 : 0.04), 0.7, 0.6, 0.05, C.black);
  s.cyl(0, 0.0, pu, 0.4, 0.14, C.black, 10, { rx: Math.PI / 2 });
  s.box(0, 1.15, pu, 0.14, 0.1, 0.16, C.yellow); // keystone
  // front window facade / terminal hall on one side of the track
  const hu = T ? 0.65 : -0.45;
  s.box(-0.7, 0.16, hu, 0.55, 0.7, 0.75, C.cream);
  for (const u of [-0.15, 0.15]) s.box(-0.43, 0.38, hu + u, 0.03, 0.32, 0.22, C.glass);
  s.box(-0.7, 0.86, hu, 0.65, 0.06, 0.85, C.roofGreen);
  if (!T) { turnstiles(s, 0.55, [-0.7], STEEL_DARK, C.green); s.box(0.7, 0.16, -0.5, 0.4, 0.45, 0.4, C.white); s.box(0.7, 0.34, -0.3, 0.3, 0.14, 0.02, C.glass); }
  else { s.box(0.7, 0.16, 0.5, 0.4, 0.4, 0.5, C.grey); s.cyl(0.7, 0.56, 0.5, 0.07, 0.14, C.black, 8); s.ramp(-0.65, 0.0, -0.7, 0.6, 0.16, 0.5, CONCRETE, -1); }
  s.signs('FUNICULAR', 0, 1.62, pu, 1.0, 0.3, '#2e6b4a');
  s.box(0, 1.3, pu, 0.06, 0.3, 0.06, C.dark);
};

export const STATION_DESIGNS: Record<LiftKind, Design> = {
  tbar, chair2, chair4: chair4(false), chair4d: chair4(true), chair6: chairBig(false, 6), chair6d: chairBig(false, 6, STATION_SIGNS.chair6d, 0x1f7a6a), chair6b: chairBig(true, 6), chair8b: chairBig(true, 8),
  gondola6: gondola(false), gondola10: gondola(true), cablecar, funicular,
};
void PANE;
