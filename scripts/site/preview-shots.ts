/** `npm run site:preview-shots [-- --out dir]`: screenshots of the BUILT website (desktop 1440x900 / 1920x1080, mobile 390x844) for visual review. Serves dist-site under /slopetycoon/. */
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { launch } from '../lib/harness';
import { createPagesServer } from '../lib/static-server';

const oi = process.argv.indexOf('--out'); const out = oi >= 0 ? process.argv[oi + 1]! : '.weave/shots';
mkdirSync(out, { recursive: true });
const server = createPagesServer('dist-site', '/slopetycoon/'); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slopetycoon/`;
const br = await launch();
const jobs: Array<{ name: string; path: string; w: number; h: number; full: boolean; sel?: string }> = [
  { name: 'landing-1440', path: '', w: 1440, h: 900, full: false },
  { name: 'landing-1920', path: '', w: 1920, h: 1080, full: false },
  { name: 'landing-full-1440', path: '', w: 1440, h: 900, full: true },
  ...['what', 'unique', 'seasons', 'lifts', 'guests', 'modes', 'career', 'gallery', 'faq'].map((id) => ({ name: `landing-${id}`, path: '', w: 1440, h: 900, full: false, sel: `#${id}` })),
  { name: 'landing-mobile', path: '', w: 390, h: 844, full: false },
  { name: 'landing-mobile-modes', path: '', w: 390, h: 844, full: false, sel: '#modes' },
  { name: 'guide-index-1440', path: 'guide/', w: 1440, h: 900, full: false },
  { name: 'guide-building-1440', path: 'guide/building/', w: 1440, h: 900, full: false },
  { name: 'guide-shortcuts-1440', path: 'guide/shortcuts/', w: 1440, h: 900, full: false },
  { name: 'guide-career-full', path: 'guide/career/', w: 1440, h: 900, full: true },
  { name: 'landing-about', path: '', w: 1440, h: 900, full: false, sel: '#about' },
  { name: 'about-1440', path: 'about/', w: 1440, h: 900, full: false },
  { name: 'about-mobile', path: 'about/', w: 390, h: 844, full: false },
  { name: 'privacy-1440', path: 'privacy/', w: 1440, h: 900, full: false },
  { name: 'privacy-mobile', path: 'privacy/', w: 390, h: 844, full: false },
  { name: 'guide-mobile', path: 'guide/guests-seasons/', w: 390, h: 844, full: false },
];
try {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',') : null;
  for (const j of jobs.filter((x) => !only || only.includes(x.name))) {
    const page = await br.newPage(); await page.setViewport({ width: j.w, height: j.h, deviceScaleFactor: 1 });
    const bad: string[] = []; page.on('requestfailed', (r) => bad.push(r.url())); page.on('pageerror', (e) => bad.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') bad.push(m.text()); });
    await page.goto(base + j.path, { waitUntil: 'networkidle0' });
    if (j.full) await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    if (j.sel) { await page.evaluate(async (q) => { document.querySelectorAll('img[loading=lazy]').forEach((i) => ((i as HTMLImageElement).loading = 'eager')); document.querySelector(q)?.scrollIntoView(); await new Promise((r) => setTimeout(r, 900)); }, j.sel); }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${out}/site-${j.name}.png`, fullPage: j.full });
    console.log(`${j.name}: horizontal overflow ${overflow}px${bad.length ? `, problems: ${bad.join(' | ')}` : ''}`);
    await page.close();
  }
} finally { await br.close(); server.close(); }
