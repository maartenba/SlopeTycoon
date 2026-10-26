import { BUILDINGS } from '../config/buildings';
import { LIFTS, normalizeLiftKind } from '../config/lifts';

/** User-facing text helpers (pure, no DOM). Every string built from an id or a catalog name goes through these. */
const SMALL = new Set(['of', 'and', 'the', 'a', 'an', 'to', 'in', 'on', 'at', 'for', 'or', 'by']);

/** Capitalise the first letter (after leading quotes/brackets/emoji). Other characters (acronyms, names) are untouched. */
export function sentence(s: string): string {
  if (!s) return s;
  const m = /^[^\p{L}\p{N}]*/u.exec(s)![0].length;
  const c = s.charAt(m);
  return c && c !== c.toUpperCase() ? s.slice(0, m) + c.toUpperCase() + s.slice(m + 1) : s;
}

/** Title Case: capitalise every word except small joiners (never the first); words that already contain capitals (HQ, A-Frame) are kept. */
export function title(s: string): string {
  return s.split(/(\s+)/).map((w, i) => {
    if (!w.trim()) return w;
    if (/[A-ZÀ-Þ]/.test(w.slice(1))) return w;
    if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}

/** 'mountainHut' -> 'Mountain Hut', 'night_rate' -> 'Night Rate' (fallback for ids missing from every catalog). */
export function humanizeId(id: string): string {
  return title(id.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()).replace(/\bHq\b/, 'HQ');
}

/** Catalog display name for a building or lift type id ('cafe' -> 'Café', 'chair4d' -> its lift name); unknown ids are humanised. */
export function displayName(typeId: string): string {
  const b = BUILDINGS[typeId];
  if (b) return b.name;
  const l = LIFTS[normalizeLiftKind(typeId)];
  if (l) return l.name;
  return humanizeId(typeId);
}

/** Sentence-case a whole list of reason strings. */
export const sentences = (xs: readonly string[]): string[] => xs.map(sentence);
