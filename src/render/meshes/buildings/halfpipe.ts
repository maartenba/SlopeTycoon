import * as THREE from 'three';
import { C, PartBuilder, flagPole } from '../common';

/**
 * Halfpipe (0.9.0, docs/snow-park.md): a 3 x 8 snow channel (one extruded U profile: ~70 triangles), blue coping along both lips, two flags at the top and a small start platform.
 * Three groups only (snow = stone layer, coping + flags = wood, the platform = wood). The channel runs along z.
 */
export function halfpipe(b: PartBuilder, w: number, h: number): void {
  const half = w / 2 - 0.08, len = h - 0.3, wallH = 0.7, steps = 8, flat = 0.28;
  // profile in (x, y): the snow block with a U cut into it; the walls curve up from the flat bottom (a quarter circle-ish ease)
  const s = new THREE.Shape();
  s.moveTo(-half - 0.12, 0);
  s.lineTo(half + 0.12, 0);
  s.lineTo(half + 0.12, wallH);
  for (let i = steps; i >= 0; i--) {
    const t = i / steps; // 1 at the lip .. 0 at the bottom
    s.lineTo(flat + (half - flat) * t, 0.06 + (wallH - 0.06) * (t * t));
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    s.lineTo(-(flat + (half - flat) * t), 0.06 + (wallH - 0.06) * (t * t));
  }
  s.lineTo(-half - 0.12, wallH);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  b.add(g, 'stone', C.white, 0, 0, 0);
  b.box(0, 0.05, 0, flat * 2 + 0.1, 0.02, len - 0.04, 0xa9cfee, 'wood'); // a blue-grey ice floor: reads as a channel from above
  // coping: a blue bar along each lip
  for (const sx of [-1, 1]) b.box(sx * (half + 0.02), wallH - 0.02, 0, 0.07, 0.05, len + 0.04, C.blue, 'wood');
  // start platform + flags at the top (-z end), a dark tube rail
  b.box(0, 0, -len / 2 - 0.05, w - 0.5, 0.1, 0.18, C.wood, 'wood');
  flagPole(b, -half - 0.1, -len / 2, 0.8, C.red, C.orange);
  flagPole(b, half + 0.1, -len / 2, 0.8, C.blue, C.yellow);
}
