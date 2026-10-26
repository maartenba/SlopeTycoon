/** Icon generation. Usage: `npm run gen:icons` (always) / `--if-missing` (prebuild: only when absent).
 * favicon.svg + the PNG icons all come from ONE source: `markGeometry` / `logoSvg({variant:'mark'})` (src/ui/logo.ts).
 * PNGs are rasterised with the installed Chrome via puppeteer-core (exact SVG rendering); without Chrome the old procedural drawing (scripts/lib/png.ts) is the fallback. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, renderLogo } from './lib/png';
import { logoSvg } from '../src/ui/logo';

export const ICONS: Array<{ file: string; size: number; maskable?: boolean; rounded?: boolean }> = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180 },
];
export const FAVICON_SVG = logoSvg({ variant: 'mark' }).replace(/ class="[^"]*"| style="[^"]*"/g, '').replace(/lg\d+/g, 'sp') + '\n';

const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];

/** Rasterise the mark with headless Chrome; null when unavailable. Maskable = full-bleed tile with the mark inside the 80 % safe zone; 'any' = rounded tile; apple = full square. */
async function rasterise(): Promise<Map<string, Uint8Array> | null> {
  const exe = CHROMES.find((c) => existsSync(c));
  if (!exe) return null;
  try {
    const { default: puppeteer } = await import('puppeteer-core');
    const br = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
    const out = new Map<string, Uint8Array>();
    try {
      for (const i of ICONS) {
        const page = await br.newPage();
        await page.setViewport({ width: i.size, height: i.size, deviceScaleFactor: 1 });
        const svg = logoSvg({ variant: 'mark', height: i.maskable ? '80%' : '100%' });
        const bg = i.maskable || !i.rounded ? 'linear-gradient(#4f86c6,#1d3b6e)' : 'transparent';
        await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${bg};display:flex;align-items:center;justify-content:center}svg{display:block}</style>${svg}`);
        const buf = await page.screenshot({ type: 'png', omitBackground: i.rounded === true });
        out.set(i.file, new Uint8Array(buf));
        await page.close();
      }
    } finally { await br.close(); }
    return out;
  } catch (e) { console.warn('[gen-icons] Chrome rasterisation failed, using the procedural fallback:', (e as Error).message); return null; }
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const names = [...ICONS.map((i) => i.file), 'favicon.svg'];
if (process.argv.includes('--if-missing') && names.every((n) => existsSync(join(dir, n)))) {
  console.log('[gen-icons] icons present, skipping');
} else {
  mkdirSync(dir, { recursive: true });
  const r = await rasterise();
  for (const i of ICONS) writeFileSync(join(dir, i.file), r?.get(i.file) ?? encodePng(i.size, i.size, renderLogo(i.size, i)));
  writeFileSync(join(dir, 'favicon.svg'), FAVICON_SVG);
  console.log(`[gen-icons] wrote ${names.length} files to ${dir} (${r ? 'rasterised with Chrome' : 'procedural fallback'})`);
}
