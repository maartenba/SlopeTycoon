import * as THREE from 'three';

/** Lazily creates a canvas texture; returns null where no DOM exists (node tests). Greyscale so vertex colours tint it. */
export function makeCanvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function createWoodTexture(): THREE.CanvasTexture | null {
  return makeCanvasTexture(64, (g, s) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, s, s);
    const plank = s / 4;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#e4e4e4' : '#fafafa';
      g.fillRect(0, i * plank, s, plank - 2);
      g.fillStyle = '#b8b8b8';
      g.fillRect(0, i * plank + plank - 2, s, 2);
      g.fillStyle = '#d0d0d0';
      for (let k = 0; k < 3; k++) g.fillRect(((i * 23 + k * 29) % s), i * plank + 4 + k * 3, 14, 1);
    }
  });
}
