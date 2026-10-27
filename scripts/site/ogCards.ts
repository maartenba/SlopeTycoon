/** `npm run site:og`: renders the 1200x630 social cards (Open Graph / Twitter) into site/assets/og/*.png from site screenshots + the logo,
 * with the real fonts (Lilita One / Nunito) via headless Chrome; sharp optimises the PNGs. The PNGs are committed; `npm run build:site` copies them. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoSvg } from '../../src/ui/logo';
import { SHOTS_DIR } from './optimize';

export const OG_DIR = 'site/assets/og';
export const CARDS: Record<string, { shot: string; kicker: string; title: string; sub: string; chips: string[] }> = {
  landing: { shot: 'hero-winter', kicker: 'A browser ski resort tycoon', title: 'Slope Tycoon', sub: 'Build your own ski & mountain resort, through all four seasons.', chips: ['Free', 'Plays offline', 'No accounts'] },
  guide: { shot: 'season-summer', kicker: 'Player guide', title: 'Run your resort like a pro', sub: 'Lifts, pistes, seasons, money, shortcuts and more.', chips: ['Getting started', 'Lifts & pistes', 'Shortcuts'] },
  privacy: { shot: 'night-village', kicker: 'Privacy & analytics', title: 'Your saves stay yours', sub: 'No ads, no accounts. Anonymous statistics only if you allow them.', chips: ['Opt-in', 'Local saves', 'No ads'] },
  about: { shot: 'season-autumn', kicker: 'About the game', title: 'Why I built this', sub: 'A summer-and-winter love letter to Ski Resort Tycoon, by Maarten.', chips: ['Made with AI', 'Open on GitHub'] },
};
const b64 = (f: string): string => readFileSync(f).toString('base64');
export function cardHtml(key: string): string {
  const c = CARDS[key]!, bg = `data:image/webp;base64,${b64(join(SHOTS_DIR, `${c.shot}-1280.webp`))}`;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'Lilita One';src:url(data:font/woff2;base64,${b64('public/fonts/lilita-one-latin.woff2')}) format('woff2')}
@font-face{font-family:Nunito;font-weight:400 800;src:url(data:font/woff2;base64,${b64('public/fonts/nunito-latin.woff2')}) format('woff2')}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;position:relative;overflow:hidden;background:#0b1626 url(${bg}) center/cover;font-family:Nunito,sans-serif;color:#e8f0fb}
.sh{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,16,30,.92) 0,rgba(8,16,30,.72) 46%,rgba(8,16,30,.05) 100%),linear-gradient(180deg,rgba(8,16,30,0) 60%,rgba(8,16,30,.7) 100%)}
.in{position:absolute;left:64px;top:56px;width:700px;bottom:56px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font:400 34px 'Lilita One';color:#fff}.brand svg{width:64px;height:64px}
.k{margin-top:auto;color:#ffb84d;font:800 24px Nunito;letter-spacing:.14em;text-transform:uppercase}
h1{margin:6px 0 10px;font:400 ${key === 'landing' ? 118 : 84}px/1.02 'Lilita One';color:#fff;text-shadow:0 4px 24px rgba(0,0,0,.5)}
p{margin:0 0 22px;font:700 32px/1.3 Nunito;color:#d7e4f5}
.chips{display:flex;gap:12px}.chips span{background:rgba(255,184,77,.16);border:2px solid rgba(255,184,77,.55);color:#ffd08a;border-radius:999px;padding:6px 20px;font:800 24px Nunito}
.url{position:absolute;right:48px;bottom:34px;font:800 24px Nunito;color:#fff;background:rgba(8,16,30,.7);padding:6px 18px;border-radius:999px}
</style><div class="sh"></div><div class="in"><div class="brand">${logoSvg({ variant: 'mark' })}Slope Tycoon</div><div class="k">${c.kicker}</div><h1>${c.title}</h1><p>${c.sub}</p><div class="chips">${c.chips.map((x) => `<span>${x.replace(/&/g, '&amp;')}</span>`).join('')}</div></div><div class="url">slopetycoon.com</div>`;
}


/** Hash of everything the cards are rendered from (card design, logo, fonts and the featured screenshots). `site/assets/og/manifest.json` stores it; `site:check` fails when it differs ("run npm run site:og"). */
export const OG_MANIFEST = `${OG_DIR}/manifest.json`;
export function ogInputsHash(): string {
  const h = createHash('sha256');
  const files = ['scripts/site/ogCards.ts', 'src/ui/logo.ts', 'public/fonts/lilita-one-latin.woff2', 'public/fonts/nunito-latin.woff2', ...[...new Set(Object.values(CARDS).map((c) => c.shot))].sort().map((s) => join(SHOTS_DIR, `${s}-1280.webp`))];
  for (const f of files) { h.update(f); h.update(existsSync(f) ? readFileSync(f) : 'missing'); }
  return h.digest('hex');
}
