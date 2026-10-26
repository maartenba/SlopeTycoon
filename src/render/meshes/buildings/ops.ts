import { C, PartBuilder, chimney, doorway, frameWin, snowcat } from '../common';

/** Helipad (3x3): round pad with big H, ring of edge lights, windsock, fuel drums and a small ops hut. */
export function helipad(b: PartBuilder, w: number, h: number): void {
  const r = Math.min(w, h) / 2 - 0.1;
  b.cyl(0, 0, 0, r, 0.1, C.grey, 'stone', 20);
  b.cyl(0, 0.1, 0, r - 0.08, 0.02, C.asphalt, 'stone', 20);
  b.cyl(0, 0.12, 0, r - 0.05, 0.015, C.yellow, 'stone', 20);
  b.cyl(0, 0.13, 0, r - 0.15, 0.015, C.asphalt, 'stone', 20);
  b.box(-0.3, 0.145, 0, 0.14, 0.01, 0.9, C.white, 'stone');
  b.box(0.3, 0.145, 0, 0.14, 0.01, 0.9, C.white, 'stone');
  b.box(0, 0.145, 0, 0.6, 0.01, 0.14, C.white, 'stone');
  for (let i = 0; i < 12; i++) { // edge lights (glass colour: glow at night)
    const a = (i / 12) * Math.PI * 2;
    b.box(Math.cos(a) * (r - 0.02), 0.1, Math.sin(a) * (r - 0.02), 0.07, 0.07, 0.07, C.glass);
  }
  // windsock
  b.cyl(w / 2 - 0.25, 0, -h / 2 + 0.25, 0.03, 0.9, C.dark, 'wood', 6);
  b.cone(w / 2 - 0.25, 0.7, -h / 2 + 0.25, 0.1, 0.35, C.orange, 'roof', 8, { rz: Math.PI / 2 });
  b.cyl(w / 2 - 0.45, 0.78, -h / 2 + 0.25, 0.1, 0.04, C.white, 'roof', 8, { rz: Math.PI / 2 });
  // ops hut + fuel drums in the opposite corner
  b.box(-w / 2 + 0.45, 0, h / 2 - 0.45, 0.6, 0.45, 0.5, C.white);
  b.gable(-w / 2 + 0.45, 0.45, h / 2 - 0.45, 0.6, 0.7, 0.2, C.roofRed, true);
  frameWin(b, -w / 2 + 0.45, 0.2, h / 2 - 0.2, 's', 0.14);
  for (const dz of [0, 0.2]) b.cyl(-w / 2 + 1.0 + dz, 0, h / 2 - 0.2, 0.08, 0.22, C.red, 'wood', 8);
}

/** Groomer Garage (3x3): big orange garage with a segmented roll-up door and a snowcat parked outside. */
export function groomerGarage(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.35, w - 0.3, 1.0, h - 1.0, C.orange);
  b.gable(0, 1.0, -0.35, h - 0.7, w - 0.1, 0.5, C.roofBlue, true);
  b.box(0, 1.48, -0.35, w - 0.05, 0.04, 0.05, C.dark, 'roof');
  const fz = -0.35 + (h - 1.0) / 2;
  b.box(0, 0, fz + 0.015, 1.7, 0.9, 0.06, C.dark);
  for (let i = 0; i < 6; i++) b.box(0, 0.1 + i * 0.14, fz + 0.06, 1.7, 0.03, 0.04, C.grey);
  b.box(0, 0.9, fz + 0.03, 1.85, 0.06, 0.08, C.white);
  b.sign('GROOMER', 0, 1.15, fz + 0.04, 1.1, 0.35, 0, '#2d5fa8');
  b.box(-1.1, 0.5, fz + 0.03, 0.2, 0.2, 0.05, C.yellow);
  for (const sx of [-1, 1]) frameWin(b, sx * (w - 0.3) / 2, 0.55, -0.35, sx < 0 ? 'w' : 'e', 0.22);
  chimney(b, 0.8, 1.0, -0.8, 0.5);
  snowcat(b, 0.7, fz + 0.65, 0.4, C.red, 1.15);
  for (const x of [-1.2, -1.0]) b.cyl(x, 0, fz + 0.35, 0.09, 0.28, C.yellow, 'wood', 8); // drums
}

/** Lift Maintenance Workshop (3x3): green-roofed hall with a roll-up door, outdoor gantry crane with hoist, cable drums and spare chairs. */
export function liftWorkshop(b: PartBuilder, w: number, h: number): void {
  b.box(0, 0, -0.4, w - 0.9, 1.0, h - 0.9, C.cream);
  b.gable(0, 1.0, -0.4, h - 0.7, w - 0.7, 0.45, C.roofGreen, true);
  const fz = -0.4 + (h - 0.9) / 2;
  b.box(-0.2, 0, fz + 0.015, 1.2, 0.85, 0.06, C.dark);
  for (let i = 0; i < 5; i++) b.box(-0.2, 0.1 + i * 0.15, fz + 0.06, 1.2, 0.025, 0.04, C.grey);
  b.sign('LIFTS', -0.2, 1.1, fz + 0.04, 0.9, 0.3, 0, '#2a7a3a');
  doorway(b, 0.65, fz, 's', 0.2, 0.5, C.dark);
  frameWin(b, 0.4 + 0.0, 0.7, fz, 's', 0.16);
  // gantry crane over the yard on the right
  const gx = w / 2 - 0.2;
  for (const z of [-1.1, 0.5]) { b.box(gx - 0.2, 0, z, 0.08, 1.3, 0.08, C.grey, 'stone'); b.box(gx - 0.2, 1.3, z, 0.12, 0.06, 0.12, C.yellow); }
  b.box(gx - 0.2, 1.3, -0.3, 0.1, 0.1, 1.8, C.yellow, 'wood');
  b.box(gx - 0.2, 1.05, -0.2, 0.05, 0.25, 0.05, C.dark); b.box(gx - 0.2, 0.9, -0.2, 0.14, 0.14, 0.14, C.red);
  // cable drums + spare chairs
  b.cyl(gx - 0.5, 0, 0.75, 0.2, 0.3, C.dark, 'wood', 10);
  b.cyl(gx - 0.5, 0, 0.75, 0.22, 0.04, C.wood, 'wood', 10); b.cyl(gx - 0.5, 0.26, 0.75, 0.22, 0.04, C.wood, 'wood', 10);
  for (let i = 0; i < 3; i++) { b.box(-w / 2 + 0.3, 0.02 + i * 0.12, 0.7 - i * 0.05, 0.5, 0.06, 0.2, C.red, 'roof'); b.box(-w / 2 + 0.3, 0.08 + i * 0.12, 0.62 - i * 0.05, 0.5, 0.1, 0.03, C.red, 'roof'); }
  b.box(-w / 2 + 0.4, 0, -h / 2 + 0.2, 0.1, 0.35, 0.1, C.grey, 'stone'); b.box(-w / 2 + 0.7, 0, -h / 2 + 0.2, 0.1, 0.35, 0.1, C.grey, 'stone'); // spare tower legs
}

/** Snowcat Outpost (2x2): small green shed, red fuel tank on a stand, drums and a parked snowcat. */
export function snowcatOutpost(b: PartBuilder, w: number, h: number): void {
  b.box(-0.35, 0, -0.35, 0.8, 0.6, 0.8, C.green);
  b.gable(-0.35, 0.6, -0.35, 1.0, 0.9, 0.35, C.roofBrown, false);
  doorway(b, -0.35, 0.05, 's', 0.28, 0.42);
  frameWin(b, -0.65, 0.3, 0.05 - 0.0, 's', 0.14);
  b.cyl(0.55, 0.25, -0.5, 0.17, 0.5, C.red, 'wood', 10, { rx: Math.PI / 2 }); // fuel tank
  for (const z of [-0.65, -0.35]) b.box(0.55, 0, z, 0.06, 0.25, 0.06, C.dark);
  b.cyl(0.55, 0.42, -0.5, 0.05, 0.1, C.yellow, 'wood', 6);
  snowcat(b, 0.3, 0.45, 0.5, C.red, 0.95);
  b.cyl(-0.85, 0, 0.5, 0.08, 0.22, C.blue, 'wood', 8);
  void w; void h;
}

/** Reservoir (4x4): round pond inside an earth embankment with a stone rim, pump house, pipework and a sign. */
export function reservoir(b: PartBuilder, w: number, h: number): void {
  const r = Math.min(w, h) / 2 - 0.05;
  const earth = 0x7b6a4a;
  b.cyl(0, 0, 0, r, 0.22, earth, 'stone', 24);
  b.ring(0, 0.16, 0, r - 0.15, 0.13, earth, 'stone', 24, { sy: 0.8 });
  b.ring(0, 0.3, 0, r - 0.15, 0.03, C.stone, 'stone', 24);
  b.cyl(0, 0.22, 0, r - 0.3, 0.02, C.water, 'stone', 24);
  b.cyl(0, 0.24, 0, r - 0.5, 0.012, 0x62bfe6, 'stone', 20);
  // pump house + pipes
  const px = r - 0.5, pz = -r + 0.5;
  b.box(px, 0, pz, 0.55, 0.5, 0.5, C.grey);
  b.gable(px, 0.5, pz, 0.6, 0.65, 0.22, C.roofBlue, true);
  frameWin(b, px, 0.2, pz + 0.25, 's', 0.14);
  b.cyl(px - 0.55, 0.3, pz + 0.1, 0.04, 0.5, C.grey, 'stone', 6, { rz: Math.PI / 2 });
  b.cyl(px - 0.8, 0.2, pz + 0.1, 0.07, 0.2, C.blue, 'stone', 8);
  b.cyl(px + 0.1, 0.5, pz - 0.05, 0.06, 0.4, C.dark, 'stone', 6); // vent stack
  for (const a of [0.6, 0.9, 1.2]) b.box(Math.cos(a + 2) * (r - 0.1), 0.0, Math.sin(a + 2) * (r - 0.1), 0.06, 0.4, 0.06, C.dark); // fence posts
  b.sign('H2O', -r + 0.5, 0.3, r - 0.4, 0.5, 0.24, 0, '#2d5fa8');
  b.box(-r + 0.5, 0.0, r - 0.42, 0.05, 0.3, 0.05, C.dark);
}

/** Snowmaking cannon (1x1): tower on a base with a fan-gun nozzle, hose reel and water pipe, small snow mound. */
export function snowCannon(b: PartBuilder): void {
  b.box(0, 0, 0, 0.5, 0.1, 0.5, C.grey, 'stone');
  b.cyl(0, 0.1, 0, 0.06, 0.8, C.grey, 'wood', 8);
  b.box(0, 0.5, 0, 0.3, 0.03, 0.03, C.dark, 'wood', { ry: Math.PI / 4 });
  b.cyl(0, 0.9, 0.1, 0.1, 0.35, C.red, 'wood', 10, { rx: Math.PI / 2 - 0.5 });
  b.cyl(0, 0.95, 0.26, 0.14, 0.04, C.yellow, 'wood', 10, { rx: Math.PI / 2 - 0.5 });
  b.cyl(0, 0.9, -0.05, 0.05, 0.12, C.dark, 'wood', 8, { rx: Math.PI / 2 - 0.5 });
  b.box(0.1, 0.1, 0.1, 0.1, 0.25, 0.1, C.blue);
  b.ring(-0.12, 0.1, 0.12, 0.09, 0.02, C.black, 'wood', 10);
  b.cone(0.0, 0.0, 0.42, 0.22, 0.16, C.white, 'stone', 8);
}

/** Shuttle Bus Depot (3x3): canopy over a bus bay with a yellow bus, a garage with roll-up door, bus-stop sign and bench. */
export function shuttleDepot(b: PartBuilder, w: number, h: number): void {
  for (const x of [-w / 2 + 0.2, 0.3]) for (const z of [-h / 2 + 0.3, h / 2 - 0.3]) b.box(x, 0, z, 0.1, 1.0, 0.1, C.dark);
  b.gable(-0.6, 1.0, 0, h - 0.1, 1.8, 0.4, C.roofGreen, true);
  b.box(-0.6, 0.05, 0, 1.7, 0.04, h - 0.4, C.asphalt, 'stone');
  // bus
  b.box(-0.6, 0.12, 0.1, 0.7, 0.4, 1.7, C.yellow);
  b.box(-0.6, 0.52, 0.1, 0.66, 0.02, 1.66, C.white, 'roof');
  b.box(-0.6, 0.12, 0.1, 0.72, 0.05, 1.72, C.red);
  for (let i = 0; i < 4; i++) { b.win(-0.96, 0.35, -0.5 + i * 0.4, 'w', C.glass, 0.18); b.win(-0.24, 0.35, -0.5 + i * 0.4, 'e', C.glass, 0.18); }
  b.box(-0.6, 0.32, 0.96, 0.5, 0.18, 0.03, C.glass);
  for (const x of [-0.97, -0.23]) for (const z of [-0.5, 0.7]) b.cyl(x, 0.0, z, 0.1, 0.08, C.black, 'wood', 8, { rz: Math.PI / 2 });
  // garage
  b.box(1.0, 0, -0.2, 0.9, 0.9, 2.2, C.cream);
  b.gable(1.0, 0.9, -0.2, 1.0, 2.3, 0.3, C.roofBlue, false);
  b.box(1.0, 0, 0.92, 0.7, 0.75, 0.04, C.dark);
  for (let i = 0; i < 5; i++) b.box(1.0, 0.1 + i * 0.14, 0.95, 0.7, 0.025, 0.03, C.grey);
  frameWin(b, 1.46, 0.45, -0.5, 'e', 0.2); frameWin(b, 1.46, 0.45, 0.1, 'e', 0.2);
  b.sign('SHUTTLE', -0.6, 1.15, h / 2 - 0.35, 1.0, 0.3, 0, '#3d8f3d');
  b.box(-0.6, 1.1, h / 2 - 0.35, 1.1, 0.34, 0.03, C.dark);
  // bus stop sign + bench
  b.cyl(-1.4, 0, h / 2 - 0.15, 0.025, 0.8, C.grey, 'wood', 6); b.cyl(-1.4, 0.7, h / 2 - 0.15, 0.1, 0.03, C.green, 'roof', 10, { rx: Math.PI / 2 });
  b.box(0.25, 0.1, h / 2 - 0.2, 0.7, 0.04, 0.16, C.wood); b.box(0.25, 0.14, h / 2 - 0.28, 0.7, 0.14, 0.03, C.wood);
}
