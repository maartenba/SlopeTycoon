/* Contact sheets for M8: vite-node scripts/shots/m8-montage.ts [after-prefix]  -> docs/img/graphics-*.webp (each <= 400 kB).
 * Audit sheets (before only) + before | after sheets (8.8). Reads .weave/shots/m8-before-*.png and <after-prefix>-*.png (staged, not committed). */
import { mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const after = process.argv[2] ?? 'm8-after-final';
const SHEETS: Record<string, string[]> = {
  'graphics-audit-categories': ['resort-demo-winter-iso', 'resort-demo-summer-iso', 'trees-winter-close', 'trees-summer-close', 'guests-winter-lineup', 'guests-slope-iso', 'animals-any', 'animals-ibex', 'vehicles-snowcat', 'lifts-starter-close', 'water-river-summer', 'terrain-256-far', 'light-dusk', 'light-night', 'light-lowsun-lodge-close', 'guests-ride-skier'],
  'graphics-audit-buildings': Array.from({ length: 18 }, (_, i) => `bld-${String(i).padStart(2, '0')}`),
};
/** before | after pairs: [label, beforeFile, afterFile] (full file names under .weave/shots without .png). */
type Pair = [label: string, before: string, after: string];
const b = (n: string): string => `m8-before-${n}`, a = (n: string): string => `${after}-${n}`;
const pair = (n: string): Pair => [n, b(n), a(n)];
const PAIRS: Record<string, Pair[]> = {
  'graphics-m8-buildings': ['bld-00', 'bld-02', 'bld-05', 'bld-07', 'bld-10', 'bld-14', 'bld-16', 'resort-demo-winter-iso'].map(pair),
  'graphics-m8-lifts': ['lift-rows0', 'lift-rows1', 'lifts-starter-close', 'lifts-starter-mid', 'icons-lifts-drawer', 'vehicles-snowcat'].map(pair),
  'graphics-m8-nature': ['trees-winter-close', 'trees-summer-close', 'trees-summer-mid', 'light-lowsun-trees', 'animals-chamois', 'animals-ibex', 'guests-winter-lineup', 'guests-slope-iso'].map(pair),
  'graphics-m8-terrain': ['terrain-256-far', 'terrain-winter-iso', 'terrain-summer-iso', 'water-river-summer', 'water-river-winter-ice', 'snow-close-winter'].map(pair),
  'graphics-m8-shadows': [['winter 15:30, Low vs High (after both)', 'm8-sh-low', 'm8-sh-high'], ['summer 17:00 rotated, Low vs High (after both)', 'm8-sh2-low', 'm8-sh2-high'], ...['light-lowsun-lodge-close', 'light-dusk'].map(pair)],
};
const W = 480, H = 300;
mkdirSync('docs/img', { recursive: true });
const label = (t: string, w: number): Buffer => Buffer.from(`<svg width="${w}" height="22"><rect width="${w}" height="22" fill="#000" fill-opacity="0.55"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${t.replace(/&/g, '&amp;')}</text></svg>`);
async function tile(file: string, text: string, left: number, top: number, w = W, h = H) {
  const img = await sharp(`.weave/shots/${file}.png`).resize(w, h, { fit: 'cover' }).toBuffer();
  return { input: await sharp(img).composite([{ input: label(text, w), top: h - 22, left: 0 }]).toBuffer(), left, top };
}
async function save(name: string, base: sharp.Sharp): Promise<void> {
  for (const q of [80, 70, 60, 50, 40]) {
    await base.clone().webp({ quality: q }).toFile(`docs/img/${name}.webp`);
    const kb = statSync(`docs/img/${name}.webp`).size / 1024;
    console.log(`${name}.webp q${q} ${kb.toFixed(0)} kB`);
    if (kb <= 390) break;
  }
}
for (const [name, ids] of Object.entries(SHEETS)) {
  const cols = 4, rows = Math.ceil(ids.length / cols);
  const tiles = await Promise.all(ids.map((id, i) => tile(b(id), id, (i % cols) * W, Math.floor(i / cols) * H)));
  await save(name, sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#222' } }).composite(tiles));
}
for (const [name, pairs] of Object.entries(PAIRS)) {
  const cols = 2, rows = pairs.length; // each row = one pair; smaller tiles so the sheet stays under 400 kB
  const w = 420, h = 262;
  const tiles = (await Promise.all(pairs.flatMap(([l, bf, af], r) => [tile(bf, `before: ${l}`, 0, r * h, w, h), tile(af, `after: ${l}`, w, r * h, w, h)]))).flat();
  await save(name, sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#222' } }).composite(tiles));
}
