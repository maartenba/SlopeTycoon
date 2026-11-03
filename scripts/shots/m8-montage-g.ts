/* M8 lane G contact sheets: vite-node scripts/shots/m8-montage-g.ts -> docs/img/graphics-m8g-*.webp (each <= 400 kB). Reads .weave/shots (staged, not committed). */
import { statSync } from 'node:fs';
import sharp from 'sharp';

const label = (t: string, w: number): Buffer => Buffer.from(`<svg width="${w}" height="22"><rect width="${w}" height="22" fill="#000" fill-opacity="0.55"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${t.replace(/&/g, '&amp;')}</text></svg>`);
async function tile(file: string, text: string, left: number, top: number, w: number, h: number) {
  const img = await sharp(`.weave/shots/${file}.png`).resize(w, h, { fit: 'cover' }).toBuffer();
  return { input: await sharp(img).composite([{ input: label(text, w), top: h - 22, left: 0 }]).toBuffer(), left, top };
}
async function save(name: string, base: ReturnType<typeof sharp>): Promise<void> {
  for (const q of [80, 70, 60, 50, 40, 30]) {
    await base.clone().webp({ quality: q }).toFile(`docs/img/${name}.webp`);
    const kb = statSync(`docs/img/${name}.webp`).size / 1024;
    console.log(`${name}.webp q${q} ${kb.toFixed(0)} kB`);
    if (kb <= 390) break;
  }
}
async function grid(name: string, items: Array<[string, string]>, cols: number, w: number, h: number): Promise<void> {
  const rows = Math.ceil(items.length / cols);
  const tiles = await Promise.all(items.map(([l, f], i) => tile(f, l, (i % cols) * w, Math.floor(i / cols) * h, w, h)));
  await save(name, sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#222' } }).composite(tiles));
}
async function pairs(name: string, ps: Array<[string, string, string]>, w = 420, h = 262): Promise<void> {
  const tiles = (await Promise.all(ps.flatMap(([l, bf, af], r) => [tile(bf, `before: ${l}`, 0, r * h, w, h), tile(af, `after: ${l}`, w, r * h, w, h)]))).flat();
  await save(name, sharp({ create: { width: 2 * w, height: ps.length * h, channels: 3, background: '#222' } }).composite(tiles));
}
const bld = Array.from({ length: 18 }, (_, i): [string, string] => { const n = `bld-${String(i).padStart(2, '0')}`; return [n, `m8-after-g-${n}`]; });
await grid('graphics-m8g-sweep-buildings', bld, 4, 400, 250);
await grid('graphics-m8g-sweep-lifts-vehicles', [['lift-rows0', 'm8-after-g-lift-rows0'], ['lift-rows1', 'm8-after-g-lift-rows1'], ['lift-rows2', 'm8-after-g-lift-rows2'], ['starter lifts close', 'm8-after-g-lifts-starter-close'], ['snowcat / village', 'm8-after-g-vehicles-snowcat'], ['helipad / rink', 'm8-after-g-vehicles-helipad'], ['train / station', 'm8-after-g-vehicles-train'], ['lodge row', 'm8-after-g-vehicles-demo-lodge']], 2, 560, 350);
await grid('graphics-m8g-sweep-nature', [['trees winter close', 'm8-after-g-trees-winter-close'], ['trees summer close', 'm8-after-g-trees-summer-close'], ['guests winter lineup', 'm8-after-g-guests-winter-lineup'], ['guests slope', 'm8-after-g-guests-slope-iso'], ['farm: cows + barn', 'm8-after-g-farm-cow-farm'], ['farm: goats + sheep', 'm8-after-g-farm-goat-farm'], ['walk: forest (near trees)', 'm8-after-g-gnd2-walk-forest'], ['walk: base (near buildings)', 'm8-after-g-gnd2-walk-lodge'], ['ride: skier', 'm8-after-g-gnd2-ride'], ['ride: chairlift', 'm8-after-g-gnd2-lift']], 2, 560, 350);
await pairs('graphics-m8g-water', [
  ['lake bed (seed 5)', 'm8-before-g-lake', 'm8-final-g-lake'],
  ['concave / convex lake (seed 7)', 'm8-before-g-lake7', 'm8-final-g-lake7'],
  ['river (close-up, trees hidden)', 'm8-before-g-river', 'm8-final-g-river'],
  ['river (default iso view)', 'm8-after-g-water-river-summer', 'm8-final-g-water-river-summer'],
  ['river ice (winter)', 'm8-after-g-water-river-winter-ice', 'm8-final-g-water-river-winter-ice'],
]);
await pairs('graphics-m8g-fixes', [
  ['Small Hydro penstock', 'm8-g-close-smallHydro', 'm8-final-g-smallHydro'],
  ['Tackle Hut roof / shutters', 'm8-g-close-tackleHut', 'm8-final-g-tackleHut'],
  ['Kids Ground mound', 'm8-after-e-f-kidsGround', 'm8-final-g-kidsGround'],
  ['Ice Rink surface', 'm8-after-g-c-iceRink', 'm8-final-g-iceRink'],
  ['Altiport plane', 'm8-after-g-plane-altiport', 'm8-final-g2-altiport'],
]);
