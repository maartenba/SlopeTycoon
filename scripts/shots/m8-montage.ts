/* Contact sheets for the M8 audit: vite-node scripts/shots/m8-montage.ts  -> docs/img/graphics-audit-*.webp (each <= 400 kB). Reads .weave/shots/m8-before-*.png (staged, not committed). */
import { mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SHEETS: Record<string, string[]> = {
  'graphics-audit-categories': ['resort-demo-winter-iso', 'resort-demo-summer-iso', 'trees-winter-close', 'trees-summer-close', 'guests-winter-lineup', 'guests-slope-iso', 'animals-deer-placeholder', 'animals-ibex', 'vehicles-snowcat', 'lifts-starter-close', 'water-river-summer', 'terrain-256-far', 'light-dusk', 'light-night', 'light-lowsun-lodge-close', 'guests-ride-skier'],
  'graphics-audit-buildings': Array.from({ length: 18 }, (_, i) => `bld-${String(i).padStart(2, '0')}`),
};
const W = 480, H = 300, COLS = 4;
mkdirSync('docs/img', { recursive: true });
for (const [name, ids] of Object.entries(SHEETS)) {
  const files = ids.map((i) => `.weave/shots/m8-before-${i === 'animals-deer-placeholder' ? 'animals-any' : i}.png`);
  const rows = Math.ceil(files.length / COLS);
  const tiles = await Promise.all(files.map(async (f, i) => {
    const img = await sharp(f).resize(W, H, { fit: 'cover' }).toBuffer();
    const label = Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="#000" fill-opacity="0.55"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${ids[i]!.replace('animals-deer-placeholder', 'animals-any (deer)')}</text></svg>`);
    return { input: await sharp(img).composite([{ input: label, top: H - 22, left: 0 }]).toBuffer(), left: (i % COLS) * W, top: Math.floor(i / COLS) * H };
  }));
  const base = sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#222' } }).composite(tiles);
  for (const q of [80, 70, 60, 50, 40]) {
    await base.clone().webp({ quality: q }).toFile(`docs/img/${name}.webp`);
    const kb = statSync(`docs/img/${name}.webp`).size / 1024;
    console.log(`${name}.webp q${q} ${kb.toFixed(0)} kB`);
    if (kb <= 390) break;
  }
}
