import { C, PartBuilder, chimney, doorway, frameWin, stackedLogs, lampPost } from '../common';

/** Dark blue photovoltaic cells (NOT the window-glass colour: panels must not glow at night). */
const PV = 0x2f5fb0;
const PV_LINE = 0xb4c8e8;
const FRAME = 0xb9bec4;

/** One tilted panel (w x d on the ground plan) on a frame: a flat box tilted about x, thin cell grid lines on top, two legs. */
function panel(b: PartBuilder, cx: number, cz: number, w: number, d: number, y0 = 0.2, tilt = 0.38): void {
  b.box(cx, y0, cz, w, 0.05, d, FRAME, 'stone', { rx: -tilt }); // frame / back sheet
  const dy = 0.03;
  b.box(cx, y0 + dy + 0.015, cz + 0.004, w - 0.06, 0.04, d - 0.06, PV, 'stone', { rx: -tilt });
  // cell grid: two lines along the width (thin but >= MIN_THIN)
  for (const t of [-0.33, 0.33]) b.box(cx, y0 + dy + 0.045 + Math.sin(tilt) * t * d, cz + Math.cos(tilt) * t * d, w - 0.1, 0.03, 0.03, PV_LINE, 'stone', { rx: -tilt });
  // frame legs
  b.box(cx - w / 2 + 0.08, 0, cz - d * 0.25, 0.05, y0 + 0.2, 0.05, C.grey, 'stone');
  b.box(cx + w / 2 - 0.08, 0, cz - d * 0.25, 0.05, y0 + 0.2, 0.05, C.grey, 'stone');
}

/** Solar Array (3x2): two rows of four tilted panels in a ground-mounted field, a small inverter cabinet and a low fence on the edge. */
export function solarArray(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.05, h - 0.1, C.sand, 'stone'); // gravel bed
  for (const rz of [-0.42, 0.38]) for (let i = 0; i < 4; i++) panel(b, -w / 2 + 0.42 + i * 0.7, rz, 0.64, 0.62);
  b.box(w / 2 - 0.22, 0.05, h / 2 - 0.22, 0.26, 0.4, 0.2, C.grey, 'stone'); // inverter cabinet
  b.box(w / 2 - 0.22, 0.4, h / 2 - 0.22, 0.3, 0.04, 0.24, C.dark, 'roof');
  b.box(w / 2 - 0.22, 0.2, h / 2 - 0.11, 0.1, 0.08, 0.02, C.yellow, 'stone');
  b.fence(-w / 2 + 0.06, h / 2 - 0.06, w / 2 - 0.5, h / 2 - 0.06, C.grey, 0.28, 5);
}

/** Solar Plant (5x4): three long rows of panels, an inverter / transformer block with a window, a fenced yard and a lamp. */
export function solarPlant(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, 0, w - 0.1, 0.05, h - 0.1, C.sand, 'stone');
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) panel(b, -w / 2 + 0.55 + i * 0.7, -h / 2 + 0.55 + r * 0.8, 0.64, 0.6);
  // control hut with a pale roof and a lit window
  const hx = w / 2 - 0.5, hz = h / 2 - 0.45;
  b.box(hx, 0.05, hz, 0.7, 0.5, 0.55, C.cream);
  b.gable(hx, 0.55, hz, 0.62, 0.8, 0.2, C.roofBlue, false);
  doorway(b, hx - 0.2, hz + 0.28, 's', 0.16, 0.34, C.dark, C.cream);
  frameWin(b, hx + 0.18, 0.28, hz + 0.28, 's', 0.14, 0, C.cream);
  // transformer + bus bars
  b.box(hx - 0.95, 0.05, hz, 0.4, 0.34, 0.32, C.grey, 'stone');
  b.box(hx - 0.95, 0.39, hz, 0.44, 0.04, 0.36, C.dark, 'roof');
  b.fence(-w / 2 + 0.08, h / 2 - 0.08, w / 2 - 0.08, h / 2 - 0.08, C.grey, 0.28, 9);
  b.fence(-w / 2 + 0.08, -h / 2 + 0.08, -w / 2 + 0.08, h / 2 - 0.08, C.grey, 0.28, 6);
  lampPost(b, -w / 2 + 0.2, h / 2 - 0.25, 0.7);
  b.sign('SOLAR', hx - 0.05, 0.82, hz + 0.3, 0.6, 0.2, 0, '#1f3f7a', '#fff4d6');
}

/** Hub height (model units) of the Wind Turbine; the rotor is a separate mesh (BuildingMeshes.create adds it and BuildingsView spins it). */
export const TURBINE_HUB = { y: 3.3, z: 0.2, radius: 1.15 } as const;

/** Wind Turbine (2x2): concrete plinth, a tall slim tapered white tower, nacelle with a spinner stub, and a service door. The blades are `windRotor`. */
export function windTurbine(b: PartBuilder): void {
  b.cyl(0, 0, 0, 0.42, 0.1, C.stone, 'stone', 12);
  // tapered tower: stacked cylinders, thinner towards the top
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const r = 0.17 - i * 0.02, y0 = 0.1 + i * 0.64;
    b.cyl(0, y0, 0, r, 0.66, i % 2 ? C.white : 0xe6e9ec, 'stone', 10);
  }
  b.box(0, 3.3 - 0.13, TURBINE_HUB.z - 0.2, 0.2, 0.2, 0.62, C.white, 'stone'); // nacelle
  b.box(0, 3.3 + 0.07, TURBINE_HUB.z - 0.22, 0.14, 0.03, 0.4, C.grey, 'stone'); // roof stripe
  b.box(0, 0.1, 0.17, 0.12, 0.28, 0.04, C.dark, 'stone'); // service door
  b.box(0.3, 0.1, 0.3, 0.14, 0.22, 0.1, C.grey, 'stone'); // transformer box
  b.box(0, 0, -0.55, 0.05, 0.04, 0.05, C.red, 'stone'); // survey marker
}

/** The three blades + hub of the turbine, centred on the rotor axis (+z faces the front). One merged geometry: spin it about z. */
export function windRotor(b: PartBuilder): void {
  b.ball(0, -0.09, 0, 0.1, C.white, 'stone', 8);
  for (let k = 0; k < 3; k++) {
    const th = (k * 2 * Math.PI) / 3, L = TURBINE_HUB.radius;
    b.box(-Math.sin(th) * (0.1 + L / 2), -L / 2 + Math.cos(th) * (0.1 + L / 2), 0.03, 0.1, L, 0.035, C.white, 'stone', { rz: th });
    b.box(-Math.sin(th) * (0.1 + L * 0.9), -0.03 + Math.cos(th) * (0.1 + L * 0.9) - 0.05, 0.05, 0.03, 0.12, 0.03, C.red, 'stone', { rz: th });
  }
}

/** Small Hydro (3x2): stone powerhouse with a green roof and a lit window, a steel penstock coming down the bank, a tailrace and a gauge post. */
export function smallHydro(b: PartBuilder, w: number, h: number): void {
  b.box(-0.45, 0.0, -0.1, 1.5, 0.8, 1.2, C.stone, 'stone');
  b.gable(-0.45, 0.8, -0.1, 1.4, 1.7, 0.45, C.roofGreen, true);
  doorway(b, -0.85, 0.5, 's', 0.28, 0.5, C.dark, C.cream);
  frameWin(b, -0.35, 0.4, 0.5, 's', 0.2, 0, C.cream);
  frameWin(b, 0.1, 0.4, 0.5, 's', 0.2, 0, C.cream);
  // penstock: sloped steel pipe into the house + support saddles
  b.cyl(0.95, 0.35, -0.55, 0.11, 1.5, C.grey, 'stone', 10, { rz: Math.PI / 2 });
  for (const x of [0.5, 0.95, 1.35]) b.box(x, 0, -0.55, 0.1, 0.26, 0.2, C.stone, 'stone');
  b.cyl(1.2, 0.0, 0.1, 0.1, 0.25, C.dark, 'wood', 8);
  // tailrace trough and a gauge post
  b.box(-0.45, 0, h / 2 - 0.1, 0.9, 0.1, 0.2, C.grey, 'stone');
  b.box(w / 2 - 0.1, 0, h / 2 - 0.2, 0.05, 0.7, 0.05, C.dark);
  b.box(w / 2 - 0.1, 0.6, h / 2 - 0.2, 0.16, 0.1, 0.05, C.yellow);
  b.sign('HYDRO', -0.45, 0.9, 0.52, 0.7, 0.2, 0, '#2b5d8a', '#fff4d6');
}

/** Biomass Heating (3x3): boiler house with a tall steel stack (smoke), a wood-chip silo with a hopper, a log store and a chip heap. Stack top = chimney spec. */
export function biomassHeating(b: PartBuilder): void {
  b.box(0.3, 0, -0.5, 1.7, 1.0, 1.4, C.cream);
  b.gable(0.3, 1.0, -0.5, 1.5, 1.9, 0.5, C.roofBrown, true);
  chimney(b, 0.9, 1.7, -0.6, 0.6); // top at y 2.3
  doorway(b, 0.0, 0.2, 's', 0.3, 0.55, C.dark, C.cream);
  frameWin(b, 0.6, 0.45, 0.2, 's', 0.22, 0, C.cream);
  frameWin(b, 1.05, 0.45, 0.2, 's', 0.22, 0, C.cream);
  // chip silo with a cone roof
  b.cyl(-0.95, 0, -0.55, 0.36, 1.3, C.grey, 'stone', 12);
  b.cone(-0.95, 1.3, -0.55, 0.42, 0.28, C.roofBlue, 'roof', 12);
  b.box(-0.55, 0.4, -0.1, 0.5, 0.12, 0.2, C.dark, 'wood', { ry: 0.5 }); // auger
  // log store (open shed) + stacked logs + a chip heap
  b.box(-1.0, 0, 0.75, 0.05, 0.6, 0.05, C.dark); b.box(-0.2, 0, 0.75, 0.05, 0.6, 0.05, C.dark);
  b.box(-0.6, 0.6, 0.75, 1.0, 0.04, 0.55, C.roofRed, 'roof', { rx: 0.12 });
  stackedLogs(b, -0.6, 0.75, 0.7);
  b.cone(0.9, 0.0, 0.95, 0.38, 0.32, C.sand, 'wood', 8);
}

/** Tree Nursery (3x3): glass-walled greenhouse (warm grow-light glow at night), rows of seedling beds with little trees, a potting shed and a wheelbarrow. */
export function treeNursery(b: PartBuilder, w: number, h: number): void {
  // greenhouse
  b.box(-0.55, 0, -0.55, 1.5, 0.12, 1.1, C.stone, 'stone');
  b.box(-0.55, 0.12, -0.55, 1.4, 0.5, 1.0, C.cream, 'wood');
  for (let i = 0; i < 5; i++) b.win(-1.15 + i * 0.3, 0.2, -0.04, 's', C.glass, 0.2);
  b.gable(-0.55, 0.62, -0.55, 1.1, 1.5, 0.35, C.cream, true, 'wood');
  // seedling beds with saplings
  for (let r = 0; r < 3; r++) {
    const z = 0.2 + r * 0.38;
    b.box(0.5, 0, z, 1.7, 0.1, 0.24, C.dark, 'wood');
    for (let i = 0; i < 5; i++) b.cone(-0.1 + i * 0.34, 0.1, z, 0.1, 0.26, 0x3f8f4a, 'roof', 6);
  }
  // potting shed
  b.box(w / 2 - 0.35, 0, -h / 2 + 0.4, 0.55, 0.6, 0.55, C.wood);
  b.gable(w / 2 - 0.35, 0.6, -h / 2 + 0.4, 0.6, 0.7, 0.2, C.roofGreen, false);
  // wheelbarrow
  b.box(w / 2 - 0.45, 0.1, h / 2 - 0.3, 0.3, 0.12, 0.22, C.green, 'wood');
  b.cyl(w / 2 - 0.45, 0, h / 2 - 0.15, 0.08, 0.04, C.black, 'wood', 6, { rz: Math.PI / 2 });
  b.sign('NURSERY', 0.0, 0.5, h / 2 - 0.05, 0.7, 0.2, 0, '#2e6b3a', '#fff4d6');
  b.fence(-w / 2 + 0.05, h / 2 - 0.1, w / 2 - 0.55, h / 2 - 0.1, C.wood, 0.3, 6);
}

/** Recycling & Compost Centre (3x2): sorting hall with a sloped green roof, three coloured bins, two timber compost bays and a conveyor ramp. */
export function recyclingCentre(b: PartBuilder, w: number, h: number): void {
  b.box(-0.5, 0, -0.35, 1.5, 0.75, 0.9, C.cream);
  b.gable(-0.5, 0.75, -0.35, 1.2, 1.7, 0.35, C.roofGreen, true);
  doorway(b, -0.9, 0.1, 's', 0.34, 0.5, C.dark, C.cream);
  frameWin(b, -0.35, 0.4, 0.1, 's', 0.2, 0, C.cream);
  b.wedge(-0.5, 0, 0.45, 0.8, 0.28, 0.3, C.grey, 0, 'stone'); // sorting ramp
  // coloured bins
  [C.blue, C.yellow, C.green].forEach((c, i) => {
    b.box(0.35 + i * 0.28, 0, 0.55, 0.22, 0.34, 0.22, c, 'wood');
    b.box(0.35 + i * 0.28, 0.34, 0.55, 0.25, 0.04, 0.25, C.dark, 'roof');
  });
  // compost bays: timber boxes with dark soil
  for (let i = 0; i < 2; i++) {
    const x = 0.75 + i * 0.62, z = -0.4;
    b.box(x, 0, z, 0.55, 0.3, 0.55, C.wood);
    b.box(x, 0.28, z, 0.46, 0.06, 0.46, 0x4a3524, 'wood');
  }
  b.sign('RECYCLE', -0.5, 0.95, 0.12, 0.8, 0.22, 0, '#2e6b3a', '#fff4d6');
  void w; void h;
}
