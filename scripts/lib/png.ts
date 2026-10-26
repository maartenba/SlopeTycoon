import { deflateSync } from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf: Uint8Array): number { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** Encodes RGBA8 pixels as a PNG (filter 0, zlib level 9). */
export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
export function pngSize(png: Uint8Array): { w: number; h: number } | null {
  const b = Buffer.from(png);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tri = (u: number, v: number, ax: number, ay: number, slope: number, base: number): boolean => v >= ay && v <= base && Math.abs(u - ax) <= (v - ay) * slope;

/** Logo colour at normalised (u,v) in [0,1]²: gradient sky, two snowy peaks, snowfield, a lift cable with a red chair. */
function logo(u: number, v: number): RGB {
  let c = mix([0x1d, 0x3b, 0x6e], [0xa6, 0xd6, 0xf2], Math.min(1, v / 0.85));
  const sd = Math.hypot(u - 0.8, v - 0.2); if (sd < 0.07) c = [0xff, 0xe9, 0xa8];
  if (tri(u, v, 0.66, 0.3, 0.62, 0.9)) c = v < 0.3 + 0.1 + 0.02 * Math.sin(u * 60) ? [0xf4, 0xf8, 0xfc] : [0x4f, 0x6a, 0x86];
  if (tri(u, v, 0.34, 0.4, 0.78, 0.9)) c = v < 0.4 + 0.12 + 0.02 * Math.sin(u * 50) ? [0xff, 0xff, 0xff] : [0x72, 0x90, 0xac];
  if (v > 0.8 + 0.02 * Math.sin(u * 9)) c = [0xf4, 0xf8, 0xfc];
  // cable from (0.08,0.66) to the back peak (0.66,0.3)
  const ax = 0.08, ay = 0.66, bx = 0.66, by = 0.3, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / L2));
  if (Math.hypot(u - (ax + t * dx), v - (ay + t * dy)) < 0.011) c = [0x22, 0x2a, 0x36];
  const cx = ax + 0.5 * dx, cy = ay + 0.5 * dy;
  if (Math.abs(u - cx) < 0.006 && v > cy && v < cy + 0.07) c = [0x22, 0x2a, 0x36];
  if (Math.abs(u - cx) < 0.05 && v > cy + 0.07 && v < cy + 0.12) c = [0xd8, 0x40, 0x2f];
  return c;
}

/** Rasterises the logo (2×2 supersampled). `maskable`: full-bleed with content shrunk into the 80% safe zone. `rounded`: transparent rounded corners. */
export function renderLogo(size: number, opts: { maskable?: boolean; rounded?: boolean } = {}): Uint8Array {
  const px = new Uint8Array(size * size * 4), SS = 2, scale = opts.maskable ? 0.8 : 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u0 = (x + (sx + 0.5) / SS) / size, v0 = (y + (sy + 0.5) / SS) / size;
      const u = (u0 - 0.5) / scale + 0.5, v = (v0 - 0.5) / scale + 0.5;
      let cov = 1;
      if (opts.rounded) { const rad = 0.2, qx = Math.abs(u0 - 0.5) - (0.5 - rad), qy = Math.abs(v0 - 0.5) - (0.5 - rad); if (qx > 0 && qy > 0 && Math.hypot(qx, qy) > rad) cov = 0; }
      const col = logo(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
      r += col[0] * cov; g += col[1] * cov; b += col[2] * cov; a += cov;
    }
    const i = (y * size + x) * 4, n = SS * SS;
    px[i] = a ? r / a : 0; px[i + 1] = a ? g / a : 0; px[i + 2] = a ? b / a : 0; px[i + 3] = Math.round((255 * a) / n);
  }
  return px;
}
