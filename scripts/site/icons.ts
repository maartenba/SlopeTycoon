/** Favicon set + site web manifest for the website (built with sharp from the game's own icons in public/icons). */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Packs PNG images into one .ico (PNG-compressed entries, valid for 16..256 px). */
export function icoFromPngs(pngs: Array<{ size: number; data: Buffer }>): Buffer {
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => { const o = 6 + 16 * i; head.writeUInt8(p.size >= 256 ? 0 : p.size, o); head.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(p.data.length, o + 8); head.writeUInt32LE(off, o + 12); off += p.data.length; });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}
export const siteManifest = (): Record<string, unknown> => ({
  name: 'Slope Tycoon: ski resort tycoon game', short_name: 'Slope Tycoon', description: 'Website and player guide of Slope Tycoon, a browser ski resort tycoon. The game itself lives at play/.', start_url: './', scope: './', display: 'browser', theme_color: '#0b1626', background_color: '#0b1626', lang: 'en',
  icons: [{ src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});

export async function writeIcons(out: string): Promise<void> {
  const dir = join(out, 'assets', 'icons'); mkdirSync(dir, { recursive: true });
  cpSync('public/icons/favicon.svg', join(dir, 'icon.svg'));
  for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) cpSync(join('public/icons', f), join(dir, f));
  const sharp = (await import('sharp')).default, svg = readFileSync('public/icons/favicon.svg');
  const pngs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer() })));
  writeFileSync(join(out, 'favicon.ico'), icoFromPngs(pngs));
  writeFileSync(join(out, 'site.webmanifest'), `${JSON.stringify(siteManifest(), null, 2)}\n`);
}
