import { describe, it, expect, vi } from 'vitest';
import { registerSW, canRegister, watchOnline, watchInstall, type SwContainer, type SwReg } from '../../src/pwa/registerSW';

function mkSw(controller: unknown = {}) {
  const l: Record<string, () => void> = {}, wl: Record<string, () => void> = {};
  const worker = { state: 'installing', addEventListener: (_t: 'statechange', fn: () => void) => { wl.statechange = fn; } };
  const posted: unknown[] = [];
  const reg: SwReg & { waiting: SwReg['waiting'] } = {
    waiting: null, installing: null, unregister: vi.fn(async () => true),
    addEventListener: (t, fn) => { l[t] = fn; },
  };
  const sw: SwContainer = { controller, register: vi.fn(async () => reg), getRegistrations: vi.fn(async () => [reg]), addEventListener: (t, fn) => { l[t] = fn; } };
  const foundUpdate = () => { reg.installing = worker; l.updatefound!(); worker.state = 'installed'; reg.waiting = { postMessage: (m) => posted.push(m) }; wl.statechange!(); };
  return { sw, reg, l, posted, foundUpdate };
}
const base = (sw?: SwContainer, over = {}) => ({ prod: true, navigator: { serviceWorker: sw }, protocol: 'https:', hostname: 'x.test', onUpdate: vi.fn(), reload: vi.fn(), ...over });

describe('registerSW', () => {
  it('canRegister: https or localhost http only', () => {
    expect(canRegister('https:', 'a.b')).toBe(true); expect(canRegister('http:', 'localhost')).toBe(true);
    expect(canRegister('http:', 'a.b')).toBe(false); expect(canRegister('file:', '')).toBe(false);
  });
  it('unsupported browser', async () => { expect(await registerSW(base(undefined))).toBe('unsupported'); });
  it('dev: no registration, stale SW + our caches removed', async () => {
    const m = mkSw(); const del = vi.fn(async () => true);
    const d = await registerSW(base(m.sw, { prod: false, cachesApi: { keys: async () => ['slope-tycoon-1', 'keep'], delete: del } }));
    expect(d).toBe('dev-cleanup'); expect(m.sw.register).not.toHaveBeenCalled(); expect(m.reg.unregister).toHaveBeenCalled(); expect(del).toHaveBeenCalledWith('slope-tycoon-1'); expect(del).toHaveBeenCalledTimes(1);
  });
  it('insecure origin does not register', async () => { const m = mkSw(); expect(await registerSW(base(m.sw, { protocol: 'http:' }))).toBe('insecure'); expect(m.sw.register).not.toHaveBeenCalled(); });
  it('prod registers ./sw.js with ./ scope', async () => {
    const m = mkSw(); expect(await registerSW(base(m.sw))).toBe('registered'); expect(m.sw.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });
  it('first install (no controller) never prompts and never reloads', async () => {
    const m = mkSw(null); const env = base(m.sw); await registerSW(env); m.foundUpdate(); m.l.controllerchange!();
    expect(env.onUpdate).not.toHaveBeenCalled(); expect(env.reload).not.toHaveBeenCalled();
  });
  it('update flow: prompt, save, SKIP_WAITING, one reload only after accept', async () => {
    const m = mkSw(); const beforeApply = vi.fn(async () => true); const env = base(m.sw, { beforeApply });
    await registerSW(env); m.l.controllerchange!(); expect(env.reload).not.toHaveBeenCalled(); // claim-style change: ignore
    m.foundUpdate(); expect(env.onUpdate).toHaveBeenCalledTimes(1);
    const apply = env.onUpdate.mock.calls[0]![0] as () => Promise<boolean>;
    expect(await apply()).toBe(true); expect(beforeApply).toHaveBeenCalledTimes(1); expect(m.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    m.l.controllerchange!(); m.l.controllerchange!(); expect(env.reload).toHaveBeenCalledTimes(1); // no reload loop
  });
  it('save veto blocks activation', async () => {
    const m = mkSw(); const env = base(m.sw, { beforeApply: async () => false }); await registerSW(env); m.foundUpdate();
    expect(await (env.onUpdate.mock.calls[0]![0] as () => Promise<boolean>)()).toBe(false); expect(m.posted).toEqual([]);
  });
  it('already-waiting worker at startup prompts', async () => {
    const m = mkSw(); m.reg.waiting = { postMessage: () => undefined }; const env = base(m.sw); await registerSW(env); expect(env.onUpdate).toHaveBeenCalled();
  });
});

describe('online / install watchers', () => {
  it('reports offline transitions', () => {
    const l: Record<string, () => void> = {}; let online = true; const seen: boolean[] = [];
    const off = watchOnline({ addEventListener: (t, f) => { l[t] = f; }, removeEventListener: () => undefined }, () => online, (o) => seen.push(o));
    online = false; l.offline!(); online = true; l.online!(); off(); expect(seen).toEqual([false, true, false]);
  });
  it('captures beforeinstallprompt and clears after install', async () => {
    const l: Record<string, (e: unknown) => void> = {}; const calls: Array<unknown> = [];
    watchInstall({ addEventListener: (t, f) => { l[t] = f; } }, (i) => calls.push(i));
    const prevent = vi.fn(), prompt = vi.fn(async () => undefined);
    l.beforeinstallprompt!({ preventDefault: prevent, prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    expect(prevent).toHaveBeenCalled(); expect(typeof calls[0]).toBe('function');
    await (calls[0] as () => Promise<void>)(); expect(prompt).toHaveBeenCalled(); expect(calls[1]).toBeNull();
  });
});

import { ToastLimiter } from '../../src/ui/toastLimiter';
describe('update toast (limiter)', () => {
  it('important toast keeps its action and custom ttl', () => {
    const l = new ToastLimiter(); const run = vi.fn();
    expect(l.push({ key: 'pwa:update', text: 'Update available — reload', severity: 'good', tier: 'important', ttlMs: 600000, action: { label: 'Reload', run } }, 0)).toBe('shown');
    const t = l.visible(100000)[0]!; expect(t.action!.label).toBe('Reload'); t.action!.run(); expect(run).toHaveBeenCalled();
  });
});
