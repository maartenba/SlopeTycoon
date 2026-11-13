/** Guaranteed teardown for the puppeteer e2e scripts (docs/gate-speed.md "Hang guard").
 * A 14-minute hang after the final OK in a gate run came from `browser.close()` / a keep-alive socket never settling; the fix is to never wait on them unbounded:
 *  1. print the marker `[e2e-done] code=N` (the gate runner treats a process that outlives it by 60 s as HANG),
 *  2. close the browser with a 10 s grace, then SIGKILL its own Chrome PID (never a broad kill),
 *  3. close the HTTP server and its connections,
 *  4. `process.exit(code)`, with an unref'd watchdog that lists the active handles after 20 s (diagnostics for the next leak). */
import type { Browser } from 'puppeteer-core';
import type { Server } from 'node:http';

export const E2E_DONE = '[e2e-done]';
export const withTimeout = async <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<T>((r) => { t = setTimeout(() => r(fallback), ms); })]); } finally { if (t) clearTimeout(t); }
};
export async function closeBrowser(browser: Browser | undefined, graceMs = 10000): Promise<void> {
  if (!browser) return;
  const proc = browser.process();
  const closed = await withTimeout(browser.close().then(() => true, () => true), graceMs, false);
  if (!closed && proc?.pid) { try { process.kill(proc.pid, 'SIGKILL'); } catch { /* gone */ } }
}
export function closeServer(server: Pick<Server, 'close'> & { closeAllConnections?: () => void; listening?: boolean } | undefined): void {
  if (!server) return;
  try { server.closeAllConnections?.(); } catch { /* ignore */ }
  try { if (server.listening !== false) server.close(); } catch { /* already closed */ }
}
export function startWatchdog(): void {
  const t = setTimeout(() => {
    const h = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    console.error(`[e2e-watchdog] still alive 20 s after teardown; active handles: ${h.map((x) => (x as { constructor?: { name?: string } }).constructor?.name ?? '?').join(', ')}`);
  }, 20000);
  t.unref();
}
/** Print the done marker, tear everything down, exit with `code`. Never returns. */
export async function finishE2e(code: number, browser?: Browser, server?: Parameters<typeof closeServer>[0]): Promise<never> {
  console.log(`${E2E_DONE} code=${code}`);
  startWatchdog();
  const hard = setTimeout(() => process.exit(code), 10000); // safety net: exit even if a close promise never settles
  await closeBrowser(browser); closeServer(server);
  clearTimeout(hard);
  process.exit(code);
}
