/* eslint-disable @typescript-eslint/no-explicit-any */
/* Recap / month-card visual QA (M5.1). npm run recap:shot -- --mode recap|month|newgame --out name [--w 1280 --h 800]
 * recap: play a starter resort ~1 month, quick-save, then reload with ?continue=1 and shoot (IndexedDB persists inside one browser launch). */
import { launch, startServer } from './lib/harness';
import { mkdirSync } from 'node:fs';

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith('--')) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[++i]! : '1';
const w = Number(a.w ?? 1280), h = Number(a.h ?? 800), mode = a.mode ?? 'recap', out = a.out ?? `recap-${mode}`;
const srv = await startServer(), br = await launch();
const logs: string[] = [];
const open = async (q: string) => {
  const page = await br.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`));
  await page.goto(`${srv.url}?${q}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  return page;
};
const advance = (page: Awaited<ReturnType<typeof open>>, untilMonth: boolean, n: number) => page.evaluate((u, ticks) => {
  const s = (window as any).__slope, loop = s.loop;
  if (loop.paused) loop.setSpeed(1);
  const n0 = s.economy.reports().length, target = loop.tickCount + ticks;
  while ((u ? s.economy.reports().length === n0 : loop.tickCount < target) && loop.tickCount < target + 40000) loop.advance(1);
}, untilMonth, n);
try {
  let page = await open('size=64&seed=61&start=winter&hints=0&starter=1');
  if (mode === 'month') {
    await advance(page, true, 12000);
  } else {
    await advance(page, false, 8800);
    await page.evaluate(async () => { await (window as any).__slope.saves.quickSave(); });
    await page.close();
    page = await open(mode === 'newgame' ? 'size=64&seed=61&start=winter&hints=0&starter=1' : 'continue=1&hints=0');
  }
  if (mode === 'recapfull') await page.evaluate(() => { const r = document.querySelector('st-recap') as any; r.dismiss(); r.showRecap({ title: 'Welcome back', subtitle: 'Winter · October, year 1', stars: 3.5, cash: '$4,160', trend: { text: 'Down half a star', tone: 'bad' }, change: { text: '-$1,864 this month', tone: 'bad' }, lastMonth: { text: 'September: -$3,295 net', tone: 'bad' }, goals: [{ text: 'Green, blue and red runs', pct: 33 }, { text: 'Welcome 80 guests in a day', pct: 43 }], advice: ['Improve variety', 'Next goal: Green, blue and red runs'], issues: ['1 lift is broken down', '2 incidents are still open'], reduced: false }); });
  await new Promise((r) => setTimeout(r, 2500));
  const info = await page.evaluate(() => { const r = document.querySelector('st-recap') as any; const c = r?.shadowRoot?.querySelector('.card'); const b = c?.getBoundingClientRect(); return { showing: r?.showing, mode: r?.currentMode, rect: b ? [b.left, b.top, b.width, b.height].map(Math.round) : null, text: c?.innerText }; });
  const ov = await page.evaluate(() => {
    const ui = document.getElementById('ui')!, card = (document.querySelector('st-recap') as any).shadowRoot.querySelector('.card').getBoundingClientRect();
    const hit: string[] = [];
    const test = (n: string, r: DOMRect) => { if (r.width > 2 && r.height > 2 && r.left < card.right && card.left < r.right && r.top < card.bottom && card.top < r.bottom) hit.push(`${n} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`); };
    for (const c of Array.from(ui.children)) {
      const t = c.tagName.toLowerCase(); if (t === 'st-recap' || t === 'st-toast' || t === 'st-spotlight') continue;
      if (t === 'div') { for (const k of Array.from(c.children)) test(`${c.id}>${k.tagName.toLowerCase()}`, k.getBoundingClientRect()); continue; }
      const kids = (c as HTMLElement).shadowRoot ? Array.from((c as HTMLElement).shadowRoot!.children).filter((e) => e.tagName !== 'STYLE' && !e.classList.contains('layer')) : [];
      if (!kids.length) test(t, c.getBoundingClientRect()); else for (const k of kids) test(t, k.getBoundingClientRect());
    }
    return hit.length ? 'OVERLAPS: ' + hit.join(' | ') : 'no overlaps';
  });
  console.log(`[overlap] ${w}x${h}: ${ov}`);
  console.log(JSON.stringify(info));
  mkdirSync('.weave/shots', { recursive: true });
  await page.screenshot({ path: `.weave/shots/${out}.png` });
} finally { await br.close(); srv.stop(); }
console.log(logs.slice(0, 15).join('\n') || 'no console errors/warnings');
