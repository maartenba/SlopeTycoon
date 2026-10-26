import * as THREE from 'three';
import { makeCanvasTexture } from './wood';

export function createRoofTexture(): THREE.CanvasTexture | null {
  return makeCanvasTexture(64, (g, s) => {
    g.fillStyle = '#f0f0f0';
    g.fillRect(0, 0, s, s);
    const rows = 4, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 8 : 0;
      for (let x = -s / 4; x < s; x += s / 4) {
        g.fillStyle = (r + x / 16) % 2 ? '#fcfcfc' : '#e6e6e6';
        g.fillRect(x + off, r * rh, s / 4 - 1, rh - 1);
      }
      g.fillStyle = '#b0b0b0';
      g.fillRect(0, r * rh + rh - 1, s, 1);
    }
  });
}
