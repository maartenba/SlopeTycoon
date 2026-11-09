/* eslint-disable @typescript-eslint/no-explicit-any -- the manifest is plain JSON read at run time */
/** Storyboard contact sheet (M7.6, docs/promo-video.md): `npx vite-node scripts/promo/sheet.ts --tag fin` reads `promo/scenes.json` + the stills `.weave/promo/storyboard/<NN>-<id>-<a|b|c>-<tag>.png`,
 * writes `.weave/promo/storyboard/storyboard.html` (self-contained: relative `thumbs/*.jpg`, dark layout) and the two overview PNGs `storyboard-90s.png` / `storyboard-30s.png`. Needs ffmpeg for the thumbnails. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/harness';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const tag = arg('tag', 'fin'), DIR = '.weave/promo/storyboard';
const man = JSON.parse(readFileSync('promo/scenes.json', 'utf8')) as { scenes: any[]; music: any };
mkdirSync(`${DIR}/thumbs`, { recursive: true });
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (a: number, b: number): string => `${a}\u2013${b} s`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hh = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function stills(sc: any, keys?: string[]): Array<{ k: string; src: string; note: string }> {
  const out: Array<{ k: string; src: string; note: string }> = [];
  (keys ?? ['a', 'b', 'c', 'd']).forEach((k) => {
    const png = `${DIR}/${sc.n}-${sc.id}-${k}-${tag}.png`;
    if (!existsSync(png)) return;
    const jpg = `thumbs/${sc.n}-${sc.id}-${k}-${tag}.jpg`;
    if (!existsSync(`${DIR}/${jpg}`)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', 'scale=960:-1', '-q:v', '3', `${DIR}/${jpg}`]);
    const idx = 'abcd'.indexOf(k), ck = sc.camera?.keys?.[idx];
    const note = ck ? (ck.view && ck.view !== 'iso' ? `${ck.view} POV` : `iso \u00b7 ${ck.at} \u00b7 zoom ${ck.zoom} \u00b7 yaw ${ck.yaw ?? 0}\u00b0`) + (ck.t !== undefined ? ` \u00b7 t=${ck.t}` : '') + (ck.placeholder ? ` \u00b7 PLACEHOLDER for ${ck.placeholder}` : '') : '';
    out.push({ k, src: jpg, note });
  });
  return out;
}

function row(sc: any, cut: 'c90' | 'c30'): string {
  const range = sc.cuts[cut] as [number, number];
  const st = stills(sc, cut === 'c30' ? sc.cuts.c30Keys : undefined);
  const s = sc.start ?? {};
  const when = s.month !== undefined ? `${MONTHS[s.month]} ${s.dom} \u00b7 ${hh(s.hour)}` : '';
  const atm = sc.atmos ? Object.entries(sc.atmos).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  const wx = sc.weather ? `${sc.weather.kind}${sc.weather.wind !== undefined ? `, wind ${sc.weather.wind}` : ''}` : '';
  const cap = (cut === 'c30' && sc.captionC30) || sc.caption || '';
  return `<section class="scene"><div class="meta"><div class="no">${esc(sc.n)}</div><div class="rng">${fmt(range[0], range[1])}</div><h3>${esc(sc.title)}</h3>
    ${when ? `<p><b>Date</b> ${esc(when)} \u00b7 map ${sc.map?.size ?? ''}/seed ${sc.map?.seed ?? ''}</p>` : ''}${wx ? `<p><b>Weather</b> ${esc(wx)}</p>` : ''}${atm ? `<p><b>Atmosphere</b> ${esc(atm)}</p>` : ''}
    <p><b>Music</b> ${esc(sc.music ?? '')}</p>${sc.note ? `<p class="n">${esc(sc.note)}</p>` : ''}</div>
    <div class="stills">${st.map((x) => `<figure><img src="${x.src}" alt="${esc(sc.id)} ${x.k}"><figcaption><b>${x.k}</b> ${esc(x.note)}</figcaption></figure>`).join('')}</div>
    <div class="cap">${cap ? `\u201c${esc(cap)}\u201d` : '<span>no caption</span>'}</div></section>`;
}

const sorted = (cut: 'c90' | 'c30'): any[] => man.scenes.filter((s) => s.cuts?.[cut]).sort((a, b) => a.cuts[cut][0] - b.cuts[cut][0]);
const CSS = `body{margin:0;background:#0d1118;color:#dfe6ee;font:14px/1.35 Nunito,system-ui,sans-serif;padding:24px 28px;width:1744px}h1{font:400 30px 'Lilita One',Nunito,sans-serif;margin:0 0 4px}h2{font:700 20px Nunito;margin:34px 0 10px;color:#9fd0ff}
.sub{color:#8fa0b4;margin:0 0 14px}.scene{display:grid;grid-template-columns:300px 1fr 190px;gap:16px;background:#141b26;border:1px solid #243044;border-radius:10px;padding:12px;margin:0 0 10px;align-items:start}
.meta .no{display:inline-block;background:#2a79d0;color:#fff;border-radius:6px;padding:1px 8px;font-weight:800;margin-right:8px}.meta .rng{display:inline-block;color:#ffd36b;font-weight:800}.meta h3{margin:6px 0 6px;font-size:15px}.meta p{margin:2px 0;font-size:12px;color:#b5c2d2}.meta p.n{color:#e0b36a}.meta b{color:#7fa6d6}
.stills{display:flex;gap:8px}.stills figure{margin:0;flex:1 1 0;min-width:0;max-width:440px}.stills img{width:100%;display:block;border-radius:5px;border:1px solid #2b384d}.stills figcaption{font-size:11px;color:#8fa0b4;margin-top:3px}
.cap{font:italic 700 17px Nunito;color:#fff;align-self:center;text-align:center}.cap span{color:#4d5b70;font:400 12px Nunito}`;
const head = `<!doctype html><meta charset="utf-8"><title>Slope Tycoon promo storyboard</title><style>${CSS}</style>`;
const sec = (id: string, title: string, sub: string, cut: 'c90' | 'c30'): string => `<div id="${id}"><h1>${title}</h1><p class="sub">${sub}</p>${sorted(cut).map((s) => row(s, cut)).join('')}</div>`;
const sub90 = `90 s cut \u00b7 30 fps \u00b7 2560\u00d71440 High, atmosphere High, shadows on \u00b7 music: ${esc(man.music.cut90.track)} (alt: ${esc(man.music.cut90.alt)}) \u00b7 no voiceover`;
const sub30 = `30 s teaser \u00b7 music: ${esc(man.music.cut30.track)}, the strongest 30 s \u00b7 no voiceover \u00b7 stills are SwiftShader renders of the real game`;
const html90 = sec('s90', 'Slope Tycoon \u2013 promo storyboard, 90 s cut', sub90, 'c90'), html30 = sec('s30', 'Slope Tycoon \u2013 teaser storyboard, 30 s', sub30, 'c30');
writeFileSync(`${DIR}/storyboard.html`, `${head}${html90}<div style="height:50px"></div>${html30}`);
writeFileSync(`${DIR}/_s90.html`, head + html90); writeFileSync(`${DIR}/_s30.html`, head + html30);
const br = await launch();
try {
  for (const [f, out] of [['_s90.html', 'storyboard-90s.png'], ['_s30.html', 'storyboard-30s.png']] as const) {
    const page = await br.newPage(); await page.setViewport({ width: 1800, height: 900, deviceScaleFactor: 1 });
    await page.goto(`file://${process.cwd()}/${DIR}/${f}`, { waitUntil: 'load' }); await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${DIR}/${out}`, fullPage: true }); await page.close(); console.log(`wrote ${DIR}/${out}`);
  }
} finally { await br.close(); }
console.log(`wrote ${DIR}/storyboard.html`);
