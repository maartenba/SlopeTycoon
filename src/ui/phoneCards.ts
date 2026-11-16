/**
 * Phone card coordinator (docs/mobile-ui-v2.md 3.3). Phones (portrait <= 520 px wide, landscape <= 520 px high) get ONE floating card at a time:
 * `html[data-phone-mode]` = idle | tool | sheet | modal, computed from (a dialog is open, a map tool is active, a sheet-like card is open). Components
 * stay as they are; `styles.css` and the components read the attribute. The M7.5 `html[data-toolfirst]` / `html[data-camdrag]` stay the inputs / the
 * drag fade (set by touchWire); this module only DERIVES the mode from them and enforces the exclusivity of the sheet cards (drawer, inspector,
 * Rudi's advice, news, goals, the overflow menu): opening one closes the others.
 */
export type PhoneMode = 'idle' | 'tool' | 'sheet' | 'modal';
export const PHONE_MEDIA = '(max-width: 520px), (max-height: 520px)';

/** Pure: modal beats tool beats sheet beats idle. */
export function phoneMode(s: { modal: boolean; tool: boolean; sheet: boolean }): PhoneMode {
  return s.modal ? 'modal' : s.tool ? 'tool' : s.sheet ? 'sheet' : 'idle';
}

/** Pure: which chip the banner row shows at its left; the others become 44 px badges. Priority: goal / scenario chip > Rudi advice > news. Hidden outside `idle`. */
export type BannerChip = 'goal' | 'rudi' | 'news' | null;
export function bannerChip(s: { mode: PhoneMode; goal: boolean; rudi: boolean; news: boolean }): BannerChip {
  if (s.mode !== 'idle') return null;
  return s.goal ? 'goal' : s.rudi ? 'rudi' : s.news ? 'news' : null;
}

/** Pure: held toasts. While `held` (a tool is active on a phone) pushes queue up (max 6, oldest dropped); `release` hands them out one at a time. */
export class ToastHold<T> {
  private q: T[] = [];
  held = false;
  constructor(private readonly max = 6) {}
  /** True when the item must be shown now; false when it was queued. */
  offer(item: T): boolean { if (!this.held) return true; this.q.push(item); if (this.q.length > this.max) this.q.shift(); return false; }
  get size(): number { return this.q.length; }
  /** Next queued item while not held (undefined when empty or still held). */
  next(): T | undefined { return this.held ? undefined : this.q.shift(); }
}

export interface SheetCard { id: string; isOpen(): boolean; close(): void }

export interface PhoneCards {
  mode(): PhoneMode;
  /** Register a sheet-like card (exclusive with the others). */
  register(card: SheetCard): void;
  /** Re-evaluate now (events call this; a 250 ms poll covers the rest). */
  update(): void;
  isPhone(): boolean;
  /** Ids of the sheet cards that are open right now. */
  open(): string[];
  dispose(): void;
}

export interface PhoneCardsOpts {
  /** Number of open dialogs (default: modalStack.dialogs, injected by main.ts to keep this module DOM-light). */
  dialogs(): number;
  root?: HTMLElement;
}

export function installPhoneCards(o: PhoneCardsOpts): PhoneCards {
  const root = o.root ?? document.documentElement;
  const mq = typeof matchMedia === 'function' ? matchMedia(PHONE_MEDIA) : null;
  const cards: SheetCard[] = [];
  let openSet = new Set<string>();
  let cur: PhoneMode = 'idle';
  const isPhone = (): boolean => !!mq?.matches;
  const update = (): void => {
    const phone = isPhone();
    const now = new Set(cards.filter((c) => c.isOpen()).map((c) => c.id));
    if (phone) {
      const fresh = [...now].filter((id) => !openSet.has(id));
      if (fresh.length) { // the newest opened card wins: close every other open one
        const keep = fresh[fresh.length - 1]!;
        for (const c of cards) if (c.id !== keep && now.has(c.id)) { c.close(); now.delete(c.id); }
      }
    }
    openSet = now;
    if (phone && now.size) root.setAttribute('data-phone-card', [...now].join(' ')); else root.removeAttribute('data-phone-card');
    const mode = phone ? phoneMode({ modal: o.dialogs() > 0, tool: root.hasAttribute('data-toolfirst'), sheet: now.size > 0 }) : 'idle';
    if (mode !== cur || (phone && !root.hasAttribute('data-phone-mode')) || (!phone && root.hasAttribute('data-phone-mode'))) {
      cur = mode;
      if (phone) root.setAttribute('data-phone-mode', mode); else root.removeAttribute('data-phone-mode');
      window.dispatchEvent(new CustomEvent('st-phone-mode', { detail: { mode, phone } }));
    }
  };
  const t = window.setInterval(update, 250);
  const ev = (): void => update();
  window.addEventListener('st-sheet-snap', ev); window.addEventListener('pointerup', ev, true); window.addEventListener('click', ev, true); window.addEventListener('resize', ev);
  mq?.addEventListener?.('change', ev);
  update();
  return {
    mode: () => cur,
    register: (c) => { cards.push(c); },
    update, isPhone, open: () => [...openSet],
    dispose() { window.clearInterval(t); window.removeEventListener('st-sheet-snap', ev); window.removeEventListener('pointerup', ev, true); window.removeEventListener('click', ev, true); window.removeEventListener('resize', ev); mq?.removeEventListener?.('change', ev); root.removeAttribute('data-phone-mode'); },
  };
}
