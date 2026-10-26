import { C, PartBuilder, chimney, doorway, flagPole, frameWin, stackedLogs } from '../common';

const BEAR = 0x5a3a24;

/** Ranger Station (4x3): cosy timber lodge with a green roof, a paw/antler sign, ranger pick-up + ATV, bear-proof bins and a small fenced yard. */
export function rangerStation(b: PartBuilder, w: number, h: number): void {
  const lx = -0.6, lz = -0.35, lw = 2.0, ld = 1.5;
  // log lodge: dark base course + wood walls with horizontal log lines, green roof, porch
  b.box(lx, 0, lz, lw, 0.12, ld, C.stone, 'stone');
  b.box(lx, 0.12, lz, lw - 0.04, 0.68, ld - 0.04, C.wood);
  for (let i = 0; i < 5; i++) b.box(lx, 0.2 + i * 0.13, lz, lw + 0.03, 0.025, ld + 0.03, C.dark, 'wood');
  b.gable(lx, 0.8, lz, ld + 0.35, lw + 0.4, 0.55, C.roofGreen, true);
  b.box(lx, 1.35, lz, lw + 0.45, 0.03, 0.06, C.dark, 'roof'); // ridge cap
  const fz = lz + ld / 2;
  doorway(b, lx - 0.45, fz, 's', 0.3, 0.52, C.dark, C.cream);
  frameWin(b, lx + 0.2, 0.34, fz, 's', 0.22, 0.05, C.cream, C.roofGreen);
  frameWin(b, lx + 0.65, 0.34, fz, 's', 0.2, 0.05, C.cream, C.roofGreen);
  frameWin(b, lx - lw / 2, 0.36, lz, 'w', 0.22, 0.05, C.cream, C.roofGreen);
  // porch with posts and a bench
  b.box(lx - 0.1, 0.0, fz + 0.2, 1.3, 0.06, 0.4, C.wood, 'wood');
  for (const x of [-0.7, 0.5]) b.box(lx + x, 0.06, fz + 0.36, 0.05, 0.7, 0.05, C.dark);
  b.box(lx - 0.1, 0.74, fz + 0.28, 1.35, 0.05, 0.5, C.roofGreen, 'roof');
  b.box(lx + 0.35, 0.1, fz + 0.28, 0.5, 0.03, 0.12, C.dark);
  // paw + antler sign board above the door, on stakes
  b.sign('RANGERS', lx + 0.1, 1.0, fz + 0.56, 0.9, 0.26, 0, '#2e6b3a', '#fff4d6');
  for (const x of [-0.45, 0.65]) b.box(lx + x, 0.76, fz + 0.54, 0.04, 0.3, 0.04, C.dark);
  // antlers mounted on top of the sign board
  for (const s of [-1, 1]) {
    b.box(lx + 0.1 + s * 0.12, 1.14, fz + 0.57, 0.03, 0.2, 0.03, C.cream, 'wood', { rz: -s * 0.4 });
    b.box(lx + 0.1 + s * 0.23, 1.27, fz + 0.57, 0.03, 0.12, 0.03, C.cream, 'wood', { rz: s * 0.5 });
  }
  // brown paw print: pad + toes on a post at the entrance
  const px = lx + 1.35, pz = fz + 0.42;
  b.box(px, 0, pz, 0.05, 0.62, 0.05, C.dark);
  b.box(px, 0.6, pz, 0.3, 0.3, 0.04, C.cream);
  b.ball(px, 0.66, pz + 0.03, 0.07, BEAR, 'wood', 6);
  for (const dx of [-0.09, -0.03, 0.03, 0.09]) b.ball(px + dx, 0.79 + (Math.abs(dx) < 0.05 ? 0.03 : 0), pz + 0.03, 0.03, BEAR, 'wood', 5);
  chimney(b, lx - 0.55, 1.0, lz - 0.25, 0.5);
  stackedLogs(b, lx + 1.15, lz - 0.55, 0.5);
  flagPole(b, lx + lw / 2 + 0.2, fz - 0.1, 1.1, C.roofGreen, C.white, 0);

  // ranger pick-up (white/green) and ATV on the gravel yard
  const tx = w / 2 - 0.6, tz = -h / 2 + 0.7;
  b.box(tx, 0.05, tz, 0.5, 0.16, 0.95, C.white, 'wood');
  b.box(tx, 0.2, tz - 0.12, 0.44, 0.17, 0.4, C.roofGreen, 'wood');
  b.box(tx, 0.22, tz - 0.12, 0.46, 0.1, 0.3, 0x8fb4c8);
  b.box(tx, 0.36, tz - 0.12, 0.46, 0.03, 0.42, C.white, 'roof');
  b.box(tx, 0.3, tz + 0.18, 0.46, 0.08, 0.03, C.black); // light bar
  b.box(tx, 0.4, tz - 0.12, 0.3, 0.03, 0.04, C.orange);
  for (const sx of [-0.27, 0.27]) for (const sz of [-0.3, 0.3]) b.cyl(tx + sx, 0, tz + sz, 0.08, 0.07, C.black, 'wood', 6, { rz: Math.PI / 2 });
  const ax = w / 2 - 1.3, az = -h / 2 + 0.55;
  b.box(ax, 0.1, az, 0.32, 0.1, 0.6, C.green, 'wood');
  b.box(ax, 0.2, az - 0.12, 0.28, 0.05, 0.28, C.black);
  b.box(ax, 0.28, az + 0.12, 0.3, 0.03, 0.04, C.black);
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.22, 0.22]) b.cyl(ax + sx, 0, az + sz, 0.1, 0.1, C.black, 'wood', 6, { rz: Math.PI / 2 });

  // bear-proof bins (dark green, latch, brown stripe) in a fenced corner + small timber trap/enclosure
  for (let i = 0; i < 3; i++) {
    const bx = -w / 2 + 0.45 + i * 0.4, bz = h / 2 - 0.45;
    b.box(bx, 0, bz, 0.3, 0.38, 0.3, C.roofGreen, 'wood');
    b.box(bx, 0.38, bz, 0.34, 0.05, 0.34, C.dark, 'roof');
    b.box(bx, 0.2, bz + 0.16, 0.08, 0.06, 0.02, C.yellow);
    b.box(bx, 0.12, bz + 0.16, 0.3, 0.04, 0.02, BEAR);
  }
  b.fence(-w / 2 + 0.2, h / 2 - 0.15, -w / 2 + 1.55, h / 2 - 0.15, C.dark, 0.3, 4);
  b.fence(-w / 2 + 1.55, h / 2 - 0.85, -w / 2 + 1.55, h / 2 - 0.15, C.dark, 0.3, 2);
  // transport crate (bear trap cage): steel bars on a trailer
  const cx = w / 2 - 0.7, cz = h / 2 - 0.5;
  b.box(cx, 0.06, cz, 0.9, 0.05, 0.45, C.grey, 'stone');
  for (let i = 0; i <= 6; i++) b.box(cx - 0.4 + i * 0.133, 0.1, cz + 0.22, 0.025, 0.36, 0.025, C.dark);
  b.box(cx, 0.46, cz, 0.9, 0.03, 0.46, C.grey, 'stone');
  b.box(cx, 0.1, cz - 0.22, 0.9, 0.36, 0.025, C.dark);
  for (const sx of [-0.3, 0.3]) b.cyl(cx + sx, 0, cz + 0.27, 0.07, 0.05, C.black, 'wood', 6, { rz: Math.PI / 2 });
}
