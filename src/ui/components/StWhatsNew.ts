import type { UpdateCardModel, WhatsNewEntry } from '../../config/whatsNew';
import { highlightsList } from '../whatsNewView';
import { StElement } from './StElement';

/**
 * Phones (portrait <= 520 px wide / landscape <= 520 px high; docs/mobile-ui-v2.md): the card is a FULL-SCREEN sheet like Settings / Statistics:
 * 48 px header (sticky) with a 44 px close button, a scrolling body, a sticky action row, safe-area insets. Desktop and tablets keep the compact card.
 */
export const FS_CSS = `@media (max-width:520px),(max-height:520px){
:host([data-fs]){position:fixed;inset:0;width:auto;z-index:30}
.card{position:fixed;inset:0;width:auto;max-height:none;border-radius:0;border:0;gap:10px;padding:0 calc(16px + env(safe-area-inset-right,0px)) 0 calc(16px + env(safe-area-inset-left,0px));font-size:15px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--c-panel)}
.head{position:sticky;top:0;z-index:1;margin:0 calc(-16px - env(safe-area-inset-right,0px)) 0 calc(-16px - env(safe-area-inset-left,0px));padding-left:calc(16px + env(safe-area-inset-left,0px));padding-right:calc(16px + env(safe-area-inset-right,0px));align-items:center;min-height:48px;padding-top:env(safe-area-inset-top,0px);background:var(--c-panel);border-bottom:1px solid rgba(90,112,144,.4)}
.head h3{font-size:19px}
.head button{flex:none;width:44px;height:44px;min-width:44px;padding:0;font-size:18px;line-height:1}
li{margin:0 0 8px;line-height:1.45}.wn-ver{font-size:12px;margin-top:8px}
.actions{position:sticky;bottom:0;margin:auto calc(-16px - env(safe-area-inset-right,0px)) 0 calc(-16px - env(safe-area-inset-left,0px));padding:10px calc(16px + env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));background:var(--c-panel);border-top:1px solid rgba(90,112,144,.4)}
.actions button{min-height:44px;min-width:96px}.actions a{display:inline-flex;align-items:center;min-height:44px}
}`;

export interface UpdateCardApi { reload(): Promise<void> | void; later(): void }

/**
 * Compact, NON-blocking card (never a dialog, pauses nothing; host has pointer-events none, only the card takes clicks) with two modes:
 *  - `update`: "A new version is available: 0.2.4" + highlights, buttons Reload now / Later;
 *  - `whatsnew`: one-time "What's new in 0.2.x" after a reload, with Full changelog + Close.
 * Fixed at the left under the top bar; hidden (display none) when dismissed. docs/pwa.md "Update card".
 */
export class StWhatsNew extends StElement {
  private card = document.createElement('div');
  private mode: 'update' | 'whatsnew' | null = null;

  protected css(): string {
    return `:host{position:fixed;left:8px;top:86px;width:320px;pointer-events:none;z-index:30}
:host([hidden]){display:none!important}
.card{pointer-events:auto;box-sizing:border-box;width:320px;max-height:min(420px,calc(100vh - 200px));overflow:auto;display:flex;flex-direction:column;gap:6px;padding:10px 12px 11px;font-size:calc(12.5px * var(--ui-scale, 1));background:var(--c-panel);border:1px solid #d9a441;border-radius:var(--r-md);box-shadow:0 4px 16px rgba(0,0,0,.4)}
.head{display:flex;align-items:flex-start;gap:6px}.head h3{margin:0;flex:1 1 auto;font-family:var(--font-display);font-weight:400;font-size:calc(15px * var(--ui-scale, 1));color:var(--c-accent-text);line-height:1.25}
.head button{padding:0 7px;line-height:18px;font-size:12px}
.wn-ver{margin:4px 0 0;font-size:calc(10.5px * var(--ui-scale, 1));letter-spacing:.5px;text-transform:uppercase;color:#7f93ad}
ul{margin:2px 0 0;padding-left:18px}li{margin:0 0 3px;line-height:1.4;color:#dce6f3}
.sub{color:#9fb4cc}.note{color:#f0c060}
.actions{display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap}.actions a{color:#ffd070;margin-right:auto}
.card[hidden]{display:none}
${FS_CSS}`;
  }

  constructor() {
    super();
    this.card.className = 'card'; this.card.setAttribute('role', 'status'); this.card.hidden = true;
    this.root.appendChild(this.card);
  }

  get showing(): boolean { return this.mode !== null && !this.card.hidden; }
  get currentMode(): 'update' | 'whatsnew' | null { return this.mode; }

  private txt(tag: string, cls: string, text: string): HTMLElement { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; }
  private btn(label: string, cls: string, fn: () => void): HTMLButtonElement { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.addEventListener('click', fn); return b; }
  private head(title: string, onClose: () => void): HTMLElement {
    const h = document.createElement('div'); h.className = 'head';
    const x = this.btn('\u2715', 'ghost close', onClose); x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss');
    h.append(this.txt('h3', '', title), x); return h;
  }

  /** A waiting service worker found a new version. `reload` should autosave then activate it; a veto leaves the card up. */
  showUpdate(m: UpdateCardModel, api: UpdateCardApi): void {
    this.mode = 'update'; this.toggleAttribute('data-fs', true); this.card.hidden = false; this.card.className = 'card update';
    const later = (): void => { this.dismiss(); api.later(); };
    const kids: HTMLElement[] = [this.head(m.title, later)];
    if (m.fallback) kids.push(this.txt('div', 'sub', 'Reload to get the latest improvements.'));
    else kids.push(highlightsList(m.sections));
    kids.push(this.txt('div', 'sub', 'Your game is autosaved first and resumes after the reload.'));
    const go = this.btn('Reload now', 'primary reload', () => { go.disabled = true; void Promise.resolve(api.reload()).finally(() => { go.disabled = false; }); });
    const lt = this.btn('Later', 'later', later);
    const actions = document.createElement('div'); actions.className = 'actions'; actions.append(go, lt);
    kids.push(actions);
    this.card.replaceChildren(...kids);
  }

  /** One-time card after the first launch of a new version. `changelogUrl` null hides the link. */
  showWhatsNew(sections: readonly WhatsNewEntry[], changelogUrl: string | null, onClose?: () => void): void {
    if (!sections.length) return;
    this.mode = 'whatsnew'; this.toggleAttribute('data-fs', true); this.card.hidden = false; this.card.className = 'card whatsnew';
    const close = (): void => { this.dismiss(); onClose?.(); };
    const actions = document.createElement('div'); actions.className = 'actions';
    if (changelogUrl) { const a = document.createElement('a'); a.href = changelogUrl; a.target = '_blank'; a.rel = 'noopener'; a.dataset.changelogLink = ''; a.textContent = 'Full changelog'; actions.append(a); }
    actions.append(this.btn('Close', 'primary close-btn', close));
    this.card.replaceChildren(this.head(`What\u2019s new in ${sections[0]!.version}`, close), highlightsList(sections), actions);
  }

  dismiss(): void { this.mode = null; this.removeAttribute('data-fs'); this.card.hidden = true; this.card.replaceChildren(); }
}
