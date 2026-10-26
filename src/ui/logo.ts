/**
 * Procedural Slope Tycoon logo (no external assets). `logoSvg({variant, theme})` returns inline SVG markup:
 *  - 'full'     : alpine scene (peaks, sun, piste, lift cable + chair) over the two-line wordmark (display font 'Lilita One', arc + outline + shadow). 520×260.
 *  - 'badge'    : round emblem (sky disc, peaks, piste) with the wordmark on a ribbon. 300×300.
 *  - 'mark'     : compact square icon (rounded sky tile, sun, two peaks, piste): top bar / About / splash / favicon / PWA icons. 100×100, NO text.
 *  - 'wordmark' : wordmark only (alternative sketch).
 * Text needs the display font loaded in the DOCUMENT (inline SVG only, never use as <img>); the mark has no text and is safe everywhere.
 * `markGeometry` is the single source for the favicon / PNG icon generator (scripts/gen-icons.ts).
 */
export type LogoVariant = 'full' | 'mark' | 'badge' | 'wordmark';
export type LogoTheme = 'dark' | 'light';
export interface LogoOpts { variant?: LogoVariant; theme?: LogoTheme; /** CSS height (e.g. 48 -> "48px"); width follows the aspect ratio */ height?: number | string; title?: string }

let uid = 0;

type Pal = Record<'sky1' | 'sky2' | 'peakBack' | 'peakFront' | 'shade' | 'snow' | 'snowShade' | 'outline' | 'sun' | 'piste' | 'text1' | 'text2' | 'cable', string>;
const PAL: Record<'dark' | 'light', Pal> = {
  dark: { sky1: '#4f86c6', sky2: '#1d3b6e', peakBack: '#6f93c4', peakFront: '#3f649a', shade: '#2d4c7d', snow: '#ffffff', snowShade: '#cfe3f7', outline: '#0f213f', sun: '#ffd070', piste: '#ffb23e', text1: '#ffffff', text2: '#ffd070', cable: '#e8f1fb' },
  light: { sky1: '#8cc0ee', sky2: '#3f78b8', peakBack: '#7fa6d4', peakFront: '#44699f', shade: '#33558a', snow: '#ffffff', snowShade: '#d6e8f8', outline: '#17335f', sun: '#ffc24a', piste: '#e8801a', text1: '#17335f', text2: '#d9740f', cable: '#223b63' },
};

/** Peak + snow-cap geometry shared by every variant (100×100 box coordinates). */
export const markGeometry = {
  tile: { x: 0, y: 0, w: 100, h: 100, r: 22 },
  sun: { cx: 71, cy: 29, r: 11 },
  back: 'M44 82 L72 40 L100 82 Z',
  backCap: 'M72 40 L63.5 53 L68 50.5 L72 55 L76.5 50.5 L80.5 53 Z',
  front: 'M-2 84 L36 22 L74 84 Z',
  frontCap: 'M36 22 L24.5 41 L30 38 L36 44 L42 37.5 L48 41 Z',
  piste: 'M36 40 C 30 52, 48 56, 40 66 C 35 72, 25 74, 20 84',
} as const;

function peaks(p: Pal, id: string, withTile: boolean): string {
  const g = markGeometry;
  return (withTile ? `<rect width="100" height="100" rx="${g.tile.r}" fill="url(#${id}-sky)"/>` : '') +
    `<circle cx="${g.sun.cx}" cy="${g.sun.cy}" r="${g.sun.r}" fill="${p.sun}"/>` +
    `<path d="${g.back}" fill="${p.peakBack}"/><path d="${g.backCap}" fill="${p.snow}"/>` +
    `<path d="${g.front}" fill="${p.peakFront}"/><path d="M36 22 L74 84 L50 84 L40 52 Z" fill="${p.shade}" opacity=".55"/><path d="${g.frontCap}" fill="${p.snow}"/>` +
    `<path d="${g.piste}" fill="none" stroke="${p.piste}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 6.2"/>` +
    `<path d="${g.piste}" fill="none" stroke="${p.snow}" stroke-width="2.4" stroke-linecap="round" opacity=".92"/>`;
}

function defs(p: Pal, id: string): string {
  return `<defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient>` +
    `<linearGradient id="${id}-t1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.text1}"/><stop offset="1" stop-color="${p.text1 === '#ffffff' ? '#cfe3f7' : '#2b4f8a'}"/></linearGradient>` +
    `<linearGradient id="${id}-t2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.text2}"/><stop offset="1" stop-color="${p.text2 === '#ffd070' ? '#e0902a' : '#b8570a'}"/></linearGradient></defs>`;
}

const FONT = "font-family=\"'Lilita One','Nunito',system-ui,sans-serif\"";

/** Outlined + shadowed wordmark line (stroke under fill via paint-order; a duplicate offset copy is the drop shadow). */
function word(text: string, x: number, y: number, size: number, fill: string, p: Pal, opts: { path?: string; spacing?: number; sw?: number } = {}): string {
  const sw = opts.sw ?? size * 0.16, ls = opts.spacing ?? 2;
  const inner = (dx: number, dy: number, attrs: string): string => opts.path
    ? `<text ${FONT} font-size="${size}" letter-spacing="${ls}" text-anchor="middle" ${attrs} transform="translate(${dx} ${dy})"><textPath href="#${opts.path}" startOffset="50%">${text}</textPath></text>`
    : `<text x="${x + dx}" y="${y + dy}" ${FONT} font-size="${size}" letter-spacing="${ls}" text-anchor="middle" ${attrs}>${text}</text>`;
  return inner(0, size * 0.07, `fill="${p.outline}" stroke="${p.outline}" stroke-width="${sw}" stroke-linejoin="round" opacity=".45"`) +
    inner(0, 0, `fill="${fill}" stroke="${p.outline}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke"`);
}

export function logoSvg(o: LogoOpts = {}): string {
  const variant = o.variant ?? 'full', theme = o.theme ?? 'dark', p = PAL[theme], id = `lg${++uid}`;
  const hAttr = o.height === undefined ? '' : ` style="height:${typeof o.height === 'number' ? `${o.height}px` : o.height};width:auto"`;
  const title = o.title ?? 'Slope Tycoon';
  const wrap = (vb: string, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}" class="logo logo-${variant}"${hAttr}><title>${title}</title>${defs(p, id)}${body}</svg>`;

  if (variant === 'mark') return wrap('0 0 100 100', peaks(p, id, true));

  if (variant === 'wordmark') {
    return wrap('0 0 520 150',
      `<path id="${id}-a" d="M30 70 Q260 28 490 70" fill="none"/>` + word('SLOPE', 260, 70, 78, `url(#${id}-t1)`, p, { path: `${id}-a`, spacing: 6 }) +
      word('TYCOON', 260, 138, 54, `url(#${id}-t2)`, p, { spacing: 10 }));
  }

  if (variant === 'badge') {
    return wrap('0 0 300 300',
      `<circle cx="150" cy="150" r="144" fill="${p.outline}"/><circle cx="150" cy="150" r="136" fill="url(#${id}-sky)" stroke="${p.text2}" stroke-width="4"/>` +
      `<clipPath id="${id}-c"><circle cx="150" cy="150" r="132"/></clipPath><g clip-path="url(#${id}-c)"><g transform="translate(40 36) scale(2.2)">${peaks(p, id, false)}</g>` +
      `<rect x="0" y="236" width="300" height="70" fill="${p.snow}" opacity=".95"/></g>` +
      `<path d="M14 214 Q150 246 286 214 L286 268 Q150 300 14 268 Z" fill="${p.outline}"/><path d="M22 218 Q150 248 278 218 L278 262 Q150 292 22 262 Z" fill="${p.text2}"/>` +
      `<path id="${id}-b" d="M30 262 Q150 288 270 262" fill="none"/><text ${FONT} font-size="34" letter-spacing="3" text-anchor="middle" fill="${theme === 'dark' ? '#1a1208' : '#ffffff'}"><textPath href="#${id}-b" startOffset="50%">SLOPE TYCOON</textPath></text>`);
  }

  // full: peaks rise behind the lettering; lift cable + chair cross the left flank (440×380)
  const cable = `<path d="M10 168 L180 62" stroke="${p.cable}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<g transform="translate(92 114)"><path d="M0 -3 L0 14" stroke="${p.cable}" stroke-width="2.4"/><rect x="-12" y="14" width="24" height="12" rx="3" fill="${p.piste}" stroke="${p.outline}" stroke-width="2"/><path d="M-12 14 L-12 6 M12 14 L12 6" stroke="${p.outline}" stroke-width="2"/><path d="M-15 30 L15 30" stroke="${p.outline}" stroke-width="3" stroke-linecap="round"/></g>` +
    `<path d="M10 168 L10 214" stroke="${p.outline}" stroke-width="4" stroke-linecap="round"/><circle cx="10" cy="168" r="4.5" fill="${p.outline}"/><circle cx="180" cy="62" r="4.5" fill="${p.outline}"/>`;
  return wrap('0 0 440 380',
    cable + `<g transform="translate(90 8) scale(2.6)">${peaks(p, id, false)}</g>` +
    `<path id="${id}-a" d="M20 296 Q220 262 420 296" fill="none"/>` + word('SLOPE', 220, 296, 122, `url(#${id}-t1)`, p, { path: `${id}-a`, spacing: 6 }) +
    word('TYCOON', 220, 366, 66, `url(#${id}-t2)`, p, { spacing: 14 }));
}
