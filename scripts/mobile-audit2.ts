/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Mobile UI audit v2 (docs/mobile-ui-v2.md): REAL-PHONE conditions. Unlike scripts/mobile-audit.ts (390x844, no browser chrome, DPR 1, only the union of painted pixels),
 * this boots the game with isMobile/hasTouch at real device sizes and device pixel ratios, subtracts the browser chrome (Android Chrome ~104 px = 56 top bar + 48 nav bar,
 * iOS Safari ~130 px = 47 status + 83 toolbar) so the page sees the real INNER height, and measures per state:
 *   - every floating (painted) UI box: component path, DOM rect, z-index, pointer-events
 *   - overlaps: rect intersections between boxes of DIFFERENT components (area in px^2)
 *   - map-visible % (canvas not painted over by UI)
 *   - tap targets < 44 px (buttons / links / inputs, through shadow roots)
 *   - top chrome height (the contiguous stack of UI starting at y = 0)
 *   npx vite-node scripts/mobile-audit2.ts [--dev 412,360,390,land] [--states a,b] [--date YYYY-MM-DD] [--shots 0|1|all]
 *                     [--overlaps N]  FAIL (exit 1) when two floating panels intersect by more than N px^2 (default off; not wired into the gate yet)
 *                     [--thresholds 1] FAIL on map-visible < 60 % (default states) / 50 % (tool states) at 360x696, a tap target < 44 px, top chrome > 64 px
 * Output: .weave/mobile-audit/<date>/report.json, report.md, shots mob2-<device>-<eff|full>-<state>.png in .weave/shots. */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'puppeteer-core';
import { launch, startServer } from './lib/harness';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const DATE = opt('date') ?? new Date().toISOString().slice(0, 10);
const SHOTS = opt('shots') ?? '1';
const OVERLAP_N = opt('overlaps') !== undefined ? Number(opt('overlaps') || 400) : null;
const THRESH = !!opt('thresholds');
const ONLY = opt('states')?.split(',');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Device { id: string; name: string; w: number; fullH: number; chrome: number; dpr: number }
const DEVICES: Device[] = [
  { id: '412', name: 'Pixel-class Android 412x915 (chrome 104)', w: 412, fullH: 915, chrome: 104, dpr: 2.6 },
  { id: '360', name: 'Small Android 360x800 (chrome 104)', w: 360, fullH: 800, chrome: 104, dpr: 3 },
  { id: '390', name: 'iPhone 13/14 390x844 (chrome 130)', w: 390, fullH: 844, chrome: 130, dpr: 3 },
  { id: 'moto-g7', name: 'Motorola G7 412x866 (owner phone; Chrome 56 top + 48 nav = 104)', w: 412, fullH: 866, chrome: 104, dpr: 2.625 },
  { id: 'land', name: 'Android landscape 915x412', w: 915, fullH: 412, chrome: 0, dpr: 2.6 },
];
const WANT = (opt('dev') ?? '412,360,390,moto-g7,land').split(',');

/** Runs in the page. Returns floating boxes, overlaps, map-visible %, small tap targets and the top stack height. */
const MEASURE = `(() => {
  const W = innerWidth, H = innerHeight, ui = document.getElementById('ui');
  const boxes = [], targets = [];
  const painted = (cs) => { const m = /rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor); const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0; return a >= 0.25 || (cs.backgroundImage && cs.backgroundImage !== 'none'); };
  const zOf = (e) => { for (let n = e; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) { const z = getComputedStyle(n).zIndex; if (z && z !== 'auto') return +z; if (n === ui) break; } return 0; };
  const name = (e) => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : ''));
  const label = (e) => ((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title'))) || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28);
  const hiddenEl = (e, cs) => cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || e.hidden;
  const isInter = (e) => e.tagName === 'BUTTON' || e.tagName === 'A' || e.tagName === 'INPUT' || e.getAttribute('role') === 'button' || e.getAttribute('role') === 'tab';
  const addTarget = (grp, e, cs, r) => { if (isInter(e) && r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W && cs.pointerEvents !== 'none') { let tw = r.width, th = r.height; if (e.tagName === 'INPUT' && /checkbox|radio/.test(e.type)) { const b = getComputedStyle(e, '::before'); tw = Math.max(tw, parseFloat(b.width) || 0); th = Math.max(th, parseFloat(b.height) || 0); } /* the kit grows a checkbox / toggle hit area through an invisible ::before */ targets.push({ grp, el: name(e), label: label(e), w: +tw.toFixed(1), h: +th.toFixed(1), x: Math.round(r.left), y: Math.round(r.top) }); } };
  const walkT = (n, grp) => { for (const k of (n.shadowRoot ? Array.from(n.shadowRoot.children) : []).concat(Array.from(n.children))) { if (!(k instanceof Element) || k.tagName === 'STYLE') continue; const kc = getComputedStyle(k); if (hiddenEl(k, kc)) continue; addTarget(grp, k, kc, k.getBoundingClientRect()); walkT(k, grp); } };
  const visit = (e, grp) => {
    if (!(e instanceof Element)) return;
    const tag = e.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT') return;
    if (tag === 'SLOT') { for (const k of e.assignedElements()) visit(k, grp); return; }
    const cs = getComputedStyle(e);
    if (hiddenEl(e, cs)) return;
    const r = e.getBoundingClientRect();
    const own = r.width > 2 && r.height > 2;
    const big = own && r.width * r.height > 0.85 * W * H;
    addTarget(grp, e, cs, r);
    if (own && !big && (painted(cs) || tag === 'CANVAS' || tag === 'IMG' || tag === 'SVG')) {
      const x1 = Math.max(0, r.left), y1 = Math.max(0, r.top), x2 = Math.min(W, r.right), y2 = Math.min(H, r.bottom);
      if (x2 > x1 && y2 > y1) boxes.push({ grp, el: name(e), x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), z: zOf(e), pe: cs.pointerEvents });
      walkT(e, grp); // painted: its children are inside it; still collect tap targets
      return;
    }
    const kids = e.shadowRoot ? Array.from(e.shadowRoot.children) : [];
    for (const k of kids) visit(k, e.tagName.toLowerCase() + '>' + name(k));
    for (const k of Array.from(e.children)) if (!k.assignedSlot) visit(k, grp);
  };
  for (const c of Array.from(ui.children)) {
    if (c.id === 'right-col') { for (const k of Array.from(c.children)) visit(k, 'right-col>' + name(k)); continue; }
    visit(c, name(c));
  }
  const gt = document.getElementById('ghost-tip'); if (gt) visit(gt, 'ghost-tip'); // the placement tooltip lives in <body>, outside #ui
  const seen = new Set(); const tg = targets.filter((t) => { const k = t.grp + t.el + t.x + ',' + t.y; if (seen.has(k)) return false; seen.add(k); return true; });
  const S = 4, cols = Math.ceil(W / S), rows = Math.ceil(H / S), grid = new Uint8Array(cols * rows);
  for (const b of boxes) for (let y = Math.floor(b.y1 / S); y < Math.ceil(b.y2 / S); y++) for (let x = Math.floor(b.x1 / S); x < Math.ceil(b.x2 / S); x++) grid[y * cols + x] = 1;
  let cov = 0; for (const v of grid) cov += v;
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]; if (a.grp === b.grp) continue;
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w > 0 && h > 0) overlaps.push({ a: a.grp + ' ' + a.el, b: b.grp + ' ' + b.el, area: w * h, w, h });
  }
  // the TOP ROW only: the banner row (goal / scenario chip, Rudi, news), the toast pill and the profile card are separate cards under it (docs/mobile-ui-v2.md 3.2)
  const sorted = boxes.filter((b) => b.y1 < 140 && !/st-(goals|scenario-card|assistant|news|toast|profile|touch-controls)/.test(b.grp)).sort((p, q) => p.y1 - q.y1); let top = 0;
  for (const b of sorted) { if (b.y1 <= top + 12) top = Math.max(top, b.y2); else break; }
  return { W, H, dpr: devicePixelRatio, visible: +(100 * (1 - cov / (cols * rows))).toFixed(1), topChrome: top, boxes, overlaps, small: tg.filter((t) => t.w < 44 || t.h < 44), targetCount: tg.length };
})()`;

const D = `const D=document,dock=D.querySelector('st-dock'),q=(t)=>D.querySelector(t),sl=(ms)=>new Promise(r=>setTimeout(r,ms));`;
const CLOSE_ALL = `(async()=>{ ${D} try{ __slope.tools.reset(); __slope.touch?.toolChanged?.(); }catch{} dock.show(null); for (const t of ['st-settings','st-stats','st-help','st-pause-menu','st-whats-new']) { const e=q(t); try{ e&&e.close&&e.close(); }catch{} } try{ __slope.yearReport.el.close() }catch{}; window.__init=window.__init||{}; for (const t of ['st-news','st-goals']) { const b=q(t)?.shadowRoot?.querySelector('[aria-expanded]'); if (!b) continue; if (window.__init[t]===undefined) window.__init[t]=b.getAttribute('aria-expanded')==='true'; if ((b.getAttribute('aria-expanded')==='true')!==window.__init[t]) b.click(); } const a=q('st-assistant'); a&&a.toggleAdvice&&a.toggleAdvice(false); __slope.select(null); try{ q('st-profile').show(null) }catch{} })()`;

type Boot = 'career' | 'scen';
interface State { id: string; boot: Boot; kind: 'default' | 'tool' | 'modal'; setup: string; act?: (p: Page, dev: Device, h: number) => Promise<string | void>; note?: string }

/** Project world (tile corner x, z) to CSS px. */
const projectJs = (x: number, z: number): string => `(()=>{const s=__slope;const g=s.grid;const h=g.getCorner(Math.max(0,Math.min(g.size,Math.round(${x}))),Math.max(0,Math.min(g.size,Math.round(${z}))))*0.5;const v=s.renderer.camera.position.clone().set(${x},h,${z}).project(s.renderer.camera);const r=s.renderer.webgl.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};})()`;

const OWNER_ERR = 'Chairlift (6-seat, high-speed): Top station must be higher than bottom. No lift kind fits this exact line, try another spot. [50 m \u00b7 drop 0 m \u00b7 avg 0% / max 95%] Not connected: bottom station needs footpath access';

/** Finds a bottom/top tile pair near the map centre: flat (invalid for a lift) or climbing (valid). */
const FIND_PAIR = (flat: boolean): string => `(()=>{const g=__slope.grid,n=g.size;const H=(x,z)=>g.getCorner(x,z)*0.5;let best=null;for(let z=Math.round(n*.3);z<n*.7;z+=2)for(let x=Math.round(n*.3);x<n*.7;x+=2)for(const [dx,dz] of [[9,0],[0,9],[7,7],[-7,7]]){const x2=x+dx,z2=z+dz;if(x2<4||z2<4||x2>n-4||z2>n-4)continue;const dh=H(x2,z2)-H(x,z);const score=${flat} ? Math.abs(dh) : Math.abs(dh-5)+ (dh<0?50:0);if(!best||score<best.score)best={score,bx:x,bz:z,tx:x2,tz:z2,dh};}return best})()`;

async function aimLift(p: Page, downhill: boolean, h: number): Promise<string> {
  const pair = await p.evaluate(FIND_PAIR(false)) as { bx: number; bz: number; tx: number; tz: number; dh: number };
  await p.evaluate(`(()=>{const s=__slope;s.economy.state.money=9e6;const c=s.renderer.controls;c.target.set(${(pair.bx + pair.tx) / 2},0,${(pair.bz + pair.tz) / 2});c.zoom=1;c.zoomBy(${h < 500 ? 2.2 : 1.8});const g=s.touch.controller.gestures;g.cfg={...g.cfg,longPressMs:4000,tapMs:1500};})()`);
  await sleep(500);
  const M = await p.evaluate(projectJs((pair.bx + pair.tx) / 2, (pair.bz + pair.tz) / 2)) as { x: number; y: number };
  const vw = await p.evaluate('innerWidth') as number;
  await p.evaluate(`__slope.renderer.controls.panPixels(${Math.round(vw / 2 - M.x)}, ${Math.round(h * 0.5 - M.y)})`); await sleep(600);
  let B = await p.evaluate(projectJs(pair.bx, pair.bz)) as { x: number; y: number };
  let T = await p.evaluate(projectJs(pair.tx, pair.tz)) as { x: number; y: number };
  if (downhill) [B, T] = [T, B]; // bottom station on the high end: 'Top station must be higher than bottom'
  if ((await p.evaluate('__slope.tools.current')) !== 'lift') await p.evaluate(`__slope.liftTools.start('chair6')`);
  await sleep(400);
  const tap = async (x: number, y: number): Promise<void> => { await p.touchscreen.tap(Math.round(x), Math.round(y)); await sleep(250); };
  await tap(B.x, B.y); await tap(B.x + 3, B.y + 2); await tap(T.x, T.y); await sleep(500);
  const ok = await p.evaluate(`__slope.liftTools.tool.lastCheck?.ok`);
  return `dh ${pair.dh.toFixed(1)} B(${Math.round(B.x)},${Math.round(B.y)}) T(${Math.round(T.x)},${Math.round(T.y)}) ok=${ok} hint=${await p.evaluate(`__slope.liftTools.tool.touchHint()`)}`;
}

const firstCard = (dock: string): string => `${D} dock.show('${dock}'); await sl(600); const c=dock.shadowRoot.querySelector('.card:not(.locked)'); c&&c.click(); await sl(900)`;
const STATES: State[] = [
  { id: 'default', boot: 'career', kind: 'default', setup: '' },
  { id: 'goals-open', boot: 'career', kind: 'default', setup: `${D} const b=q('st-goals').shadowRoot.querySelector('[aria-expanded]'); if(b&&b.getAttribute('aria-expanded')!=='true') b.click()` },
  { id: 'scenario-default', boot: 'scen', kind: 'default', setup: '', note: 'Family Valley scenario card' },
  { id: 'rudi-advice', boot: 'career', kind: 'default', setup: `${D} const a=q('st-assistant'); a.toggleAdvice&&a.toggleAdvice(true)` },
  { id: 'news-open', boot: 'career', kind: 'default', setup: `${D} const n=q('st-news'); const b=n.shadowRoot.querySelector('[aria-expanded]'); if(b&&b.getAttribute('aria-expanded')!=='true') b.click()` },
  { id: 'toast', boot: 'career', kind: 'default', setup: `${D} const t=q('st-toast'); t.show('Snow is on the way: the lifts open at 08:00','info',9000); t.show('Not enough money for a Lodge','warn',9000)` },
  { id: 'inspector', boot: 'career', kind: 'default', setup: `${D} const b=__slope.buildings.all().find(x=>x.type==='baseLodge'); __slope.select(b.id)` },
  { id: 'building-placement', boot: 'career', kind: 'tool', setup: firstCard('buildings'), act: async (p, _d, h) => { await p.touchscreen.tap(200, Math.round(h * 0.45)); await sleep(500); } },
  { id: 'piste-painting', boot: 'career', kind: 'tool', setup: firstCard('pistes'), act: async (p, d, h) => { await p.touchscreen.tap(Math.round(d.w / 2), Math.round(h * 0.45)); await sleep(500); } },
  { id: 'lift-valid', boot: 'scen', kind: 'tool', setup: `${D} dock.show('lifts'); await sl(700); const cs=[...dock.shadowRoot.querySelectorAll('.card:not(.locked)')]; const c=cs.find(x=>/6-seat|chair6/i.test(x.textContent))||cs[0]; c&&c.click(); await sl(900)`, act: (p, _d, h) => aimLift(p, false, h), note: 'chairlift 6-seat, a climbing line' },
  { id: 'lift-invalid', boot: 'scen', kind: 'tool', setup: `${D} dock.show('lifts'); await sl(700); const cs=[...dock.shadowRoot.querySelectorAll('.card:not(.locked)')]; const c=cs.find(x=>/6-seat|chair6/i.test(x.textContent))||cs[0]; c&&c.click(); await sl(900)`, act: async (p, _d, h) => { const r = await aimLift(p, true, h); await p.evaluate(`document.querySelector('st-toast').show(${JSON.stringify(OWNER_ERR)},'error',600000)`); await sleep(400); return r; }, note: "the owner's case: top lower than bottom (not valid) + the long error toast text from the owner's screenshot" },
  { id: 'settings', boot: 'career', kind: 'modal', setup: `${D} q('st-settings').open()` },
  { id: 'year-report', boot: 'career', kind: 'modal', setup: `${D} __slope.jumpSimToDay(359, 9); for(let i=0;i<40;i++) __slope.loop.advance(1); __slope.yearReport&&__slope.yearReport.show(undefined,false)` },
];

async function boot(browser: any, base: string, dev: Device, kind: Boot): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewport({ width: dev.w, height: dev.fullH - dev.chrome, deviceScaleFactor: dev.dpr, hasTouch: true, isMobile: true });
  const qp = kind === 'scen' ? 'scenario=family-valley&hints=0&touch=1&touchhold=6000' : 'size=64&seed=61&start=winter&hints=0&touch=1&touchhold=6000';
  await page.goto(`${base}?${qp}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!(window as any).__slope?.view, { timeout: 120000 });
  await sleep(3000);
  return page;
}

interface Meas { W: number; H: number; dpr: number; visible: number; topChrome: number; boxes: any[]; overlaps: Array<{ a: string; b: string; area: number; w: number; h: number }>; small: any[]; targetCount: number }
interface Row { dev: string; height: 'eff' | 'full'; state: string; kind: string; note?: string; m: Meas }
const rows: Row[] = [];
mkdirSync('.weave/shots', { recursive: true });
const outDir = `.weave/mobile-audit/${DATE}`; mkdirSync(outDir, { recursive: true });
const srv = await startServer();
const br = await launch();
try {
  for (const id of WANT) {
    const dev = DEVICES.find((d) => d.id === id)!;
    const effH = dev.fullH - dev.chrome;
    console.log(`== ${dev.name}: inner ${dev.w}x${effH} (full ${dev.fullH}) dpr ${dev.dpr}`);
    for (const boottype of ['career', 'scen'] as Boot[]) {
      const list = STATES.filter((s) => s.boot === boottype && (!ONLY || ONLY.includes(s.id)));
      if (!list.length) continue;
      const page = await boot(br, srv.url, dev, boottype);
      for (const st of list) {
        try {
          for (const hh of (dev.chrome ? ['eff', 'full'] : ['eff']) as Array<'eff' | 'full'>) {
            const H = hh === 'eff' ? effH : dev.fullH;
            await page.setViewport({ width: dev.w, height: H, deviceScaleFactor: dev.dpr, hasTouch: true, isMobile: true });
            await sleep(500);
            await page.evaluate(CLOSE_ALL); await sleep(500);
            if (st.setup) await page.evaluate(`(async()=>{ ${st.setup} })()`);
            let info = '';
            if (st.act) info = (await st.act(page, dev, H)) ?? '';
            await sleep(900);
            const m = await page.evaluate(MEASURE) as Meas;
            if (SHOTS === 'all' || (SHOTS !== '0' && hh === 'eff')) await page.screenshot({ path: `.weave/shots/mob2-${dev.id}-${hh}-${st.id}.png` });
            rows.push({ dev: dev.id, height: hh, state: st.id, kind: st.kind, ...(info || st.note ? { note: [st.note, info].filter(Boolean).join(' | ') } : {}), m });
            const big = m.overlaps.filter((o) => o.area >= 400).length;
            console.log(`  ${dev.id}/${hh} ${st.id.padEnd(18)} map ${String(m.visible).padStart(5)}%  overlaps(>=400px2) ${big}  small-targets ${m.small.length}/${m.targetCount}  top ${m.topChrome}px ${info ? '  [' + info.slice(0, 90) + ']' : ''}`);
          }
        } catch (e) { console.log(`  ERR ${dev.id}/${st.id}: ${String(e).slice(0, 160)}`); }
      }
      await page.close();
    }
  }
} finally { try { await br.close(); } catch { /* gone */ } srv.stop(); }

writeFileSync(`${outDir}/report.json`, JSON.stringify({ date: DATE, devices: DEVICES.filter((d) => WANT.includes(d.id)), rows }, null, 1));
const md: string[] = [`# Mobile audit v2 (${DATE})`, '', 'Each cell: **map-visible %** / overlaps >= 400 px² (count, largest px²) / tap targets < 44 px / top chrome px.', ''];
const devs = WANT.map((i) => DEVICES.find((d) => d.id === i)!);
for (const hh of ['eff', 'full'] as const) {
  const cols = devs.filter((d) => hh === 'eff' || d.chrome);
  md.push(`## ${hh === 'eff' ? 'Effective inner height (browser chrome subtracted)' : 'Full height (no browser chrome, for comparison)'}`, '', `| State | ${cols.map((d) => `${d.id} ${d.w}x${hh === 'eff' ? d.fullH - d.chrome : d.fullH}`).join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  for (const sid of [...new Set(rows.map((r) => r.state))]) {
    md.push(`| ${sid} | ${cols.map((d) => { const r = rows.find((x) => x.dev === d.id && x.height === hh && x.state === sid); if (!r) return '-'; const ov = r.m.overlaps.filter((o) => o.area >= 400); return `**${r.m.visible.toFixed(0)} %** / ${ov.length}${ov.length ? ` (max ${Math.max(...ov.map((o) => o.area))})` : ''} / ${r.m.small.length} / ${r.m.topChrome}`; }).join(' | ')} |`);
  }
  md.push('');
}
md.push('## Overlaps at the effective height (>= 400 px²)', '');
for (const r of rows.filter((x) => x.height === 'eff')) { const ov = r.m.overlaps.filter((o) => o.area >= 400).sort((a, b) => b.area - a.area); if (ov.length) { md.push(`- **${r.dev} ${r.state}**: ` + ov.slice(0, 6).map((o) => `${o.a} x ${o.b} (${o.w}x${o.h}=${o.area})`).join('; ')); } }
md.push('', '## Small tap targets at the effective height (< 44 px, first 8 per state, 412 wide)', '');
for (const r of rows.filter((x) => x.height === 'eff' && x.dev === '412')) if (r.m.small.length) md.push(`- **${r.state}** (${r.m.small.length}): ` + r.m.small.slice(0, 8).map((t) => `${t.grp} ${t.el} "${t.label}" ${t.w}x${t.h}`).join('; '));
writeFileSync(`${outDir}/report.md`, md.join('\n') + '\n');
console.log('\n' + md.join('\n'));

let bad = 0;
for (const r of rows) {
  if (OVERLAP_N !== null) for (const o of r.m.overlaps) if (o.area > OVERLAP_N) { bad++; console.log(`FAIL overlap ${r.dev}/${r.height}/${r.state}: ${o.a} x ${o.b} = ${o.area} px²`); }
  if (THRESH && r.height === 'eff') {
    const min = r.kind === 'default' ? 60 : r.kind === 'tool' ? 50 : 0;
    if (r.dev !== 'land' && min && r.m.visible < min) { bad++; console.log(`FAIL map ${r.dev}/${r.state}: ${r.m.visible}% < ${min}%`); }
    if (r.kind !== 'modal') { if (r.m.small.length) { bad++; console.log(`FAIL targets ${r.dev}/${r.state}: ${r.m.small.length} below 44 px`); } if (r.m.topChrome > 64) { bad++; console.log(`FAIL top chrome ${r.dev}/${r.state}: ${r.m.topChrome}px > 64`); } }
  }
}
console.log(bad ? `${bad} failure(s)` : 'no failures checked');
process.exitCode = bad && (OVERLAP_N !== null || THRESH) ? 1 : 0;
