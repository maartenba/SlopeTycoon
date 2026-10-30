import { C, PartBuilder } from './common';

/**
 * Fishing pier (1x2, about 260 triangles): a timber jetty that runs the whole footprint (the shore end is the south end), plank deck on piles, a rope rail on
 * the sides, a mooring bollard, a bench at the shore end and a bait bucket. The four fishing places sit on the deck (drawn by the guest renderer).
 */
export function fishingPier(b: PartBuilder, w: number, h: number): void {
  const dw = Math.min(0.62, w - 0.2), dl = h - 0.1;
  b.box(0, 0.12, 0, dw, 0.05, dl, C.wood); // deck
  for (let i = 0; i < 6; i++) b.box(0, 0.17, -dl / 2 + 0.2 + i * ((dl - 0.4) / 5), dw + 0.04, 0.012, 0.03, C.dark); // plank seams
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.cyl(s * (dw / 2 - 0.04), -0.15, -dl / 2 + 0.16 + i * ((dl - 0.32) / 2), 0.03, 0.3, C.dark, 'wood', 5); // piles
  for (const s of [-1, 1]) { // rope rail on the sides, open at the shore end
    for (let i = 0; i < 3; i++) b.box(s * (dw / 2 - 0.02), 0.17, -dl / 2 + 0.12 + i * 0.45, 0.03, 0.2, 0.03, C.dark);
    b.box(s * (dw / 2 - 0.02), 0.33, -dl / 2 + 0.57, 0.015, 0.015, 0.9, C.cream);
  }
  b.cyl(0, 0.17, -dl / 2 + 0.09, 0.045, 0.1, C.dark, 'wood', 6); // bollard at the water end
  b.box(0, 0.17, dl / 2 - 0.25, 0.4, 0.04, 0.12, C.wood); for (const s of [-1, 1]) b.box(s * 0.16, 0.17, dl / 2 - 0.25, 0.04, 0.1, 0.1, C.dark); // bench
  b.cyl(0.18, 0.17, 0.1, 0.05, 0.09, C.blue, 'wood', 6); // bucket
  b.ball(0, 0.37, -dl / 2 + 0.09, 0.03, C.yellow); // little mooring lamp
}
