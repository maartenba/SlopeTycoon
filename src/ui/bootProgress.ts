/**
 * Boot progress for the splash (index.html #splash). Dependency-free and DOM-only: it works before any custom element exists.
 * The splash markup + critical CSS live in index.html (no layout shift); this module only updates text / width / aria.
 */
export type BootStageId = 'module' | 'fonts' | 'renderer' | 'world' | 'trees' | 'lifts' | 'frame' | 'ready';
export interface BootStage { id: BootStageId; pct: number; text: string }
/** Real boot stages in order; `pct` is the bar position once the stage has STARTED. */
export const BOOT_STAGES: readonly BootStage[] = [
  { id: 'module', pct: 6, text: 'Loading the mountain…' },
  { id: 'fonts', pct: 16, text: 'Waxing the fonts…' },
  { id: 'renderer', pct: 30, text: 'Warming up the renderer…' },
  { id: 'world', pct: 48, text: 'Carving the terrain…' },
  { id: 'trees', pct: 68, text: 'Planting trees…' },
  { id: 'lifts', pct: 84, text: 'Warming up the lifts…' },
  { id: 'frame', pct: 95, text: 'Almost there…' },
  { id: 'ready', pct: 100, text: 'Ready' },
];
export const SLOW_HINT_MS = 8000;
export const SLOW_HINT_TEXT = 'Still loading — the first visit downloads the game, later visits are instant and work offline.';

/** Pure: progress state after reaching a stage. Progress never goes backwards. Unknown stage => indeterminate (pct null). */
export function advance(prev: number, id: string): { pct: number | null; text: string } {
  const s = BOOT_STAGES.find((x) => x.id === id);
  if (!s) return { pct: null, text: 'Loading…' };
  return { pct: Math.max(prev, s.pct), text: s.text };
}

interface Els { root: HTMLElement; bar: HTMLElement | null; fill: HTMLElement | null; text: HTMLElement | null; hint: HTMLElement | null; err: HTMLElement | null }
let els: Els | null = null;
let pct = 0;
let failed = false;
let hintTimer: number | undefined;

function grab(doc: Document): Els | null {
  const root = doc.getElementById('splash');
  if (!root) return null;
  return { root, bar: doc.getElementById('splash-bar'), fill: doc.getElementById('splash-fill'), text: doc.getElementById('splash-text'), hint: doc.getElementById('splash-hint'), err: doc.getElementById('splash-err') };
}

/** Starts the slow-load hint timer. Safe to call repeatedly. */
export function bootStart(doc: Document = document, slowMs = SLOW_HINT_MS): void {
  els = grab(doc); pct = 0; failed = false;
  if (!els) return;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => { if (els && !failed && els.hint) { els.hint.textContent = SLOW_HINT_TEXT; els.hint.hidden = false; } }, slowMs);
}

function render(p: number | null, text: string): void {
  if (!els || failed) return;
  if (els.bar) {
    if (p === null) { els.bar.classList.add('ind'); els.bar.removeAttribute('aria-valuenow'); }
    else { els.bar.classList.remove('ind'); els.bar.setAttribute('aria-valuenow', String(Math.round(p))); }
    els.bar.setAttribute('aria-valuetext', text);
  }
  if (els.fill && p !== null) els.fill.style.width = `${p}%`;
  if (els.text) els.text.textContent = text;
}

/** Report a boot stage (idempotent, never throws, no-op once the splash is gone). */
export function bootStage(id: BootStageId | string): void {
  try {
    if (!els) bootStart();
    const r = advance(pct, id);
    if (r.pct !== null) pct = r.pct;
    render(r.pct, r.text);
  } catch { /* the splash must never break boot */ }
}

/** Show the error state (message + reload button). */
export function bootFail(message: string): void {
  try {
    if (!els) els = grab(document);
    if (!els || failed) return;
    failed = true;
    window.clearTimeout(hintTimer);
    els.root.classList.add('failed');
    if (els.hint) els.hint.hidden = true;
    if (els.bar) els.bar.hidden = true;
    if (els.text) els.text.textContent = 'Something went wrong';
    if (els.err) { const m = els.err.querySelector('p'); if (m) m.textContent = message; els.err.hidden = false; }
  } catch { /* ignore */ }
}

export function bootFailed(): boolean { return failed; }

/** Complete the bar (the caller then fades the splash out). */
export function bootDone(): void {
  window.clearTimeout(hintTimer);
  if (failed) return;
  bootStage('ready');
  if (els?.hint) els.hint.hidden = true;
}

/** Dev only (`?bootdelay=ms`): pause so harness shots can catch each boot moment. */
export function bootPause(params: URLSearchParams): Promise<void> {
  const ms = import.meta.env.DEV ? Number(params.get('bootdelay')) || 0 : 0;
  return ms > 0 ? new Promise((r) => window.setTimeout(r, ms)) : Promise.resolve();
}

/** Yield so the browser paints the current stage before a long synchronous step. */
export function bootPaint(): Promise<void> {
  return new Promise((r) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => window.setTimeout(r, 0)); else window.setTimeout(r, 0); });
}
