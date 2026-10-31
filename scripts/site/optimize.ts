/** PNG -> responsive WebP (640 / 1280 wide) into site/assets/shots/ + index.json (dimensions for width/height attrs). sharp first; Chrome canvas fallback. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShotInfo } from './md';

export const SHOTS_DIR = 'site/assets/shots';
export const INDEX_FILE = join(SHOTS_DIR, 'index.json');
export const WIDTHS = [640, 1280] as const;
export const MAX_BYTES_1280 = 58 * 1024; // the site budget is 8 MiB of screenshots in total (scripts/site/crawl.ts): the 1280 px files over 58 kB (M6.5 STOP: was 70) are re-encoded at a lower quality
export const MAX_BYTES_640 = 30 * 1024; // and the 640 px files over 30 kB

export interface IndexEntry { w: number; h: number; files: { w: number; file: string; bytes: number }[] }
export type ShotIndex = Record<string, IndexEntry>;
export const readIndex = (): ShotIndex => (existsSync(INDEX_FILE) ? (JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as ShotIndex) : {});

type Encoder = (png: Buffer, width: number, quality: number) => Promise<{ data: Buffer; w: number; h: number }>;

async function sharpEncoder(): Promise<Encoder | null> {
  try {
    const sharp = (await import('sharp')).default;
    return async (png, width, quality) => {
      const { data, info } = await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
  } catch { return null; }
}
/** Fallback when sharp cannot be installed: re-encode in headless Chrome (canvas.toBlob webp). */
async function chromeEncoder(): Promise<{ enc: Encoder; close: () => Promise<void> }> {
  const { launch } = await import('../lib/harness');
  const br = await launch(); const page = await br.newPage();
  const enc: Encoder = async (png, width, quality) => {
    const r = await page.evaluate(async (b64, w, q) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const sw = Math.min(w, img.naturalWidth), sh = Math.round(img.naturalHeight * sw / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d')!.drawImage(img, 0, 0, sw, sh);
      const blob: Blob = await new Promise((res) => c.toBlob((x) => res(x!), 'image/webp', q / 100));
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x);
      return { b64: btoa(s), w: sw, h: sh };
    }, png.toString('base64'), width, quality);
    return { data: Buffer.from(r.b64, 'base64'), w: r.w, h: r.h };
  };
  return { enc, close: async () => { await br.close(); } };
}

export async function optimizeAll(items: { id: string; png: string }[]): Promise<ShotIndex> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  let enc = await sharpEncoder(); let close = async (): Promise<void> => {};
  if (!enc) { console.warn('[site] sharp unavailable: falling back to Chrome WebP encoding'); const c = await chromeEncoder(); enc = c.enc; close = c.close; }
  const index = readIndex();
  try {
    for (const it of items) {
      const png = readFileSync(it.png); const entry: IndexEntry = { w: 0, h: 0, files: [] };
      for (const width of WIDTHS) {
        let q = 80, out = await enc(png, width, q);
        while (out.data.length > (width === 1280 ? MAX_BYTES_1280 : MAX_BYTES_640) && q > 50) { q -= 8; out = await enc(png, width, q); }
        const file = `${it.id}-${width}.webp`; writeFileSync(join(SHOTS_DIR, file), out.data);
        entry.files.push({ w: out.w, file, bytes: out.data.length }); if (width === 1280) { entry.w = out.w; entry.h = out.h; }
      }
      index[it.id] = entry;
      console.log(`[site] ${it.id}: ${entry.files.map((f) => `${f.w}px ${(f.bytes / 1024).toFixed(0)} kB`).join(', ')}`);
    }
  } finally { await close(); }
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 1) + '\n');
  return index;
}
export const shotInfo = (m: { id: string; alt: string; caption?: string }, idx: ShotIndex): ShotInfo | null => {
  const e = idx[m.id]; return e ? { id: m.id, alt: m.alt, caption: m.caption, w: e.w, h: e.h, files: e.files.map((f) => ({ w: f.w, file: f.file })) } : null;
};
