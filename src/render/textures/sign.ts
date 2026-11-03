import * as THREE from 'three';

/** Canvas signage (2:1 board): coloured panel, double border and bold centred text. Null without a DOM. */
export function createSignTexture(text: string, bg = '#7a4a24', fg = '#fff4d6'): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(4, 4, 248, 120);
  g.lineWidth = 2;
  g.strokeRect(12, 12, 232, 104);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 72;
  g.font = `800 ${size}px 'Nunito', sans-serif`;
  while (g.measureText(text).width > 256 - 40 && size > 12) { size -= 4; g.font = `800 ${size}px 'Nunito', sans-serif`; }
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Schirmbar banner (M7.8): a red canvas band, 4:1, with the resort name in capitals and a small 'APRES-SKI' after it. Text only (no brands), world-space UVs,
 * linear filtering with mipmaps off so it never shimmers. Null without a DOM. `name` is already sanitised plain text (`sanitizeResortName`).
 */
export function bannerLabel(name: string): string { return `${name.toUpperCase()}  \u00B7  APRES-SKI`; }
export function createBannerTexture(name: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#b3261e';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#e8c35a';
  g.fillRect(0, 6, 512, 6); g.fillRect(0, 116, 512, 6);
  g.fillStyle = '#fff4d6';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = bannerLabel(name);
  let size = 78;
  g.font = `800 ${size}px 'Lilita One', 'Nunito', sans-serif`;
  while (g.measureText(text).width > 512 - 36 && size > 14) { size -= 3; g.font = `800 ${size}px 'Lilita One', 'Nunito', sans-serif`; }
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
