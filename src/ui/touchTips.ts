/**
 * Touch tooltips (docs/touch.md): a finger cannot hover, so `title` / `aria-label` texts (icon-only buttons, key hints) were unreachable. Holding a finger
 * still on any labelled control for ~0.5 s shows its text in a small bubble (2.5 s), and the click that would follow the release is swallowed so the hold
 * does not also press the button. The map canvas (its own long press), sliders, text fields and the walk stick are left alone.
 */
export interface TouchTipsOptions { enabled(): boolean; holdMs?: number; showMs?: number }
export interface TouchTipsHandle { dispose(): void; /** How long a finger must rest (ms); tests with a slow emulated device raise it. */ holdMs: number }

const SKIP = 'canvas, input, textarea, select, st-select, [data-role=joystick]';

/** The text a hold on `path` would show: the first element with a title / aria-label that is not a skipped kind. */
export function tipTextFor(path: readonly EventTarget[]): { el: HTMLElement; text: string } | null {
  for (const t of path) {
    const e = t as HTMLElement;
    if (!e || e.nodeType !== 1) continue;
    if (typeof e.matches === 'function' && e.matches(SKIP)) return null;
    const text = (e.getAttribute?.('title') || e.getAttribute?.('aria-label') || '').trim();
    if (text) return { el: e, text };
  }
  return null;
}

/** Chrome: true while input events are queued behind a busy main thread. */
function inputPending(): boolean {
  try { return !!(navigator as { scheduling?: { isInputPending?: (o?: { includeContinuous: boolean }) => boolean } }).scheduling?.isInputPending?.({ includeContinuous: true }); } catch { return false; }
}

export function installTouchTips(o: TouchTipsOptions, doc: Document = document): TouchTipsHandle {
  const showMs = o.showMs ?? 2500;
  const handle: TouchTipsHandle = { holdMs: o.holdMs ?? 500, dispose(): void { cancel(); hide(); win.removeEventListener('pointerdown', down, true); win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', up, true); win.removeEventListener('click', click, true); } };
  let timer = 0, hideTimer = 0, id = -1, sx = 0, sy = 0, pending: { el: HTMLElement; text: string } | null = null;
  let swallowUntil = 0;
  let bubble: HTMLDivElement | null = null;
  const win = doc.defaultView ?? window;

  const hide = (): void => { win.clearTimeout(hideTimer); bubble?.remove(); bubble = null; };
  const cancel = (): void => { win.clearTimeout(timer); timer = 0; pending = null; id = -1; };
  const show = (p: { el: HTMLElement; text: string }): void => {
    hide();
    const b = doc.createElement('div');
    b.className = 'touch-tip'; b.setAttribute('role', 'tooltip'); b.textContent = p.text;
    b.style.cssText = 'position:fixed;z-index:3000;max-width:min(260px,80vw);padding:6px 10px;border-radius:8px;background:#0c121b;color:#fff;border:1px solid #5f7798;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.55);left:0;top:0;visibility:hidden';
    doc.body.append(b);
    const r = p.el.getBoundingClientRect(), bw = b.offsetWidth || 160, bh = b.offsetHeight || 28;
    const left = Math.max(8, Math.min((win.innerWidth || 390) - bw - 8, r.left + r.width / 2 - bw / 2));
    const above = r.top - bh - 8, top = above >= 8 ? above : Math.min((win.innerHeight || 640) - bh - 8, r.bottom + 8);
    b.style.left = `${Math.round(left)}px`; b.style.top = `${Math.round(top)}px`; b.style.visibility = 'visible';
    bubble = b;
    hideTimer = win.setTimeout(hide, showMs);
  };

  const down = (e: PointerEvent): void => {
    hide(); cancel();
    if (e.pointerType !== 'touch' || !o.enabled() || (e as { synthetic?: boolean }).synthetic) return;
    const p = tipTextFor(e.composedPath());
    if (!p) return;
    pending = p; id = e.pointerId; sx = e.clientX; sy = e.clientY;
    const fire = (tries: number): void => {
      if (tries > 0 && inputPending()) { timer = win.setTimeout(() => fire(tries - 1), 40); return; } // the release may be queued behind a busy frame: let it through first
      const q = pending; cancel(); if (q) { show(q); swallowUntil = Number.POSITIVE_INFINITY; }
    };
    timer = win.setTimeout(() => fire(25), handle.holdMs);
  };
  const move = (e: PointerEvent): void => { if (e.pointerId === id && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); };
  const up = (e: PointerEvent): void => {
    if (e.pointerId === id) cancel();
    if (swallowUntil === Number.POSITIVE_INFINITY) swallowUntil = Date.now() + 450; // the click after the release belongs to the hold
  };
  const click = (e: Event): void => {
    if (swallowUntil !== 0 && (swallowUntil === Number.POSITIVE_INFINITY || Date.now() < swallowUntil)) { swallowUntil = 0; e.stopImmediatePropagation(); e.preventDefault(); }
  };
  win.addEventListener('pointerdown', down, true);
  win.addEventListener('pointermove', move, true);
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', (e) => { if (e.pointerId === id) cancel(); if (swallowUntil === Number.POSITIVE_INFINITY) swallowUntil = Date.now() + 450; }, true);
  win.addEventListener('click', click, true);
  return handle;
}
