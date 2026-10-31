import { C } from '../common';
import { HEAD, PANE, STEEL, STEEL_DARK, CONCRETE, SB, guideRails } from './stationKit';
import type { LiftFamily } from '../../../config/lifts';

/**
 * Mid-station of an N-station lift (docs/mid-stations.md): a pass-through station on the line. Both ends are open (the cable runs straight through the
 * hall at head height), a platform on each side of the two strands, a canopy (chairs) / glazed hall (gondolas) / stone hall (cable car), guide rails
 * where the carriers slow down, lamp posts for the night. No bullwheel, no drive house, no ticket gates. Symmetric along the line, so one mesh serves both
 * directions. Budget: <= 600 triangles (tests/render/midStation.test.ts).
 */
/** Lamp-head vertex colour: the lift station material glows these pixels warm at night (same night uniform as the building windows and the path net; no extra draw call, docs/mid-stations.md). */
export const LAMP_HEAD = 0xfff0b4;
export interface MidTheme { accent: number; roof: number; wall: number; text: string; bg: string }
export const MID_THEMES: Record<LiftFamily, MidTheme> = {
  tbar: { accent: C.yellow, roof: C.roofBrown, wall: C.wood, text: 'MID', bg: '#e8a800' },
  chair: { accent: C.red, roof: C.roofRed, wall: STEEL, text: 'MID STATION', bg: '#a93226' },
  gondola: { accent: C.blue, roof: STEEL, wall: PANE, text: 'MID STATION', bg: '#2d5fa8' },
  cablecar: { accent: C.yellow, roof: C.roofRed, wall: C.stone, text: 'MID STATION', bg: '#a07a10' },
  funicular: { accent: C.green, roof: C.roofGreen, wall: C.cream, text: 'MID', bg: '#2e6b4a' },
};

export function midStationDesign(family: LiftFamily): (s: SB) => void {
  const t = MID_THEMES[family];
  return (s) => {
    const roofY = family === 'cablecar' ? 1.5 : family === 'gondola' ? 1.4 : 1.25;
    s.box(0, 0, 0, 2.0, 0.12, 2.0, CONCRETE);
    // platforms either side of the strands (+ hazard edge), a low kerb in the middle
    for (const x of [-0.72, 0.72]) {
      s.box(x, 0.12, 0, 0.5, 0.1, 1.8, family === 'cablecar' ? C.stone : 0xa0793e);
      s.box(x + (x < 0 ? 0.23 : -0.23), 0.22, 0, 0.04, 0.01, 1.8, C.yellow);
    }
    s.box(0, 0.12, 0, 0.5, 0.04, 1.8, STEEL_DARK);
    // posts + canopy roof (low gable with a snow cap, like the terminals)
    for (const x of [-0.95, 0.95]) for (const u of [-0.8, 0, 0.8]) s.box(x, 0.12, u, 0.07, roofY - 0.12, 0.07, t.accent);
    s.box(0, roofY, 0, 2.0, 0.07, 1.9, t.roof);
    s.box(0, roofY + 0.07, 0, 2.04, 0.03, 1.94, C.white);
    s.gable(0, roofY + 0.1, 0, 1.9, 1.9, 0.14, t.roof);
    if (family === 'gondola') { // glazed side walls
      for (const x of [-0.95, 0.95]) s.box(x, 0.22, 0, 0.03, roofY - 0.5, 1.7, PANE);
    }
    if (family === 'cablecar') { // stone side walls with windows
      for (const x of [-0.95, 0.95]) { s.box(x, 0.12, 0, 0.16, roofY - 0.12, 1.7, t.wall); s.box(x + (x < 0 ? 0.09 : -0.09), 0.7, 0, 0.02, 0.35, 0.8, C.glass); }
    }
    // the cable passes straight through: two guide rails at the strands where carriers slow down + a rail every 0.5
    guideRails(s, -0.95, 0.95, HEAD - 0.3, STEEL_DARK);
    for (const x of [-0.3, 0.3]) for (const u of [-0.8, 0, 0.8]) s.box(x, HEAD - 0.3, u, 0.04, 0.3, 0.04, STEEL);
    // two lamp posts for the night
    for (const x of [-0.95, 0.95]) { s.box(x * 1.0, 0.12, 0.92, 0.04, roofY - 0.1, 0.04, STEEL_DARK); s.box(x * 1.0, roofY - 0.18, 0.92, 0.16, 0.08, 0.16, LAMP_HEAD); }
    // sign board on both ends
    s.signs(t.text, 0, roofY + 0.45, 0.95, 0.9, 0.28, t.bg);
    s.box(0, roofY + 0.07, 0.95, 0.05, 0.38, 0.05, STEEL_DARK);
  };
}
