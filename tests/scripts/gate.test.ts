import { describe, expect, it } from 'vitest';
import { estimate, exitCode, failedFilesFromVitestJson, runGate, validate, withDeps, type Exec, type GateEvent, type StageDef } from '../../scripts/lib/gateRunner';
import { ALL, BALANCE, E2E, FULL, STAGES, fastSelection, stagesForPaths } from '../../scripts/lib/gateStages';
import { distProblem } from '../../scripts/lib/dist-guard';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const st = (id: string, o: Partial<StageDef> = {}): StageDef => ({ id, cmd: id, slots: 1, est: 1, ...o });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Fake exec: records start/end order and the max concurrent slots. */
function fake(o: { ms?: Record<string, number>; fail?: Record<string, number[]>; files?: Record<string, string[]> } = {}) {
  const log: string[] = [], calls: Record<string, number> = {}, cmds: Array<[string, string | undefined]> = [];
  let used = 0, peak = 0; const slotsById = new Map<string, number>();
  const exec: Exec = async (s, attempt, override) => {
    calls[s.id] = (calls[s.id] ?? 0) + 1; cmds.push([s.id, override]);
    const w = Math.min(s.slots, 4); used += w; peak = Math.max(peak, used); slotsById.set(s.id, w); log.push(`+${s.id}`);
    await sleep(o.ms?.[s.id] ?? 5);
    used -= Math.min(s.slots, 4); log.push(`-${s.id}`);
    const failOn = o.fail?.[s.id] ?? [];
    return failOn.includes(attempt) ? { code: 1, failedFiles: o.files?.[s.id] } : { code: 0 };
  };
  return { exec, log, calls, cmds, peak: () => peak };
}

describe('gate DAG scheduler', () => {
  it('validates ids, unknown needs and cycles', () => {
    expect(() => validate([st('a'), st('a')])).toThrow(/duplicate/);
    expect(() => validate([st('a', { needs: ['zz'] })])).toThrow(/unknown/);
    expect(() => validate([st('a', { needs: ['b'] }), st('b', { needs: ['a'] })])).toThrow(/cycle/);
  });
  it('withDeps pulls in transitive needs only', () => {
    const all = [st('build'), st('pwa', { needs: ['build'] }), st('e2e', { needs: ['pwa'] }), st('lint')];
    expect(withDeps(all, ['e2e']).map((s) => s.id)).toEqual(['build', 'pwa', 'e2e']);
  });
  it('runs a stage only after its dependencies passed', async () => {
    const f = fake();
    const r = await runGate([st('build'), st('pwa', { needs: ['build'] }), st('e2e', { needs: ['pwa'] })], { jobs: 4, exec: f.exec });
    expect(f.log).toEqual(['+build', '-build', '+pwa', '-pwa', '+e2e', '-e2e']);
    expect(r.every((x) => x.status === 'pass')).toBe(true);
  });
  it('never exceeds the slot cap and clamps stages wider than the cap', async () => {
    const f = fake({ ms: { a: 20, b: 20, c: 20, d: 20, big: 20 } });
    const stages = [st('a', { slots: 3 }), st('b', { slots: 3 }), st('c', { slots: 1 }), st('d', { slots: 2 }), st('big', { slots: 9 })];
    await runGate(stages, { jobs: 4, exec: f.exec });
    expect(f.peak()).toBeLessThanOrEqual(4);
    const g = fake({ ms: { a: 15, b: 15 } });
    await runGate([st('a', { slots: 1 }), st('b', { slots: 1 })], { jobs: 2, exec: g.exec });
    expect(g.peak()).toBe(2); // both fit, so they overlap
  });
  it('starts the longest ready stage first', async () => {
    const f = fake(); const started: string[] = [];
    await runGate([st('short', { est: 1 }), st('long', { est: 100 }), st('mid', { est: 10 })], { jobs: 1, exec: f.exec, onEvent: (e: GateEvent) => { if (e.type === 'start') started.push(e.id); } });
    expect(started).toEqual(['long', 'mid', 'short']);
  });
  it('runs exclusive stages alone and last', async () => {
    const f = fake({ ms: { a: 10, b: 30, perf: 10, flick: 10 } });
    await runGate([st('perf', { exclusive: true, slots: 4 }), st('a'), st('flick', { exclusive: true }), st('b')], { jobs: 4, exec: f.exec });
    const iPerf = f.log.indexOf('+perf'), iFlick = f.log.indexOf('+flick'), lastNormal = Math.max(f.log.indexOf('-a'), f.log.indexOf('-b'));
    expect(Math.min(iPerf, iFlick)).toBeGreaterThan(lastNormal);
    // alone: the first exclusive ends before the second starts
    expect(Math.abs(iPerf - iFlick)).toBeGreaterThan(1);
    expect(f.log.slice(Math.min(iPerf, iFlick), Math.min(iPerf, iFlick) + 2)[1]).toMatch(/^-/);
  });
  it('retries a failed stage once and reports it flaky when the retry passes', async () => {
    const f = fake({ fail: { a: [1] } });
    const r = await runGate([st('a')], { jobs: 2, exec: f.exec });
    expect(f.calls.a).toBe(2); expect(r[0]).toMatchObject({ status: 'pass', flaky: true, attempts: 2 }); expect(exitCode(r)).toBe(0);
  });
  it('a stage failing twice fails the gate and skips its dependants, but not unrelated stages', async () => {
    const f = fake({ fail: { a: [1, 2] } });
    const r = await runGate([st('a'), st('b', { needs: ['a'] }), st('c', { needs: ['b'] }), st('d')], { jobs: 2, exec: f.exec });
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(f.calls.a).toBe(2); expect(by.a!.status).toBe('fail'); expect(by.b!.status).toBe('skipped'); expect(by.c!.status).toBe('skipped'); expect(by.d!.status).toBe('pass');
    expect(f.calls.b).toBeUndefined(); expect(exitCode(r)).toBe(1);
  });
  it('a vitest stage retries only the failing files', async () => {
    const f = fake({ fail: { t: [1] }, files: { t: ['tests/x.test.ts', 'tests/y.test.ts'] } });
    const r = await runGate([st('t', { vitest: { retryCmd: (files) => `vitest ${files.join(' ')}` } })], { jobs: 4, exec: f.exec });
    expect(f.cmds).toEqual([['t', undefined], ['t', 'vitest tests/x.test.ts tests/y.test.ts']]);
    expect(r[0]!.flaky).toBe(true);
  });
  it('a vitest stage with no parsable failing files re-runs the whole stage', async () => {
    const f = fake({ fail: { t: [1] } });
    await runGate([st('t', { vitest: { retryCmd: () => 'never' } })], { jobs: 4, exec: f.exec });
    expect(f.cmds[1]).toEqual(['t', undefined]);
  });
  it('exit code is 0 only when everything passed (flaky counts as passed)', () => {
    const base = { flaky: false, wallS: 1, attempts: 1, startedAt: 0 };
    expect(exitCode([{ id: 'a', status: 'pass', ...base }, { id: 'b', status: 'pass', ...base, flaky: true }])).toBe(0);
    expect(exitCode([{ id: 'a', status: 'pass', ...base }, { id: 'b', status: 'skipped', ...base }])).toBe(1);
  });
  it('estimate: parallel plan is shorter than serial and puts exclusive stages at the end', () => {
    const s = [st('a', { est: 10 }), st('b', { est: 10 }), st('p', { est: 5, exclusive: true, slots: 4 })];
    expect(estimate(s, 2)).toBe(15); expect(estimate(s, 1)).toBe(25);
  });
  it('parses the failing files from a vitest JSON report', () => {
    const j = JSON.stringify({ testResults: [{ name: '/r/tests/a.test.ts', status: 'passed' }, { name: '/r/tests/b.test.ts', status: 'failed' }] });
    expect(failedFilesFromVitestJson(j, '/r')).toEqual(['tests/b.test.ts']);
    expect(failedFilesFromVitestJson('garbage', '/r')).toEqual([]);
  });
});

describe('gate stage table and --since path mapping', () => {
  it('is a valid DAG with the required shape', () => {
    validate(STAGES);
    const by = new Map(STAGES.map((s) => [s.id, s]));
    expect(by.get('test:perf')!.exclusive && by.get('flicker')!.exclusive).toBe(true);
    for (const id of E2E) expect(by.get(id)!.needs).toEqual(['verify:pwa']);
    expect(by.get('verify:pwa')!.needs).toEqual(['build']);
    expect(by.get('verify:site')!.needs).toEqual(['site:check']); expect(by.get('site:check')!.needs).toEqual(['build:site']);
    expect(by.get('test')!.slots).toBe(4); expect(by.get('analytics:e2e')!.slots).toBe(3); expect(by.get('typecheck')!.slots).toBe(1);
    expect(FULL.every((i) => ALL.includes(i))).toBe(true);
    for (const id of [...E2E, 'shot:suite', 'mobile:audit', 'touch:e2e', 'desktop:diff', 'flicker', 'test:perf', ...BALANCE]) expect(FULL).toContain(id);
  });
  it('docs only: the repo tests, nothing else', () => { expect([...stagesForPaths(['docs/gate-speed.md', 'CHANGELOG.md']).ids]).toEqual(['test:repo']); });
  it('site only: the site gate + site/repo tests, no build', () => {
    const s = stagesForPaths(['site/guide/x.md']).ids;
    for (const i of ['site:og', 'docs:img', 'build:site', 'site:check', 'verify:site', 'test:site', 'test:repo']) expect(s.has(i)).toBe(true);
    expect(s.has('build')).toBe(false); expect(s.has('test')).toBe(false);
  });
  it('src/render: render tests, shots, flicker, desktop diff and the rendering sanities; not balance', () => {
    const s = stagesForPaths(['src/render/Renderer.ts']).ids;
    for (const i of ['test:render', 'shot:suite', 'flicker', 'desktop:diff', 'play:sanity', 'build', 'verify:pwa']) expect(s.has(i)).toBe(true);
    for (const b of BALANCE) expect(s.has(b)).toBe(false);
  });
  it('src/sim and src/config: everything including balance', () => {
    for (const f of ['src/sim/Economy.ts', 'src/config/prices.ts']) { const s = stagesForPaths([f]).ids; for (const i of FULL) expect(s.has(i)).toBe(true); }
  });
  it('src/audio: audio tests and the music / menu-music / sfx e2e', () => {
    const s = stagesForPaths(['src/audio/Sfx.ts']).ids;
    for (const i of ['test:audio', 'music:e2e', 'menu-music:e2e', 'sfx:e2e', 'build']) expect(s.has(i)).toBe(true);
    expect(s.has('analytics:e2e')).toBe(false); expect(s.has('flicker')).toBe(false);
  });
  it('scripts/promo: typecheck, lint, script tests only', () => { expect([...stagesForPaths(['scripts/promo/cut.ts']).ids].sort()).toEqual(['lint', 'test:scripts', 'typecheck']); });
  it('package.json and vite config: the full gate', () => {
    for (const f of ['package.json', 'vite.config.ts']) expect(stagesForPaths([f]).ids.size).toBe(FULL.length);
  });
  it('fast tier: the basics, the site gate only when site/docs changed, plus mapped sanities', () => {
    const plain = fastSelection(['src/render/x.ts']).ids;
    for (const i of ['typecheck', 'lint', 'test', 'build', 'verify:pwa', 'play:sanity']) expect(plain.has(i)).toBe(true);
    expect(plain.has('site:og')).toBe(false); expect(plain.has('shot:suite')).toBe(false);
    expect(fastSelection(['docs/a.md']).ids.has('verify:site')).toBe(true);
  });
});

describe('dist guard', () => {
  it('fails on a missing dist and on a dist older than the sources; passes when fresh', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-dist-'));
    expect(distProblem(root, false)).toMatch(/missing/);
    mkdirSync(join(root, 'dist')); mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'dist/index.html'), ''); writeFileSync(join(root, 'dist/sw.js'), ''); writeFileSync(join(root, 'src/a.ts'), '');
    const t = (n: number): Date => new Date(Date.now() + n * 1000);
    utimesSync(join(root, 'src/a.ts'), t(-60), t(-60)); utimesSync(join(root, 'dist/sw.js'), t(-10), t(-10));
    expect(distProblem(root, false)).toBe('');
    utimesSync(join(root, 'src/a.ts'), t(5), t(5));
    expect(distProblem(root, false)).toMatch(/stale/);
    expect(distProblem(root, true)).toBe('');
  });
});

describe('dev-build detection', () => {
  it('flags a dist whose bundle has prod:false (built under NODE_ENV=development) and accepts a production one', async () => {
    const { devBuildProblem } = await import('../../scripts/lib/dist-guard');
    const d = mkdtempSync(join(tmpdir(), 'gate-dev-')); mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'assets/index-abc.js'), 'registerSW({prod:!1,navigator:n})');
    expect(devBuildProblem(d)).toMatch(/DEVELOPMENT build/);
    writeFileSync(join(d, 'assets/index-abc.js'), 'registerSW({prod:!0,navigator:n})');
    expect(devBuildProblem(d)).toBe('');
  });
});
