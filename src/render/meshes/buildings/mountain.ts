import { C, PartBuilder, chimney, flagPole, house, parasolTable, picnicTable, stackedLogs } from '../common';

/** Mid-mountain hut (2x2): small timber cabin with stone chimney, sunny terrace with parasol tables, logs and a pennant. */
export function mountainHut(b: PartBuilder, w: number, h: number): void {
  house(b, 0, -0.15, w - 0.5, h - 0.8, 0.7, C.wood, C.roofBrown, 0.5, true);
  b.box(0, 0.08, -0.15 + (h - 0.8) / 2, w - 0.46, 0.04, 0.03, C.dark);
  chimney(b, 0.35, 0.8, -0.35, 0.45);
  b.box(0, 0, h / 2 - 0.2, w - 0.4, 0.05, 0.35, C.stone, 'stone'); // terrace slab
  for (const x of [-0.7, 0.7]) b.box(x, 0.05, h / 2 - 0.05, 0.05, 0.3, 0.05, C.dark);
  b.box(0, 0.3, h / 2 - 0.05, 1.45, 0.04, 0.04, C.dark);
  parasolTable(b, -0.35, h / 2 - 0.2, C.orange, 0);
  picnicTable(b, 0.5, h / 2 - 0.22);
  b.sign('HUT', 0, 0.35, h / 2 - 0.55, 0.45, 0.2);
  stackedLogs(b, -w / 2 + 0.12, -0.2, 0.5);
  flagPole(b, 0.35, -0.55, 0.45, C.red, C.white, 1.0);
}
