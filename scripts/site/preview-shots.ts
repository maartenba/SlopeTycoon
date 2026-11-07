/** `npm run site:preview-shots [-- --out dir]`: screenshots of the BUILT website (desktop 1440x900 / 1920x1080, mobile 390x844) for visual review. Serves dist-site under /slopetycoon/. */
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { launch } from '../lib/harness';
import { createPagesServer } from '../lib/static-server';

const oi = process.argv.indexOf('--out'); const out = oi >= 0 ? process.argv[oi + 1]! : '.weave/shots';
mkdirSync(out, { recursive: true });
const pi = process.argv.indexOf('--prefix'); const prefix = pi >= 0 ? process.argv[pi + 1]! : 'site-';
const server = createPagesServer('dist-site', '/slopetycoon/'); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slopetycoon/`;
const br = await launch();
const jobs: Array<{ name: string; path: string; w: number; h: number; full: boolean; sel?: string }> = [
  { name: 'landing-1440', path: '', w: 1440, h: 900, full: false },
  { name: 'landing-1920', path: '', w: 1920, h: 1080, full: false },
  { name: 'landing-full-1440', path: '', w: 1440, h: 900, full: true },
  ...['what', 'seasons', 'gallery', 'faq'].map((id) => ({ name: `landing-${id}`, path: '', w: 1440, h: 900, full: false, sel: `#${id}` })),
  { name: 'landing-mobile', path: '', w: 390, h: 844, full: false },
  { name: 'landing-mobile-modes', path: '', w: 390, h: 844, full: false, sel: '#modes' },
  { name: 'ski-resort-tycoon-1440', path: 'ski-resort-tycoon/', w: 1440, h: 900, full: false },
  { name: 'ski-resort-tycoon-full-1440', path: 'ski-resort-tycoon/', w: 1440, h: 900, full: true },
  { name: 'play-ski-games-online-1440', path: 'play-ski-games-online/', w: 1440, h: 900, full: true },
  { name: 'play-ski-games-online-mobile', path: 'play-ski-games-online/', w: 390, h: 844, full: false },
  { name: 'build-a-ski-resort-1440', path: 'build-a-ski-resort/', w: 1440, h: 900, full: true },
  { name: 'build-a-ski-resort-mobile', path: 'build-a-ski-resort/', w: 390, h: 844, full: false },
  { name: 'how-ski-lifts-work-1440', path: 'how-ski-lifts-work/', w: 1440, h: 900, full: false },
  { name: 'devlog-1440', path: 'devlog/', w: 1440, h: 900, full: false },
  { name: 'devlog-post-1440', path: 'devlog/0-2-7/', w: 1440, h: 900, full: false },
  { name: 'devlog-post-1024', path: 'devlog/0-2-7/', w: 1024, h: 768, full: false },
  { name: 'ski-resort-tycoon-1024', path: 'ski-resort-tycoon/', w: 1024, h: 768, full: false },
  { name: 'landing-1024', path: '', w: 1024, h: 768, full: false },
  { name: 'ski-resort-tycoon-mobile', path: 'ski-resort-tycoon/', w: 390, h: 844, full: false },
  { name: 'devlog-post-mobile', path: 'devlog/0-2-7/', w: 390, h: 844, full: false },
  { name: 'guide-index-1440', path: 'guide/', w: 1440, h: 900, full: false },
  { name: 'guide-building-1440', path: 'guide/building/', w: 1440, h: 900, full: false },
  { name: 'guide-shortcuts-1440', path: 'guide/shortcuts/', w: 1440, h: 900, full: false },
  { name: 'guide-career-full', path: 'guide/career/', w: 1440, h: 900, full: true },
  { name: 'landing-about', path: '', w: 1440, h: 900, full: false, sel: '#about' },
  { name: 'about-1440', path: 'about/', w: 1440, h: 900, full: false },
  { name: 'about-mobile', path: 'about/', w: 390, h: 844, full: false },
  { name: 'support-1440', path: 'support/', w: 1440, h: 900, full: false },
  { name: 'support-mobile', path: 'support/', w: 390, h: 844, full: false },
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
    if (j.full) await page.evaluate(async () => { document.querySelectorAll('img[loading=lazy]').forEach((i) => ((i as HTMLImageElement).loading = 'eager')); for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); await Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = () => r(1); })))); });
    if (j.sel) { await page.evaluate(async (q) => { document.querySelectorAll('img[loading=lazy]').forEach((i) => ((i as HTMLImageElement).loading = 'eager')); document.querySelector(q)?.scrollIntoView(); await new Promise((r) => setTimeout(r, 900)); }, j.sel); }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${out}/${prefix}${j.name}.png`, fullPage: j.full });
    console.log(`${j.name}: horizontal overflow ${overflow}px${bad.length ? `, problems: ${bad.join(' | ')}` : ''}`);
    await page.close();
  }
} finally { await br.close(); server.close(); }
