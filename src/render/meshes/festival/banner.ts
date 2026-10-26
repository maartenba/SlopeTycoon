import * as THREE from 'three';

/**
 * Banner atlas: every banner's text (the festival names, "FINISH") lives in one canvas texture, one row per label, so all banners of all
 * running festivals are ONE textured mesh = one draw call. Rows are 512 x 64 px; the atlas is 512 x 512 (8 labels).
 */
export const ATLAS_ROWS = 8;
export const ATLAS_W = 512;
export const ATLAS_H = 512;

/** UV band (v0..v1, v increasing upwards, CanvasTexture flipY) of label row `row`. */
export function rowV(row: number): { v0: number; v1: number } { return { v0: 1 - (row + 1) / ATLAS_ROWS, v1: 1 - row / ATLAS_ROWS }; }

/** Cloth colour per row (cycled). */
const CLOTH = ['#c0392b', '#2f7d46', '#2a5fb0', '#8e5bd0', '#d68910', '#1f8a84', '#b03a6b', '#4a5568'];

/** Paint the labels (cloth colour, a cream border, bold text). Returns null where no 2D canvas exists (node / happy-dom tests). */
export function paintAtlas(labels: readonly string[]): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = ATLAS_H;
  const g = c.getContext('2d');
  if (!g) return null;
  const rh = ATLAS_H / ATLAS_ROWS;
  labels.slice(0, ATLAS_ROWS).forEach((text, row) => {
    const y = row * rh;
    g.fillStyle = CLOTH[row % CLOTH.length]!; g.fillRect(0, y, ATLAS_W, rh);
    g.strokeStyle = '#f4efe2'; g.lineWidth = 4; g.strokeRect(5, y + 5, ATLAS_W - 10, rh - 10);
    g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 40;
    g.font = `${size}px "Lilita One", "Nunito", sans-serif`;
    while (size > 14 && g.measureText(text).width > ATLAS_W - 36) { size -= 2; g.font = `${size}px "Lilita One", "Nunito", sans-serif`; }
    g.fillText(text, ATLAS_W / 2, y + rh / 2 + 2);
  });
  return c;
}

export interface BannerPlacement { x: number; y: number; z: number; ry: number; w: number; h: number; row: number }

/** Double-sided banner boards (two back-to-back planes so the text reads correctly from both sides). World coordinates, UVs from the atlas row. */
export function bannerBoards(items: readonly BannerPlacement[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const b of items) {
    const { v0, v1 } = rowV(b.row), c = Math.cos(b.ry), s = Math.sin(b.ry), hw = b.w / 2;
    // local x -> world (c, 0, -s); local z -> (s, 0, c); the front faces local +z
    const P = (lx: number, ly: number): [number, number, number] => [b.x + c * lx, b.y + ly, b.z - s * lx];
    const nf: [number, number, number] = [s, 0, c];
    for (const face of [1, -1] as const) {
      const n: [number, number, number] = [nf[0] * face, 0, nf[2] * face], z = 0.012 * face;
      const corner = (lx: number, ly: number): [number, number, number] => { const p = P(lx, ly); return [p[0] + s * z, p[1], p[2] + c * z]; };
      // front: left -> right; back: mirrored so u still runs left-to-right for the viewer
      const xl = -hw * face, xr = hw * face;
      const a = corner(xl, -b.h / 2), bb = corner(xr, -b.h / 2), cc = corner(xr, b.h / 2), d = corner(xl, b.h / 2);
      const tri = [a, bb, cc, a, cc, d]; // the back is the mirror image seen from behind: same layout, same winding
      const uvs = [[0, v0], [1, v0], [1, v1], [0, v0], [1, v1], [0, v1]];
      tri.forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(uvs[i]![0]!, uvs[i]![1]!); });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  return g;
}
