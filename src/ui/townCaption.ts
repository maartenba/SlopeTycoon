export interface CaptionHandle { el: HTMLElement; setText(t: string): void; dispose(): void }

/**
 * Small title-screen caption in a corner: "<town> · seed N  —  Space: next town" with a Shuffle button. `onShuffle` runs for the button,
 * Space and N (only when no control has the focus, so the menu keeps working with the keyboard).
 */
export function mountTownCaption(doc: Document, text: string, onShuffle: () => void, host: HTMLElement = doc.body): CaptionHandle {
  const el = doc.createElement('div');
  el.className = 'town-caption';
  el.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:30;display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:8px;background:rgba(8,14,24,.45);color:#e8eef8;font:600 12px/1.2 system-ui,sans-serif;pointer-events:auto;backdrop-filter:blur(2px)';
  const label = doc.createElement('span');
  label.textContent = text;
  const hint = doc.createElement('span');
  hint.textContent = '— Space: next town';
  hint.style.cssText = 'opacity:.7;font-weight:500';
  const btn = doc.createElement('button');
  btn.textContent = 'Shuffle';
  btn.setAttribute('aria-label', 'Show another town');
  btn.style.cssText = 'min-height:var(--touch-min-root,0px);min-width:var(--touch-min-root,0px);font:inherit;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:inherit;cursor:pointer';
  btn.addEventListener('click', () => onShuffle());
  el.append(label, hint, btn);
  host.appendChild(el);
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== ' ' && e.key.toLowerCase() !== 'n') return;
    const t = e.target as Node | null;
    if (t && t !== doc && t !== doc.body && t !== doc.documentElement) return; // a focused control / input keeps its own keys
    e.preventDefault();
    onShuffle();
  };
  doc.addEventListener('keydown', onKey);
  return { el, setText: (t) => { label.textContent = t; }, dispose: () => { doc.removeEventListener('keydown', onKey); el.remove(); } };
}
