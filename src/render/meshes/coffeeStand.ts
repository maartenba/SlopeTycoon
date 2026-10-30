import { C, PartBuilder } from './common';

/**
 * Coffee Stand (1x1, Phase 6 Task 28, docs/coffee-stand.md): a tiny timber kiosk with a striped awning over a serving hatch, a red gable roof, a COFFEE board,
 * a steaming cup on the counter, an espresso-machine flue (the steam wisp emits from its top: catalog chimney) and a stool. About 450 triangles.
 */
export function coffeeStand(b: PartBuilder): void {
  b.box(0, 0, -0.08, 0.66, 0.56, 0.5, C.cream);
  b.box(0, 0, -0.08, 0.7, 0.08, 0.54, C.stone, 'stone'); // plinth
  b.gable(0, 0.56, -0.08, 0.58, 0.8, 0.22, C.red, true);
  // serving hatch on the front (+z): glass pane, counter shelf, striped awning
  b.box(0, 0.26, 0.18, 0.4, 0.22, 0.03, C.glass);
  b.box(0, 0.22, 0.24, 0.5, 0.035, 0.12, C.wood); // counter
  for (let i = 0; i < 5; i++) b.box(-0.2 + i * 0.1, 0.47, 0.27, 0.1, 0.04, 0.2, i % 2 ? C.white : C.red, 'roof', { rx: 0.3 });
  // steaming cup + a second cup on the counter
  b.cyl(-0.12, 0.255, 0.26, 0.035, 0.06, C.white, 'wood', 8);
  b.cyl(0.1, 0.255, 0.26, 0.03, 0.05, C.orange, 'wood', 8);
  // menu board on the side wall and the board above the hatch
  b.sign('COFFEE', 0, 0.44, 0.175, 0.34, 0.1, 0, '#4a2c17', '#f6e7b4');
  // espresso flue: the wisp rises from the top of the cap (catalog chimney y = 0.94)
  b.cyl(0.18, 0.56, -0.1, 0.04, 0.34, C.grey, 'stone', 8);
  b.cyl(0.18, 0.9, -0.1, 0.055, 0.04, C.dark, 'stone', 8);
  // stool
  b.cyl(-0.38, 0, 0.3, 0.06, 0.2, C.dark, 'wood', 8); b.cyl(-0.38, 0.2, 0.3, 0.09, 0.03, C.wood, 'wood', 8);
}
