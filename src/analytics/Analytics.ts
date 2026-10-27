import { readConsent, writeConsent, type Consent, type StorageLike } from './consent';
import { DEFAULT_EVENT_CAP, EVENT_CAPS, sanitizeEvent, type AnalyticsEventName } from './events';

/** Google Analytics 4 measurement ID (owner decision) + the only script this module may ever load. */
export const GA_ID = 'G-NX37ERE0S9';
export const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
/** Hosts the analytics module may talk to (docs/analytics.md; a repo test checks that no other source file names them). */
export const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com'] as const;

export const SESSION_EVENT_CAP = 200;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 30;

export interface ScriptLike { src: string; async: boolean; onerror: ((e?: unknown) => void) | null; onload: ((e?: unknown) => void) | null; setAttribute?(k: string, v: string): void }
export interface AnalyticsEnv {
  /** Environment gate (`analyticsAllowed`): false in dev, tests, localhost, headless browsers, `?analytics=0`. */
  enabled: boolean;
  storage: StorageLike | null;
  /** The page's global object (receives `dataLayer`, `gtag`, `ga-disable-*`). */
  win: Record<string, unknown>;
  createScript(): ScriptLike;
  appendScript(s: ScriptLike): void;
  online(): boolean;
  /** Called once from `init()`: fire `cb` whenever the browser comes back online. */
  onOnline(cb: () => void): void;
  now(): number;
  clearCookies?(): void;
}

type State = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * The only code in the game that talks to Google Analytics. Guarantees (tested):
 * - nothing is loaded, queued or sent until consent === 'granted' AND the environment gate is open;
 * - the gtag script is injected lazily, never awaited, never throws, never blocks boot; failure is silent (no retry storm: 2 attempts, one per 'online');
 * - offline: nothing is injected and events are dropped (no persistent queue); the script loads when back online, only with consent;
 * - events are whitelisted (`events.ts`), rate limited and capped per session.
 */
export class Analytics {
  private state: State = 'idle';
  private attempts = 0;
  private memory: Consent = null;
  private total = 0;
  private perName = new Map<string, number>();
  private stamps: number[] = [];
  private listeners = new Set<(c: Consent) => void>();
  private inited = false;
  /** Count of events accepted (pushed to the data layer) this session. */
  get sent(): number { return this.total; }
  get loadState(): State { return this.state; }

  constructor(private readonly env: AnalyticsEnv) {}

  /** Environment gate. When false the module is inert (the consent UI still works so the choice is remembered). */
  get enabled(): boolean { return this.env.enabled; }
  consent(): Consent { return readConsent(this.env.storage) ?? this.memory; }
  subscribe(fn: (c: Consent) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Call once at boot: loads the script when consent was already granted and we are online; never throws. */
  init(): void {
    if (this.inited) return;
    this.inited = true;
    try {
      this.env.onOnline(() => { if (this.canSend() && (this.state === 'idle' || this.state === 'failed')) this.load(); });
      if (this.canSend()) this.load();
    } catch { /* analytics must never affect the game */ }
  }

  setConsent(v: 'granted' | 'denied'): void {
    try {
      if (!writeConsent(this.env.storage, v)) this.memory = v;
      else this.memory = null;
      if (v === 'granted') {
        this.env.win[`ga-disable-${GA_ID}`] = false;
        if (this.state === 'loaded' || this.state === 'loading') this.gtag('consent', 'update', { analytics_storage: 'granted' });
        else if (this.canSend()) this.load();
      } else {
        this.env.win[`ga-disable-${GA_ID}`] = true;
        if (this.state !== 'idle') this.gtag('consent', 'update', { analytics_storage: 'denied' });
        try { this.env.clearCookies?.(); } catch { /* ignore */ }
      }
      for (const l of [...this.listeners]) { try { l(v); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }

  private canSend(): boolean { return this.env.enabled && this.consent() === 'granted'; }

  /** Queue one event. Returns true when it was handed to gtag (i.e. consent, environment, network, caps and the whitelist all allowed it). */
  track(name: AnalyticsEventName | string, params: Record<string, unknown> = {}): boolean {
    try {
      if (!this.canSend()) return false;
      const ev = sanitizeEvent(name, params);
      if (!ev) return false;
      if (!this.env.online()) return false; // offline: dropped, never queued
      if (this.total >= SESSION_EVENT_CAP) return false;
      const n = this.perName.get(ev.name) ?? 0;
      if (n >= (EVENT_CAPS[ev.name] ?? DEFAULT_EVENT_CAP)) return false;
      const now = this.env.now();
      this.stamps = this.stamps.filter((t) => now - t < RATE_WINDOW_MS);
      if (this.stamps.length >= RATE_MAX) return false;
      if (this.state === 'idle' || this.state === 'failed') this.load();
      if (this.state === 'failed' || this.state === 'idle') return false;
      this.stamps.push(now); this.perName.set(ev.name, n + 1); this.total++;
      this.gtag('event', ev.name, ev.params);
      return true;
    } catch { return false; }
  }

  private gtag(...args: unknown[]): void {
    const w = this.env.win;
    const dl = (w.dataLayer ??= []) as unknown[];
    // gtag.js needs the real `arguments` object (an array is ignored), hence the classic function.
    const g = (w.gtag ??= function gtag(): void { // eslint-disable-next-line prefer-rest-params
      dl.push(arguments);
    }) as (...a: unknown[]) => void;
    g(...args);
  }

  private load(): void {
    if (this.state === 'loading' || this.state === 'loaded' || this.attempts >= 2 || !this.env.online()) return;
    this.attempts++;
    try {
      this.state = 'loading';
      if (this.attempts === 1) {
        // Consent Mode v2: everything denied by default, then analytics_storage granted (we only get here with consent).
        this.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
        this.gtag('consent', 'update', { analytics_storage: 'granted' });
        this.gtag('js', new Date(this.env.now()));
        this.gtag('config', GA_ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, transport_type: 'beacon' });
      }
      const s = this.env.createScript();
      s.async = true; s.src = GA_SCRIPT_URL;
      s.onload = (): void => { this.state = 'loaded'; };
      s.onerror = (): void => { this.state = 'failed'; };
      this.env.appendScript(s);
    } catch { this.state = 'failed'; }
  }
}
