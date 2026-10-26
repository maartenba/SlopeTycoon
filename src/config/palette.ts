/**
 * Colour palette option (Settings > Accessibility > Colour palette): 'default' or 'cbsafe' (colour-blind safe, built on the Okabe-Ito set,
 * Okabe & Ito 2008: orange #E69F00, sky blue #56B4E9, bluish green #009E73, yellow #F0E442, blue #0072B2, vermillion #D55E00, reddish purple #CC79A7).
 * Pure data + a tiny module-level selector (render-only state: nothing here ever enters the sim or the stateHash).
 * Everything that paints a difficulty / status / overlay colour reads it from here so the whole UI switches at once.
 */
export type PaletteId = 'default' | 'cbsafe';
export const PALETTE_IDS: readonly PaletteId[] = ['default', 'cbsafe'];

export const OKABE_ITO = { orange: '#E69F00', skyBlue: '#56B4E9', bluishGreen: '#009E73', yellow: '#F0E442', blue: '#0072B2', vermillion: '#D55E00', reddishPurple: '#CC79A7', black: '#000000' } as const;

type Rgb = [number, number, number];
interface PaletteData {
  /** Green / blue / red / black piste difficulty, css. */
  difficulty: [string, string, string, string];
  /** Same colours as 0-255 rgb (index 0 unused: 'no piste'), for the overlay texture. */
  pisteRgb: [Rgb, Rgb, Rgb, Rgb, Rgb];
  /** Shader edge-rope colours 0..1 (green / blue / red / black). */
  edge: [Rgb, Rgb, Rgb, Rgb];
  /** Piste quality overlay: powder, groomed, packed, icy, bumpy, slush (index 0 unused). */
  quality: Rgb[];
  /** UI status colours. */
  good: string; bad: string; warn: string; info: string;
}

const DEFAULT: PaletteData = {
  difficulty: ['#3fb950', '#3b82f6', '#e5484d', '#222222'],
  pisteRgb: [[0, 0, 0], [60, 200, 80], [60, 120, 240], [230, 60, 60], [30, 30, 30]],
  edge: [[0.18, 0.72, 0.25], [0.16, 0.42, 0.86], [0.88, 0.20, 0.16], [0.10, 0.10, 0.12]],
  quality: [[0, 0, 0], [225, 238, 255], [130, 225, 120], [150, 150, 155], [60, 220, 235], [190, 110, 40], [120, 150, 170]],
  good: '#7fe07f', bad: '#ff6a5a', warn: '#ffd070', info: '#9bb8ff',
};

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const unit = (c: Rgb): Rgb => [c[0] / 255, c[1] / 255, c[2] / 255];
const OI = OKABE_ITO;
const CB_DIFF: [string, string, string, string] = [OI.skyBlue, OI.blue, OI.vermillion, '#1a1a1a'];
const CBSAFE: PaletteData = {
  // No red/green pair at all: easy = sky blue, intermediate = blue (darker: separable by lightness), advanced = vermillion, expert = near-black.
  // Luminance ratios between neighbours are >= 1.25:1 (tests/ui-dom/touch.test.ts), so the four stay apart even in greyscale.
  difficulty: CB_DIFF,
  pisteRgb: [[0, 0, 0], hex(CB_DIFF[0]), hex(CB_DIFF[1]), hex(CB_DIFF[2]), hex(CB_DIFF[3])],
  edge: [unit(hex(CB_DIFF[0])), unit(hex(CB_DIFF[1])), unit(hex(CB_DIFF[2])), unit(hex(CB_DIFF[3]))],
  // quality: distinct in hue AND lightness (white powder, yellow groomed, blue packed, grey icy, vermillion bumpy, purple slush)
  quality: [[0, 0, 0], [240, 246, 255], hex(OI.yellow), hex(OI.blue), [150, 150, 155], hex(OI.vermillion), hex(OI.reddishPurple)],
  good: '#56B4E9', bad: '#E69F00', warn: '#F0E442', info: '#CC79A7',
};

const TABLE: Record<PaletteId, PaletteData> = { default: DEFAULT, cbsafe: CBSAFE };
let current: PaletteId = 'default';
const listeners = new Set<(p: PaletteId) => void>();

export const isPaletteId = (v: unknown): v is PaletteId => v === 'default' || v === 'cbsafe';
export function getPalette(): PaletteId { return current; }
export function setPalette(p: PaletteId): void { if (p === current) return; current = p; for (const l of [...listeners]) l(p); }
export function onPalette(fn: (p: PaletteId) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const paletteData = (p: PaletteId = current): PaletteData => TABLE[p];
/** Css colour of a piste difficulty (1 green .. 4 black). */
export const difficultyCss = (d: number, p: PaletteId = current): string => TABLE[p].difficulty[Math.min(4, Math.max(1, d)) - 1]!;
/** Difficulty colours as a 4-tuple (green, blue, red, black). */
export const difficultyList = (p: PaletteId = current): readonly string[] => TABLE[p].difficulty;
/** Re-maps one of the DEFAULT difficulty colours (sim/PisteStats DIFFICULTY_COLORS) to the active palette; other strings pass through. */
export const mapDifficultyCss = (css: string): string => { const i = DEFAULT.difficulty.indexOf(css as never); return i < 0 ? css : TABLE[current].difficulty[i]!; };
