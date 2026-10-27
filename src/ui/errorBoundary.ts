/**
 * Global error boundary (Task 35): `error` and `unhandledrejection` never crash the page. A friendly toast offers 'Copy details'; the
 * error is logged with console.error exactly once per distinct message (so a runaway loop cannot flood the console or the toasts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BoundaryHost {
  addEventListener(type: string, fn: (e: any) => void): void;
  removeEventListener(type: string, fn: (e: any) => void): void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
export interface BoundaryOptions {
  /** Show a toast; `copy` copies the details text (clipboard). */
  notify(text: string, action: { label: string; run: () => void }): void;
  copy?(text: string): void;
  log?(...a: unknown[]): void;
  /** Max distinct errors reported per session (default 5). */
  max?: number;
  /** Called once per distinct reported error with its class only (analytics: never the message). */
  onReport?(kind: 'error' | 'unhandledrejection'): void;
}

export function describeUnknown(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`;
  try { return typeof e === 'string' ? e : JSON.stringify(e); } catch { return String(e); }
}

export function installErrorBoundary(host: BoundaryHost, o: BoundaryOptions): () => void {
  const seen = new Set<string>();
  const log = o.log ?? ((...a: unknown[]) => console.error(...a));
  const report = (err: unknown, where: string): void => {
    const details = `${where}: ${describeUnknown(err)}`;
    const key = details.split('\n')[0]!;
    if (seen.has(key) || seen.size >= (o.max ?? 5)) return;
    seen.add(key);
    try { o.onReport?.(where === 'error' ? 'error' : 'unhandledrejection'); } catch { /* ignore */ }
    log('[Slope Tycoon] unexpected error', details);
    o.notify('Something went wrong, but the game keeps running. You may want to save.', { label: 'Copy details', run: () => o.copy?.(details) });
  };
  const onError = (e: { error?: unknown; message?: string }): void => report(e.error ?? e.message ?? 'unknown error', 'error');
  const onRej = (e: { reason?: unknown }): void => report(e.reason, 'unhandledrejection');
  host.addEventListener('error', onError as never);
  host.addEventListener('unhandledrejection', onRej as never);
  return () => { host.removeEventListener('error', onError as never); host.removeEventListener('unhandledrejection', onRej as never); };
}
