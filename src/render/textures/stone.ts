import * as THREE from 'three';
import { makeCanvasTexture } from './wood';

export function createStoneTexture(): THREE.CanvasTexture | null {
  return makeCanvasTexture(64, (g, s) => {
    g.fillStyle = '#c4c4c4';
    g.fillRect(0, 0, s, s);
    const rows = 4, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 6 : 0;
      for (let x = -s / 3; x < s; x += s / 3) {
        const v = 215 + ((r * 7 + Math.round(x)) % 5) * 8;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + off + 1, r * rh + 1, s / 3 - 2, rh - 2);
      }
    }
  });
}
