/**
 * Service-worker registration + update flow (Task 34). All environment access is injected so it is unit-testable.
 * Production only; in dev any stale SW/caches from an earlier preview are removed so HMR is never served from cache.
 */
export interface SwReg {
  waiting: { postMessage(m: unknown): void } | null;
  installing: { state: string; addEventListener(t: 'statechange', fn: () => void): void } | null;
  addEventListener(t: 'updatefound', fn: () => void): void;
  unregister(): Promise<boolean>;
}
export interface SwContainer {
  controller: unknown;
  register(url: string, o?: { scope?: string }): Promise<SwReg>;
  getRegistrations?(): Promise<readonly SwReg[]>;
  addEventListener(t: 'controllerchange', fn: () => void): void;
}
export interface PwaEnv {
  prod: boolean;
  navigator: { serviceWorker?: SwContainer };
  protocol: string;
  hostname: string;
  /** Called when a new version is installed and waiting. `apply()` saves (via `beforeApply`) then activates it and reloads. */
  onUpdate(apply: () => Promise<boolean>): void;
  /** Persist the running game; return false to veto the update (e.g. nothing could be saved). */
  beforeApply?: () => Promise<boolean>;
  reload(): void;
  cachesApi?: { keys(): Promise<string[]>; delete(n: string): Promise<boolean> };
}
export type PwaDecision = 'registered' | 'dev-cleanup' | 'unsupported' | 'insecure';

export function canRegister(protocol: string, hostname: string): boolean {
  return protocol === 'https:' || (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'));
}

export async function registerSW(env: PwaEnv): Promise<PwaDecision> {
  const sw = env.navigator.serviceWorker;
  if (!sw) return 'unsupported';
  if (!env.prod) {
    try {
      for (const r of (await sw.getRegistrations?.()) ?? []) await r.unregister();
      for (const k of (await env.cachesApi?.keys()) ?? []) if (k.startsWith('slope-tycoon-')) await env.cachesApi!.delete(k);
    } catch { /* best effort */ }
    return 'dev-cleanup';
  }
  if (!canRegister(env.protocol, env.hostname)) return 'insecure';

  let applying = false, reloaded = false;
  // Reload only after the USER accepted an update (first-install clients.claim() also fires controllerchange: must not reload then).
  sw.addEventListener('controllerchange', () => { if (applying && !reloaded) { reloaded = true; env.reload(); } });
  const announce = (reg: SwReg): void => {
    env.onUpdate(async () => {
      if (applying) return true;
      if (env.beforeApply && !(await env.beforeApply())) return false;
      applying = true;
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      return true;
    });
  };
  const reg = await sw.register('./sw.js', { scope: './' });
  if (reg.waiting && sw.controller) announce(reg);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) announce(reg); });
  });
  return 'registered';
}

/** Online/offline status (events injected for tests). Returns an unsubscribe. */
export function watchOnline(target: { addEventListener(t: string, fn: () => void): void; removeEventListener(t: string, fn: () => void): void }, isOnline: () => boolean, cb: (offline: boolean) => void): () => void {
  const f = (): void => cb(!isOnline());
  target.addEventListener('online', f); target.addEventListener('offline', f); f();
  return () => { target.removeEventListener('online', f); target.removeEventListener('offline', f); };
}

export interface InstallPromptEvent { preventDefault(): void; prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
/** Captures `beforeinstallprompt`; `cb(install | null)` fires when an install becomes available / is done. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function watchInstall(target: { addEventListener(t: string, fn: (e: any) => void): void }, cb: (install: (() => Promise<void>) | null) => void): void {
  target.addEventListener('beforeinstallprompt', ((e: InstallPromptEvent) => {
    e.preventDefault();
    cb(async () => { cb(null); await e.prompt(); await e.userChoice; });
  }) as never);
  target.addEventListener('appinstalled', (() => cb(null)) as never);
}
