/**
 * Fallback lift card icons (M8): small inline SVGs (no emoji), one per lift kind, shown until the rendered 3D thumbnail is ready (Thumbnails.ts) and on
 * surfaces that cannot show a render. `currentColor` + a per-kind accent; strings start with `<svg` so `StDock.setIcon` inlines them.
 */
import type { LiftKind } from '@/config/lifts';

const S = (inner: string): string => `<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" focusable="false">${inner}</svg>`;
const HILL = '#7a95b5', SNOW = '#eaf4ff';
const cable = '<path d="M2 12 46 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>';
const hill = `<path d="M2 44c10-6 22-14 44-20v20z" fill="${HILL}" opacity=".5"/><path d="M2 44c10-6 22-14 44-20" stroke="${SNOW}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
const tower = '<path d="M12 40 14 12M22 40 20 14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9 13h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';

/** Chair on a hanger: `seats` seats side by side, optional bubble hood. */
function chair(seats: number, accent: string, bubble: boolean): string {
  const w = Math.min(34, 7 + seats * 4.2), x0 = 24 - w / 2;
  let g = `<path d="M24 18v7" stroke="currentColor" stroke-width="2"/>`;
  g += `<rect x="${x0}" y="27" width="${w}" height="3.4" rx="1.4" fill="${accent}"/>`;
  g += `<path d="M${x0} 27V22M${x0 + w} 27V22" stroke="${accent}" stroke-width="2.4" stroke-linecap="round"/>`;
  for (let i = 0; i < seats; i++) g += `<circle cx="${x0 + (w / seats) * (i + 0.5)}" cy="22" r="2.2" fill="currentColor" opacity=".85"/>`;
  g += `<path d="M${x0 + 2} 33.500h${w - 4}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  if (bubble) g += `<path d="M${x0 - 1} 31V22a${(w + 2) / 2} 9 0 0 1 ${w + 2} 0v9z" fill="#bfe3f5" opacity=".5" stroke="currentColor" stroke-width="1.400"/>`;
  return S(`${hill}${cable}${tower}${g}`);
}
const gondola = (big: boolean): string => S(`${hill}${cable}${tower}<path d="M24 18v6" stroke="currentColor" stroke-width="2"/><rect x="${big ? 12 : 15}" y="24" width="${big ? 24 : 18}" height="13" rx="3" fill="${big ? '#c05a4a' : '#4a90d9'}" stroke="currentColor" stroke-width="1.800"/><path d="M${big ? 16 : 18.500} 27h${big ? 16 : 11}v5h-${big ? 16 : 11}z" fill="#bfe3f5"/>`);

export const LIFT_FALLBACK_ICONS: Record<LiftKind, string> = {
  tbar: S(`${hill}${cable}${tower}<path d="M24 18v14M17 32h14" stroke="#e8a800" stroke-width="3" stroke-linecap="round"/>`),
  chair2: chair(2, '#b03a2e', false),
  chair4: chair(4, '#c0392b', false),
  chair4d: chair(4, '#c0392b', false).replace('</svg>', '<path d="M5 6l5 3-5 3z" fill="#ffd070"/></svg>'),
  chair6: chair(6, '#a93226', false),
  chair6d: chair(6, '#1f7a6a', false).replace('</svg>', '<path d="M5 6l5 3-5 3z" fill="#ffd070"/></svg>'),
  chair6b: chair(6, '#5d6d7e', true),
  chair8b: chair(8, '#4a5a6a', true),
  gondola6: gondola(false),
  gondola10: gondola(true),
  cablecar: S(`${hill}${cable}${tower}<path d="M24 18v5" stroke="currentColor" stroke-width="2"/><path d="M11 24h26l-2 14H13z" fill="#d8a82a" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"/><path d="M15 27h18v6H15z" fill="#bfe3f5"/>`),
  funicular: S(`<path d="M3 42 45 14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8 46v-3M20 46v-9M32 46v-18M44 46v-27" stroke="currentColor" stroke-width="2" opacity=".6"/><g transform="rotate(-33 24 28)"><rect x="12" y="20" width="24" height="11" rx="2.500" fill="#2e8b57" stroke="currentColor" stroke-width="1.800"/><path d="M15 23h18v4H15z" fill="#bfe3f5"/></g>`),
};
