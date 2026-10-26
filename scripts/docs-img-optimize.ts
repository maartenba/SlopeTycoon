/** `npm run docs:img [-- --dry-run] [--quality 82] [--max-width 1920]`: re-encodes docs/img/*.png to WebP (max width 1920),
 * rewrites every `.png` reference to those files in markdown / site/shots.json / scripts, deletes the PNG, and keeps docs/img/manifest.json.
 * Idempotent: with no PNGs left it does nothing. Drop new raw captures in docs/img/raw/ (git-ignored) or .weave/shots/ and copy the keepers into docs/img/ as PNG, then run this. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : d; };
const dry = process.argv.includes('--dry-run');
const quality = Number(arg('quality', '82')), maxWidth = Number(arg('max-width', '1920'));
const DIR = 'docs/img', MANIFEST = join(DIR, 'manifest.json');
const kb = (n: number): string => `${(n / 1024).toFixed(0)} kB`;

const textFiles = (): string[] => {
  const out = ['README.md', 'CHANGELOG.md', 'site/README.md', 'site/shots.json'];
  for (const d of ['docs', 'site/guide', 'scripts']) if (existsSync(d)) for (const f of readdirSync(d)) if (/\.(md|ts|sh|js|json)$/.test(f)) out.push(join(d, f));
  return out.filter((f) => existsSync(f));
};

interface Entry { file: string; from: number; to: number; w: number; h: number; alpha: boolean }
const manifest: Record<string, Entry> = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Entry>) : {};
const pngs = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
let before = 0, after = 0; const done: string[] = [];
for (const f of pngs) {
  const src = join(DIR, f), name = f.replace(/\.png$/, '.webp'), dst = join(DIR, name);
  const input = readFileSync(src);
  const meta = await sharp(input).metadata();
  const buf = await sharp(input).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality, alphaQuality: 100, effort: 5 }).toBuffer({ resolveWithObject: true });
  before += input.length; after += buf.data.length;
  console.log(`${f}: ${kb(input.length)} -> ${name} ${kb(buf.data.length)} (${buf.info.width}x${buf.info.height})`);
  manifest[name] = { file: name, from: input.length, to: buf.data.length, w: buf.info.width, h: buf.info.height, alpha: !!meta.hasAlpha };
  if (!dry) { writeFileSync(dst, buf.data); unlinkSync(src); done.push(f); }
}
if (!dry && done.length) {
  for (const t of textFiles()) {
    let s = readFileSync(t, 'utf8'), changed = false;
    for (const f of done) { const re = new RegExp(`(?<![A-Za-z0-9_-])${f.replace(/[.]/g, '\\.')}`, 'g'); if (re.test(s)) { s = s.replace(re, f.replace(/\.png$/, '.webp')); changed = true; } }
    if (changed) writeFileSync(t, s);
  }
  mkdirSync(DIR, { recursive: true }); writeFileSync(MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`);
}
const total = readdirSync(DIR).reduce((a, f) => a + statSync(join(DIR, f)).size, 0);
console.log(`[docs:img] ${dry ? '(dry run) ' : ''}${pngs.length} PNG(s): ${kb(before)} -> ${kb(after)}; docs/img total now ${(total / 1048576).toFixed(1)} MB`);
