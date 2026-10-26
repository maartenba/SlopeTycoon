/**
 * Accessibility options (Settings → Accessibility): 'Reduced motion' and a UI scale (90-130 %).
 *  - reduced motion: unset = follow the OS `prefers-reduced-motion`; once the player flips the toggle the choice is stored.
 *    Other systems (DemoCamera, FX, CSS animations) read `getReducedMotion()` / subscribe via `onReducedMotion`.
 *  - UI scale: `--ui-scale` on <html> (the font tokens in every component's :host use it: tokens.ts `scaledFontsCss`) + root font-size.
 * Persisted in localStorage ('slope.a11y.v1'). Pure apart from the optional DOM `apply` hook, so it is unit-testable.
 */
import { setMotionSheet } from './motionSheet';
import { isPaletteId, paletteData, setPalette, type PaletteId } from '../config/palette';
export const UI_SCALE_MIN = 90;
export const UI_SCALE_MAX = 130;
export const UI_SCALE_STEP = 5;
export const UI_SCALE_DEFAULT = 100;
export const A11Y_STORAGE_KEY = 'slope.a11y.v1';

export type TouchSetting = 'auto' | 'on' | 'off';
export const TOUCH_SETTINGS: readonly TouchSetting[] = ['auto', 'on', 'off'];
export interface A11yState { reducedMotion: boolean; uiScale: number; /** Touch controls: Auto = follow `(pointer: coarse)`. */ touch: TouchSetting; /** Colour palette (config/palette.ts). */ palette: PaletteId }
export interface A11yStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const clampUiScale = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP)) : UI_SCALE_DEFAULT);

interface Stored { reducedMotion?: boolean; uiScale?: number; touch?: TouchSetting; palette?: PaletteId }
function parse(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Stored;
    return { reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : undefined, uiScale: o.uiScale === undefined ? undefined : clampUiScale(o.uiScale), touch: TOUCH_SETTINGS.includes(o.touch as TouchSetting) ? o.touch : undefined, palette: isPaletteId(o.palette) ? o.palette : undefined };
  } catch { return {}; }
}

export class Accessibility {
  private stored: Stored;
  private listeners: Array<(s: A11yState) => void> = [];
  constructor(private storage: A11yStorage | null = null, private prefersReduced: () => boolean = () => false, private apply?: (s: A11yState) => void) {
    let raw: string | null = null;
    try { raw = storage?.getItem(A11Y_STORAGE_KEY) ?? null; } catch { /* storage blocked */ }
    this.stored = parse(raw);
    this.apply?.(this.get());
  }
  get(): A11yState { return { reducedMotion: this.stored.reducedMotion ?? this.prefersReduced(), uiScale: this.stored.uiScale ?? UI_SCALE_DEFAULT, touch: this.stored.touch ?? 'auto', palette: this.stored.palette ?? 'default' }; }
  /** True when the player never chose: the toggle then follows the OS setting. */
  get followsSystem(): boolean { return this.stored.reducedMotion === undefined; }
  set(p: Partial<A11yState>): void {
    if (p.reducedMotion !== undefined) this.stored.reducedMotion = !!p.reducedMotion;
    if (p.uiScale !== undefined) this.stored.uiScale = clampUiScale(p.uiScale);
    if (p.touch !== undefined && TOUCH_SETTINGS.includes(p.touch)) this.stored.touch = p.touch;
    if (p.palette !== undefined && isPaletteId(p.palette)) this.stored.palette = p.palette;
    try { this.storage?.setItem(A11Y_STORAGE_KEY, JSON.stringify(this.stored)); } catch { /* quota / blocked */ }
    const s = this.get();
    this.apply?.(s);
    for (const l of [...this.listeners]) l(s);
  }
  subscribe(fn: (s: A11yState) => void): () => void { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((l) => l !== fn); }; }
}

/** Writes the state onto <html>: --ui-scale, root font-size, data-reduced-motion (a document-level CSS rule disables transitions / animations). */
export function applyToDocument(s: A11yState, doc: Document = document): void {
  const r = doc.documentElement;
  r.style.setProperty('--ui-scale', String(s.uiScale / 100));
  r.style.fontSize = `${(16 * s.uiScale) / 100}px`;
  r.setAttribute('data-palette', s.palette);
  const pd = paletteData(s.palette);
  for (const [k, v] of [['good', pd.good], ['bad', pd.bad], ['info', pd.info]] as const) { if (s.palette === 'default') r.style.removeProperty(`--pal-${k}`); else r.style.setProperty(`--pal-${k}`, v); }
  setPalette(s.palette);
  setMotionSheet(s.reducedMotion);
  if (s.reducedMotion) r.setAttribute('data-reduced-motion', ''); else r.removeAttribute('data-reduced-motion');
}

let shared: Accessibility | null = null;
/** The app-wide instance (localStorage + the OS media query + document application), created on first use. */
export function accessibility(): Accessibility {
  if (!shared) {
    let storage: A11yStorage | null = null;
    try { storage = typeof localStorage !== 'undefined' ? localStorage : null; } catch { storage = null; }
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    shared = new Accessibility(storage, () => !!mq?.matches, typeof document !== 'undefined' ? (s) => applyToDocument(s) : undefined);
    mq?.addEventListener?.('change', () => { if (shared?.followsSystem) shared.set({}); });
  }
  return shared;
}
/** For tests: drop the shared instance. */
export function resetAccessibilityForTests(): void { shared = null; }

/** Reduced motion on? (DemoCamera, FX and decorative animations should skip sweeping camera moves, shakes, big particle bursts.) */
export const getReducedMotion = (): boolean => accessibility().get().reducedMotion;
export const onReducedMotion = (fn: (on: boolean) => void): (() => void) => { let last = getReducedMotion(); return accessibility().subscribe((s) => { if (s.reducedMotion !== last) { last = s.reducedMotion; fn(last); } }); };
export const getUiScale = (): number => accessibility().get().uiScale;
