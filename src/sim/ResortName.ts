import { SCHIRMBAR } from '../config/schirmbar';

/**
 * The resort name (M7.8, docs/schirmbar.md): shown on the Schirmbar banner, in the HUD / pause menu / year report and as the photo file name.
 * Pure: a deterministic default from the seed (no Rng draw) and one sanitiser every entry point (New Game field, URL, Settings, save) goes through.
 */
export const RESORT_NAME_MAX = SCHIRMBAR.nameMax;

const HEAD = ['Alpen', 'Hinter', 'Silber', 'Sonnen', 'Kron', 'Nebel', 'Gold', 'Fels', 'Eis', 'Bären', 'Edel', 'Schnee', 'Mittel', 'Rauh', 'Vorder', 'Gams'] as const;
const TAIL = ['glow', 'kogel', 'horn', 'spitz', 'alm', 'joch', 'tal', 'wald', 'grat', 'blick', 'feld', 'kar', 'hang', 'stein', 'berg', 'see'] as const;

/** A plain-text resort name: markup characters and control characters dropped, whitespace collapsed, trimmed, at most RESORT_NAME_MAX characters. Empty when nothing usable is left. */
export function sanitizeResortName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/<[^>]*>/g, '').replace(/&#?[a-z0-9]+;/gi, '').replace(/[<>&"`\\]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, RESORT_NAME_MAX).join('').trim();
}

/** The default name of a seed: 'Alpenglow', 'Hinterkogel', 'Sonnenjoch' ... (a pure function of the seed). */
export function defaultResortName(seed: number): string {
  let h = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  const a = HEAD[h % HEAD.length]!, b = TAIL[(h >>> 8) % TAIL.length]!;
  return a + b;
}

/** The name to use: the sanitised choice, else the seed's default. */
export const resortNameOr = (raw: unknown, seed: number): string => sanitizeResortName(raw) || defaultResortName(seed);
