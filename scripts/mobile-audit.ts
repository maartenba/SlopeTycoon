/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Mobile UI audit (M7.5, docs/mobile-ui.md): boots the real game with touch emulation at 390x844, 844x390 and 768x1024, drives every panel / drawer / modal
 * into view and measures the MAP-VISIBLE share = the part of the viewport NOT painted over by UI (union of the painted boxes of everything inside #ui,
 * through shadow roots; elements covering > 85 % of the screen, i.e. modal scrims, are skipped and their children counted instead).
 *   npm run mobile:audit [-- --label baseline|after --vp phone,land,tablet --md docs/x.md --no-assert 1]
 * Asserts (exit 1): map visible >= 50 % in every DEFAULT state (default, goals open, Rudi tip, news open, toasts, inspector) and >= 40 % with a drawer at peek
 * and a tool active. Drawers / modals are reported only (a modal blocks the map by design). Shots: .weave/shots/m75-<label>-<vp>-<state>.png */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'puppeteer-core';
import { launch, startServer } from './lib/harness';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const LABEL = opt('label') ?? 'audit';
const NO_ASSERT = !!opt('no-assert') || LABEL === 'baseline';
const SHOTS = opt('shots') !== '0';
const VPS: Record<string, { w: number; h: number }> = { phone: { w: 390, h: 844 }, land: { w: 844, h: 390 }, tablet: { w: 768, h: 1024 } };
const WANT = (opt('vp') ?? 'phone,land,tablet').split(',');
const ONLY = opt('only')?.split(',');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: painted boxes of all UI + the covered share. */
const MEASURE = `(() => {
  const W = innerWidth, H = innerHeight, ui = document.getElementById('ui');
  const boxes = [];
  const painted = (cs) => { const m = /rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor); const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0; return a >= 0.25 || (cs.backgroundImage && cs.backgroundImage !== 'none'); };
  const visit = (e, host) => {
    if (!(e instanceof Element)) return;
    const tag = e.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'SLOT') { if (tag === 'SLOT') for (const k of e.assignedElements()) visit(k, host); return; }
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || e.hidden) return;
    const r = e.getBoundingClientRect();
    const own = r.width > 2 && r.height > 2;
    const big = own && r.width * r.height > 0.85 * W * H;
    if (own && !big && (painted(cs) || tag === 'CANVAS' || tag === 'IMG' || tag === 'SVG')) {
      const x1 = Math.max(0, r.left), y1 = Math.max(0, r.top), x2 = Math.min(W, r.right), y2 = Math.min(H, r.bottom);
      if (x2 > x1 && y2 > y1) boxes.push({ host, x1, y1, x2, y2 });
      return; // painted: its children are inside it
    }
    const kids = e.shadowRoot ? Array.from(e.shadowRoot.children) : [];
    for (const k of kids) visit(k, host);
    if (!e.shadowRoot || true) for (const k of Array.from(e.children)) if (!(k.assignedSlot)) visit(k, host);
  };
  for (const c of Array.from(ui.children)) {
    if (c.id === 'right-col') { for (const k of Array.from(c.children)) visit(k, 'right-col>' + k.tagName.toLowerCase() + (k.id ? '#' + k.id : '')); continue; }
    visit(c, c.tagName.toLowerCase());
  }
  const S = 4, cols = Math.ceil(W / S), rows = Math.ceil(H / S), grid = new Uint8Array(cols * rows);
  const mark = (list) => { for (const b of list) for (let y = Math.floor(b.y1 / S); y < Math.ceil(b.y2 / S); y++) for (let x = Math.floor(b.x1 / S); x < Math.ceil(b.x2 / S); x++) grid[y * cols + x] = 1; };
  mark(boxes);
  let cov = 0; for (const v of grid) cov += v;
  const per = {};
  const hosts = [...new Set(boxes.map((b) => b.host))];
  for (const h of hosts) { grid.fill(0); mark(boxes.filter((b) => b.host === h)); let n = 0; for (const v of grid) n += v; per[h] = +(100 * n / (cols * rows)).toFixed(1); }
  return { visible: +(100 * (1 - cov / (cols * rows))).toFixed(1), per };
})()`;

const D = `const D=document,dock=D.querySelector('st-dock'),q=(t)=>D.querySelector(t);`;
const CLOSE_ALL = `(async()=>{ ${D} dock.show(null); __slope.tools.reset?.(); __slope.touch?.toolChanged?.(); for (const t of ['st-settings','st-stats','st-help','st-pause-menu','st-whats-new']) { const e=q(t); try{ e&&e.close&&e.close(); }catch{} } try{ __slope.yearReport.el.close() }catch{}; window.__init=window.__init||{}; for (const t of ['st-news','st-goals']) { const b=q(t)?.shadowRoot?.querySelector('[aria-expanded]'); if (!b) continue; if (window.__init[t]===undefined) window.__init[t]=b.getAttribute('aria-expanded')==='true'; if ((b.getAttribute('aria-expanded')==='true')!==window.__init[t]) b.click(); } const a=q('st-assistant'); a&&a.toggleAdvice&&a.toggleAdvice(false); __slope.view&&0; __slope.select(null); })()`;

interface State { id: string; kind: 'default' | 'drawer' | 'peek' | 'modal' | 'bare'; setup: string; note?: string; tapMap?: boolean }
const drawer = (id: string): State => ({ id: `drawer-${id}`, kind: 'drawer', setup: `${D} dock.show('${id}')` });
const STATES: State[] = [
  { id: 'default', kind: 'default', setup: '' },
  { id: 'goals-open', kind: 'default', setup: `${D} const b=q('st-goals').shadowRoot.querySelector('[aria-expanded]'); if(b&&b.getAttribute('aria-expanded')!=='true') b.click()` },
  { id: 'rudi-tip', kind: 'default', setup: `${D} const a=q('st-assistant'); a.toggleAdvice&&a.toggleAdvice(true)` },
  { id: 'news-open', kind: 'default', setup: `${D} const n=q('st-news'); const b=n.shadowRoot.querySelector('[aria-expanded]'); if(b&&b.getAttribute('aria-expanded')!=='true') b.click()` },
  { id: 'toasts', kind: 'default', setup: `${D} const t=q('st-toast'); t.show('Snow is on the way: the lifts open at 08:00','info',4500); t.show('A guest left a review: lovely pistes','info',4500); t.show('Not enough money for a Lodge','warn',4500)` },
  { id: 'inspector', kind: 'default', setup: `${D} const b=__slope.buildings.all().find(x=>x.type==='baseLodge'); __slope.select(b.id)` },
  ...['buildings', 'lifts', 'paths', 'pistes', 'terrain', 'landscape', 'view', 'finance', 'ops', 'marketing', 'pricing'].map(drawer),
  { id: 'peek-building-tool', kind: 'peek', setup: `${D} dock.show('buildings'); await new Promise(r=>setTimeout(r,500)); const c=dock.shadowRoot.querySelector('.card:not(.locked)'); c&&c.click(); await new Promise(r=>setTimeout(r,900))` },
  { id: 'peek-lift-tool', kind: 'peek', setup: `${D} dock.show('lifts'); await new Promise(r=>setTimeout(r,500)); const c=dock.shadowRoot.querySelector('.card:not(.locked)'); c&&c.click(); await new Promise(r=>setTimeout(r,900))` },
  { id: 'peek-terrain-tool', kind: 'peek', tapMap: true, setup: `${D} dock.show('terrain'); await new Promise(r=>setTimeout(r,900))` },
  { id: 'settings', kind: 'modal', setup: `${D} q('st-settings').open()` },
  { id: 'statistics', kind: 'modal', setup: `${D} q('st-stats').open()` },
  { id: 'help', kind: 'modal', setup: `${D} q('st-help').open()` },
  { id: 'year-report', kind: 'modal', setup: `${D} __slope.jumpSimToDay(359, 9); for(let i=0;i<40;i++) __slope.loop.advance(1); const ok=(__slope.yearReport&&__slope.yearReport.show(undefined,false)); if(!ok){ window.__auditNote='no year report'; }` },
  { id: 'update-card', kind: 'modal', setup: `${D} q('st-whats-new').showUpdate({title:'Slope Tycoon 0.3.3 is ready',fallback:false,sections:[{version:'0.3.3',highlights:['Phones show the map: bottom sheets for every drawer','A compact one-row top bar','Cards that tuck away while you build']}]},{later(){},reload(){}})` },
];

async function boot(browser: any, base: string, w: number, h: number, bare: boolean): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const qp = new URLSearchParams(bare ? 'touch=1' : 'size=64&seed=61&start=winter&hints=0&touch=1&touchhold=6000');
  await page.goto(`${base}?${qp}`, { waitUntil: 'load', timeout: 90000 });
  if (!bare) await page.waitForFunction(() => !!(window as any).__slope?.view, { timeout: 90000 }); else await sleep(6000);
  await sleep(2500);
  return page;
}

interface Row { vp: string; id: string; kind: string; visible: number; per: Record<string, number>; note?: string }
const rows: Row[] = [];
mkdirSync('.weave/shots', { recursive: true }); mkdirSync('.weave/audit', { recursive: true });
const srv = await startServer();
const br = await launch();
try {
  for (const vp of WANT) {
    const { w, h } = VPS[vp]!;
    console.log(`== ${vp} ${w}x${h}`);
    // title screen: consent card
    if (!ONLY || ONLY.includes('title-consent')) {
      const tp = await boot(br, srv.url, w, h, true);
      const r = await tp.evaluate(MEASURE) as { visible: number; per: Record<string, number> };
      if (SHOTS) await tp.screenshot({ path: `.weave/shots/m75-${LABEL}-${vp}-title-consent.png` });
      rows.push({ vp, id: 'title-consent', kind: 'bare', ...r });
      console.log(`  ${String(r.visible).padStart(5)}%  title-consent (title screen + consent card)`);
      await tp.close();
    }
    const page = await boot(br, srv.url, w, h, false);
    for (const st of STATES) {
      if (ONLY && !ONLY.includes(st.id)) continue;
      try {
        await page.evaluate(CLOSE_ALL); await sleep(500);
        if (st.setup) await page.evaluate(`(async()=>{ ${st.setup} })()`);
        if (st.tapMap) { await sleep(400); await page.touchscreen.tap(Math.round(w * 0.5), Math.round(h * 0.42)); }
        await sleep(st.kind === 'peek' ? 1200 : 800);
        const note = await page.evaluate('window.__auditNote||null') as string | null;
        const r = await page.evaluate(MEASURE) as { visible: number; per: Record<string, number> };
        if (SHOTS) await page.screenshot({ path: `.weave/shots/m75-${LABEL}-${vp}-${st.id}.png` });
        rows.push({ vp, id: st.id, kind: st.kind, ...r, ...(note ? { note } : {}) });
        console.log(`  ${String(r.visible).padStart(5)}%  ${st.id}${note ? ' (' + note + ')' : ''}`);
        await page.evaluate('window.__auditNote=null');
      } catch (e) { console.log(`  ERR ${st.id}: ${String(e).slice(0, 120)}`); rows.push({ vp, id: st.id, kind: st.kind, visible: -1, per: {}, note: 'error' }); }
    }
    // per-panel share of the screen (default state)
    await page.evaluate(CLOSE_ALL); await sleep(600);
    await page.close();
  }
} finally { try { await br.close(); } catch { /* gone */ } srv.stop(); }

writeFileSync(`.weave/audit/${LABEL}.json`, JSON.stringify(rows, null, 1));
const md: string[] = [];
const ids = [...new Set(rows.map((r) => r.id))];
md.push(`| State | ${WANT.map((v) => `${v} ${VPS[v]!.w}x${VPS[v]!.h}`).join(' | ')} |`, `|---|${WANT.map(() => '---:').join('|')}|`);
for (const id of ids) md.push(`| ${id} | ${WANT.map((v) => { const r = rows.find((x) => x.vp === v && x.id === id); return r ? (r.visible < 0 ? 'err' : `${r.visible.toFixed(0)} %${r.note ? '*' : ''}`) : '-'; }).join(' | ')} |`);
md.push('', '**Default-state panel footprint (% of the screen each panel paints over):**', '');
const defRows = rows.filter((r) => r.id === 'default');
const hostSet = [...new Set(defRows.flatMap((r) => Object.keys(r.per)))];
md.push(`| Panel | ${WANT.join(' | ')} |`, `|---|${WANT.map(() => '---:').join('|')}|`);
for (const hn of hostSet) md.push(`| ${hn} | ${WANT.map((v) => { const r = defRows.find((x) => x.vp === v); return r?.per[hn] !== undefined ? `${r.per[hn]} %` : '-'; }).join(' | ')} |`);
const out = md.join('\n');
console.log('\n' + out);
writeFileSync(`.weave/audit/${LABEL}.md`, out + '\n');
if (opt('md')) writeFileSync(opt('md')!, out + '\n');

// acceptance
let bad = 0;
for (const r of rows) {
  const min = r.kind === 'default' ? 50 : r.kind === 'peek' ? 40 : 0;
  if (min && r.visible >= 0 && r.visible < min) { bad++; console.log(`FAIL ${r.vp}/${r.id}: map visible ${r.visible}% < ${min}%`); }
  if (r.visible < 0) bad++;
}
console.log(bad ? `${bad} acceptance failure(s)${NO_ASSERT ? ' (not asserted: baseline)' : ''}` : 'all acceptance thresholds met');
process.exitCode = bad && !NO_ASSERT ? 1 : 0;
