/**
 * Procedural SVG card icons for the Terrain and View drawers (no assets, no emoji; `currentColor` + two accents so they sit
 * next to the building thumbnails and Landscape emoji). Strings start with `<svg` so `StDock.setIcon` inlines them.
 */
import type { OverlayMode } from '@/sim/Coverage';

const S = (inner: string): string => `<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" focusable="false">${inner}</svg>`;
const L = (c = 'currentColor', w = 2.6): string => `stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
const SNOW = '#eaf4ff', HILL = '#7a95b5', ACC = '#ffd070', GRN = '#7fd07f', RED = '#ff7a6a';
const ground = '<path d="M3 40h42" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';

export const TERRAIN_ICONS: Record<string, string> = {
  raise: S(`${ground}<path d="M5 36c6 0 8-14 19-14s13 14 19 14z" fill="${HILL}" stroke="currentColor" stroke-width="1.6"/><path d="M24 4v14M17 11l7-7 7 7" ${L(ACC)}/>`),
  lower: S(`${ground}<path d="M5 22h38v14c-6 0-8 6-19 6s-13-6-19-6z" fill="${HILL}" stroke="currentColor" stroke-width="1.6"/><path d="M5 22c6 0 8 12 19 12s13-12 19-12" fill="#1b2636" stroke="currentColor" stroke-width="1.6"/><path d="M24 4v14M17 11l7 7 7-7" ${L(ACC)}/>`),
  flatten: S(`${ground}<path d="M4 36c5-9 9-12 14-12h12c5 0 9 3 14 12z" fill="${HILL}" opacity=".45"/><path d="M4 26h40" ${L(ACC)} stroke-dasharray="1 5"/><path d="M10 26h28v10H10z" fill="${HILL}" stroke="currentColor" stroke-width="1.6"/><path d="M20 12l4-4 4 4M20 18l4 4 4-4" ${L(ACC)}/>`),
  smooth: S(`${ground}<path d="M4 34c4-14 8-14 10 0 2 12 6-14 10-14s6 20 10 12c3-6 6-10 10 4V40H4z" fill="${HILL}" opacity=".4"/><path d="M4 28c6-12 10-12 14 0s8 12 13 0 8-12 13 0" ${L()}/><path d="M4 36c8-6 12-6 20 0s14 6 20 0" ${L(ACC)} opacity=".9"/>`),
  tile: S(`<path d="M24 8 42 18 24 28 6 18z" fill="${HILL}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M24 28v10M6 18v10l18 10 18-10V18" ${L('currentColor',1.8)}/>`),
  corner: S(`<path d="M24 8 42 18 24 28 6 18z" fill="${HILL}" opacity=".5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="24" cy="28" r="5" fill="${ACC}" stroke="currentColor" stroke-width="1.6"/>`),
};

const eye = `<path d="M4 24c5-8 11-12 20-12s15 4 20 12c-5 8-11 12-20 12S9 32 4 24z" ${L()}/><circle cx="24" cy="24" r="5.500" fill="currentColor"/>`;
const glyph = (inner: string, c = ACC): string => S(`<path d="M24 5 43 15v18L24 43 5 33V15z" fill="${HILL}" opacity=".35" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>${inner.replace(/ACC/g, c)}`);

export const VIEW_ICONS: Record<string, string> = {
  rotL: S(`<path d="M14 14a14 14 0 1 1-4 14" ${L()}/><path d="M6 10l8 4-1 8" ${L(ACC)}/>`),
  rotR: S(`<path d="M34 14a14 14 0 1 0 4 14" ${L()}/><path d="M42 10l-8 4 1 8" ${L(ACC)}/>`),
  zoomIn: S(`<circle cx="21" cy="21" r="12" ${L()}/><path d="M30 30l12 12M21 15v12M15 21h12" ${L(ACC)}/>`),
  zoomOut: S(`<circle cx="21" cy="21" r="12" ${L()}/><path d="M30 30l12 12M15 21h12" ${L(ACC)}/>`),
  grid: S(`<path d="M24 6 42 15 24 24 6 15z M15 10.500l18 9M33 10.500l-18 9M6 15v14l18 9 18-9V15M24 24v14" ${L('currentColor',2)}/>`),
  ride: S(`<path d="M4 12 44 20" ${L('currentColor',2)}/><path d="M26 16v6" ${L('currentColor',2)}/><path d="M19 22h14v9H19z" fill="${ACC}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 44c8-6 14-6 22-12" ${L(SNOW,2)}/>`),
  walk: S(`<circle cx="26" cy="9" r="4.500" fill="currentColor"/><path d="M26 15l-5 11-8 3M26 15l4 9 7 3M21 26l3 9-5 8M24 35l7 8" ${L()}/>`),
  photo: S(`<path d="M5 15a3 3 0 0 1 3-3h7l3-5h12l3 5h7a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" ${L('currentColor',2.4)}/><circle cx="24" cy="25" r="8" ${L(ACC)}/>`),
  off: S(`${eye}<path d="M8 40 40 8" ${L(RED)}/>`),
  firstAid: glyph('<path d="M20 14h8v8h8v8h-8v8h-8v-8h-8v-8h8z" fill="#ff6a5a" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  patrol: glyph('<path d="M24 12 35 16v8c0 7-5 11-11 14-6-3-11-7-11-14v-8z" fill="#f08c28" stroke="currentColor" stroke-width="1.6"/><path d="M24 17v14M18 24h12" ' + L('#fff',2) + '/>'),
  grooming: glyph(`<path d="M10 28h28M10 34h28M10 22h28" ${L('#b088f0')}/><path d="M14 14l6 4M28 14l6 4" ${L('#b088f0')} opacity=".6"/>`),
  snowmaking: glyph('<g stroke="#46c8ff" stroke-width="2.4" stroke-linecap="round"><path d="M24 11v26M13 17.500l22 13M35 17.500l-22 13"/></g><circle cx="24" cy="24" r="2.500" fill="#fff"/>'),
  warning: glyph('<path d="M24 11 38 35H10z" fill="#f0dc28" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M24 20v8" ' + L('#222',2.4) + '/><circle cx="24" cy="31.500" r="1.600" fill="#222"/>'),
  heli: glyph('<path d="M10 14h28M24 14v5" ' + L('#3cdc78',2) + '/><ellipse cx="24" cy="26" rx="9" ry="6.500" fill="#3cdc78" stroke="currentColor" stroke-width="1.6"/><path d="M33 26h8M39 22v8" ' + L('currentColor',2) + '/>'),
  piste: glyph(`<path d="M10 36 22 12 28 24 38 38z" ${L('currentColor',2)}/><circle cx="14" cy="32" r="3" fill="${GRN}"/><circle cx="24" cy="22" r="3" fill="#5aa0ff"/><path d="M33 29l4 4-4 4-4-4z" fill="#222" stroke="currentColor" stroke-width="1.2"/>`),
  connectivity: glyph(`<circle cx="12" cy="30" r="4" fill="${GRN}"/><circle cx="24" cy="14" r="4" fill="${GRN}"/><circle cx="36" cy="30" r="4" fill="${RED}"/><path d="M14 27l8-10M26 17l8 10" ${L('currentColor',2)}/>`),
  snow: glyph(`<path d="M8 36c4-6 7-9 11-9s6 5 10 5 7-5 11-5v12H8z" fill="${SNOW}" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="14" r="2" fill="${SNOW}"/><circle cx="26" cy="11" r="2" fill="${SNOW}"/><circle cx="34" cy="17" r="2" fill="${SNOW}"/>`),
  quality: glyph(`<path d="M24 11l3.500 8 8.500.8-6.500 5.700 2 8.500L24 29.400 16.500 34l2-8.500L12 19.800l8.500-.8z" fill="${ACC}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`),
  wildlife: glyph('<ellipse cx="24" cy="30" rx="7" ry="6" fill="#5ac046"/><circle cx="14" cy="23" r="3" fill="#5ac046"/><circle cx="20" cy="16" r="3" fill="#5ac046"/><circle cx="28" cy="16" r="3" fill="#5ac046"/><circle cx="34" cy="23" r="3" fill="#5ac046"/>'),
  threat: glyph(`<path d="M24 10 40 38H8z" fill="${RED}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 28l5-5 5 5" ${L('#fff',2)}/>`),
  traffic: glyph(`<path d="M10 36c8-2 8-10 14-12s10-6 14-12" ${L(RED,5)} opacity=".85"/><path d="M10 36c8-2 8-10 14-12s10-6 14-12" ${L(ACC,2)}/>`),
  winter: S(`<g stroke="${SNOW}" stroke-width="2.600" stroke-linecap="round"><path d="M24 6v36M8.400 15l31.200 18M39.600 15 8.400 33"/></g>`),
  spring: S(`<path d="M24 42V22" ${L(GRN)}/><path d="M24 26c-10 0-12-8-12-14 8 0 12 5 12 14zM24 22c8 0 12-6 12-12-8 0-12 4-12 12z" fill="${GRN}" stroke="currentColor" stroke-width="1.4"/>`),
  summer: S(`<circle cx="24" cy="24" r="9" fill="${ACC}" stroke="currentColor" stroke-width="1.6"/><g stroke="${ACC}" stroke-width="3" stroke-linecap="round"><path d="M24 4v5M24 39v5M4 24h5M39 24h5M10 10l3.500 3.500M34.500 34.500 38 38M38 10l-3.500 3.500M13.500 34.500 10 38"/></g>`),
  autumn: S(`<path d="M24 6c8 6 16 12 12 20 3 0 6 2 6 2-4 2-6 2-8 1 2 6-4 9-10 12-6-3-12-6-10-12-2 1-4 1-8-1 0 0 3-2 6-2C8 18 16 12 24 6z" fill="#e0782a" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M24 14v28" ${L('currentColor',1.8)}/>`),
};

/** Overlay modes that have a dedicated icon above; anything new falls back to the generic eye. */
export function overlayIcon(m: OverlayMode): string { return VIEW_ICONS[m] ?? VIEW_ICONS.off!; }
