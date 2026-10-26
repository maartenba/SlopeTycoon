/**
 * Small inline-SVG icon set for the HUD (no emoji / font glyphs: those render as empty boxes in some environments).
 * All icons are 16x16 viewBox, drawn with `currentColor`, so CSS colours them. Pure DOM, no assets.
 * NB: only call from non-constructor code paths is NOT required: creating SVG children in a *shadow root* build step is fine; custom
 * element constructors must not touch their own attributes/children, but they may fill their shadow root (see StElement).
 */
const NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'moon' | 'guests' | 'sun' | 'cloud' | 'snow' | 'rain' | 'storm' | 'mountain' | 'pause' | 'news' | 'lock' | 'bulb' | 'smile' | 'meh' | 'frown' | 'mute' | 'eye' | 'exit' | 'next' | 'camera' | 'walk' | 'flake' | 'bike' | 'trophy' | 'star' | 'lift' | 'cross' | 'coin' | 'paw' | 'medal';

const PATHS: Record<IconName, string> = {
  moon: '<path d="M11.5 10.2A5.2 5.2 0 0 1 5.8 2.5a5.5 5.5 0 1 0 7.7 7.7 5 5 0 0 1-2 0z" fill="currentColor"/>',
  guests: '<circle cx="5.5" cy="5" r="2.4" fill="currentColor"/><circle cx="11.3" cy="5.6" r="2" fill="currentColor" opacity=".75"/><path d="M1 13.5c0-3 2-4.6 4.5-4.6S10 10.5 10 13.5zM10.3 9.3c2.3-.4 4.7.8 4.7 4.2h-3.6c0-1.7-.4-3-1.1-4.2z" fill="currentColor"/>',
  sun: '<circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></g>',
  cloud: '<path d="M4.5 12.5a3 3 0 0 1-.4-6A4.2 4.2 0 0 1 12.2 6.8 2.9 2.9 0 0 1 11.6 12.5z" fill="currentColor"/>',
  snow: '<path d="M4.5 9.5a3 3 0 0 1-.4-5.6A4.2 4.2 0 0 1 12.2 4.8 2.7 2.7 0 0 1 11.6 9.5z" fill="currentColor"/><g fill="currentColor"><circle cx="5" cy="12" r="1"/><circle cx="8" cy="13.5" r="1"/><circle cx="11" cy="12" r="1"/></g>',
  rain: '<path d="M4.5 9.5a3 3 0 0 1-.4-5.6A4.2 4.2 0 0 1 12.2 4.8 2.7 2.7 0 0 1 11.6 9.5z" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5 11.5l-.8 2M8.3 11.5l-.8 2M11.5 11.5l-.8 2"/></g>',
  storm: '<path d="M4.5 9a3 3 0 0 1-.4-5.6A4.2 4.2 0 0 1 12.2 4.3 2.7 2.7 0 0 1 11.6 9z" fill="currentColor"/><path d="M8.7 8.5 6.5 12h1.8l-.7 3 2.6-3.8H8.5z" fill="#ffd070"/>',
  mountain: '<path d="M1 13.5 6 4l3 5.2 1.5-2.2L15 13.5z" fill="currentColor"/>',
  pause: '<rect x="4" y="3" width="2.8" height="10" rx=".6" fill="currentColor"/><rect x="9.2" y="3" width="2.8" height="10" rx=".6" fill="currentColor"/>',
  news: '<path d="M2 3h9v10H3.5A1.5 1.5 0 0 1 2 11.5zM11 6h3v5.5a1.5 1.5 0 0 1-3 0z" fill="currentColor" opacity=".9"/><path d="M4 5.5h5M4 8h5M4 10.5h3" stroke="#1b2636" stroke-width="1"/>',
  lock: '<rect x="3.5" y="7" width="9" height="7" rx="1.2" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.5" fill="none"/>',
  bulb: '<path d="M8 1.5a4.5 4.5 0 0 0-2.5 8.2V11h5V9.7A4.5 4.5 0 0 0 8 1.5zM6 12.5h4M6.7 14.2h2.6" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>',
  mute: '<path d="M2 6h3l4-3.500v11L5 10H2z" fill="currentColor"/><path d="M11 5.500l4 5M15 5.500l-4 5" stroke="#ff6a5a" stroke-width="1.6" stroke-linecap="round"/>',
  eye: '<path d="M1 8c2-3.500 4.500-5 7-5s5 1.500 7 5c-2 3.500-4.500 5-7 5S3 11.500 1 8z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.300" fill="currentColor"/>',
  exit: '<path d="M3.500 3.500l9 9M12.500 3.500l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  next: '<path d="M3 3.500l6 4.500-6 4.500zM10 3v10" fill="currentColor" stroke="currentColor" stroke-width="1.600" stroke-linejoin="round" stroke-linecap="round"/>',
  walk: '<circle cx="9" cy="2.800" r="1.500" fill="currentColor"/><path d="M9 5 7 8l-2.500 1M9 5l1.500 3 2 1M7 8l1 3-1.500 3.500M8 11l2.500 3.500" fill="none" stroke="currentColor" stroke-width="1.400" stroke-linecap="round" stroke-linejoin="round"/>',
  flake: '<g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5v13M2.4 4.8l11.2 6.4M13.6 4.8 2.4 11.2"/><path d="M6.2 2.8 8 4.4l1.8-1.6M6.2 13.2 8 11.6l1.8 1.6" fill="none" stroke-width="1.1"/></g>',
  bike: '<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.800" cy="10.800" r="2.600"/><circle cx="12.200" cy="10.800" r="2.600"/><path d="M3.800 10.800 6.800 5.500h3.700l1.700 5.300M6.800 5.500l2 5.300h3.400M5.600 4h2.400M9.800 3.800h1.800"/></g>',
  camera: '<path d="M1.500 5.200A1.200 1.200 0 0 1 2.700 4h2l.9-1.600h4.800L11.300 4h2a1.200 1.200 0 0 1 1.200 1.200v6.600A1.200 1.200 0 0 1 13.300 13H2.700a1.200 1.200 0 0 1-1.200-1.200z" fill="none" stroke="currentColor" stroke-width="1.400" stroke-linejoin="round"/><circle cx="8" cy="8.300" r="2.400" fill="currentColor"/>',
  trophy: '<path d="M4.500 2h7v4.200a3.500 3.500 0 0 1-7 0zM4.500 3.200H2.200c0 2.300.9 3.700 2.700 4M11.500 3.200h2.300c0 2.300-.9 3.700-2.700 4M8 9.700V12M5.200 14h5.600M6 12h4" fill="currentColor" stroke="currentColor" stroke-width="1.300" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="M8 1.500l1.900 4 4.400.5-3.200 3 .9 4.300L8 11.100l-4 2.200.9-4.300-3.200-3 4.400-.5z" fill="currentColor" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/>',
  lift: '<path d="M1.500 3.500 14.500 6.500" stroke="currentColor" stroke-width="1.300" stroke-linecap="round"/><path d="M8 5v2.200" stroke="currentColor" stroke-width="1.300"/><rect x="5.500" y="7.200" width="5" height="4.200" rx="1" fill="currentColor"/><path d="M6 13.500h4" stroke="currentColor" stroke-width="1.300" stroke-linecap="round"/>',
  cross: '<path d="M6.200 2h3.600v4.200H14v3.600H9.800V14H6.200V9.800H2V6.200h4.200z" fill="currentColor"/>',
  coin: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.700"/><path d="M8 4.200v7.600M10 6.200C9.600 5.600 8.900 5.300 8 5.300c-1.100 0-1.900.5-1.900 1.300 0 1.900 3.900.9 3.900 2.800 0 .8-.8 1.300-2 1.300-.9 0-1.700-.4-2.100-1" stroke="currentColor" stroke-width="1.300" fill="none" stroke-linecap="round"/>',
  paw: '<ellipse cx="8" cy="10.500" rx="3.200" ry="2.700" fill="currentColor"/><circle cx="3.600" cy="7.200" r="1.500" fill="currentColor"/><circle cx="6.200" cy="4" r="1.500" fill="currentColor"/><circle cx="9.800" cy="4" r="1.500" fill="currentColor"/><circle cx="12.400" cy="7.200" r="1.500" fill="currentColor"/>',
  medal: '<path d="M4.500 1.500h2.800l.9 4.200-2.700.8zM11.500 1.500H8.700L7.800 5.700l2.700.8z" fill="currentColor" opacity=".7"/><circle cx="8" cy="10" r="4.200" fill="currentColor"/><path d="M8 7.700l.8 1.600 1.700.2-1.200 1.200.3 1.700L8 11.600l-1.600.8.3-1.700-1.200-1.200 1.700-.2z" fill="#1b2636"/>',
  smile: '<circle cx="8" cy="8" r="6.5" fill="#ffd070"/><circle cx="5.7" cy="6.5" r=".9" fill="#3a2a10"/><circle cx="10.3" cy="6.5" r=".9" fill="#3a2a10"/><path d="M4.8 9.5Q8 13 11.2 9.5" stroke="#3a2a10" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  meh: '<circle cx="8" cy="8" r="6.5" fill="#e8c060"/><circle cx="5.7" cy="6.5" r=".9" fill="#3a2a10"/><circle cx="10.3" cy="6.5" r=".9" fill="#3a2a10"/><path d="M5 10.5h6" stroke="#3a2a10" stroke-width="1.3" stroke-linecap="round"/>',
  frown: '<circle cx="8" cy="8" r="6.5" fill="#e09060"/><circle cx="5.7" cy="6.5" r=".9" fill="#3a2a10"/><circle cx="10.3" cy="6.5" r=".9" fill="#3a2a10"/><path d="M5 11.5Q8 8.5 11 11.5" stroke="#3a2a10" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
};

/** An inline SVG icon (16x16 viewBox, `currentColor`), sized by `size` px (default 14), aria-hidden. */
export function icon(name: IconName, size = 14): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `ic ic-${name}`);
  svg.style.cssText = 'display:inline-block;vertical-align:-2px;flex:none';
  svg.innerHTML = PATHS[name];
  return svg;
}

/** Weather kind (see ui/format WeatherKindName) -> icon. */
export function weatherIconName(kind: string): IconName {
  switch (kind) {
    case 'clear': return 'sun';
    case 'cloudy': return 'cloud';
    case 'snow': case 'heavySnow': return 'snow';
    case 'rain': return 'rain';
    case 'storm': return 'storm';
    default: return 'cloud';
  }
}

/** Happiness 0..1 -> face icon. */
export const smileyIcon = (h: number): IconName => (h > 0.6 ? 'smile' : h > 0.35 ? 'meh' : 'frown');

export type StarFill = 'full' | 'half' | 'empty';
/** Rating (0..5, halves) -> five star fill states. Rounds to the nearest half. */
export function starFills(stars: number): StarFill[] {
  const v = Math.max(0, Math.min(5, Math.round((Number.isFinite(stars) ? stars : 0) * 2) / 2));
  return Array.from({ length: 5 }, (_, i) => (v >= i + 1 ? 'full' : v >= i + 0.5 ? 'half' : 'empty'));
}

const STAR = 'M8 1.2 10 5.8 14.9 6.2 11.2 9.4 12.3 14.2 8 11.7 3.7 14.2 4.8 9.4 1.1 6.2 6 5.8z';
const STAR_LEFT = 'M8 1.2 6 5.8 1.1 6.2 4.8 9.4 3.7 14.2 8 11.7z';
/** SVG star row for a rating (5 stars, filled / half / outline; colours via `--star-on` / `--star-off`). */
export function starRow(stars: number, size = 13): SVGSVGElement {
  const fills = starFills(stars);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 16'); svg.setAttribute('width', String(size * 5)); svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${stars} of 5 stars`);
  svg.style.cssText = 'display:inline-block;vertical-align:-2px;flex:none';
  let html = '';
  fills.forEach((f, i) => {
    const t = `translate(${i * 16} 0)`;
    const outline = `<path d="${STAR}" transform="${t}" fill="${f === 'full' ? '#ffd070' : 'none'}" stroke="${f === 'empty' ? '#7f8fa6' : '#ffd070'}" stroke-width="1.1" stroke-linejoin="round"/>`;
    html += outline;
    if (f === 'half') html += `<g transform="${t}"><path d="${STAR_LEFT}" fill="#ffd070"/></g>`;
  });
  svg.innerHTML = html;
  return svg;
}
