/* `npm run gate` (docs/gate-speed.md): the LOCAL release gate as a DAG with a CPU-slot budget, per-stage logs, retry-once (flaky) and a summary.
 *   npm run gate                      default tier = path-based stages from changes vs HEAD (or HEAD~1 when the tree is clean)
 *   npm run gate:fast | gate:full     --fast / --full
 *   npm run gate -- --since <ref> [--dry] [--jobs N] [--only a,b] [--skip x] [--list]
 * Output: .weave/gate/<run>/<stage>.log, summary.md, summary.json. Only spawns its own child process groups (killed by PID on timeout / Ctrl-C). */
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { estimate, exitCode, failedFilesFromVitestJson, runGate, withDeps, type ExecResult, type StageDef, type StageResult } from './lib/gateRunner';
import { ALL, DEFAULT_JOBS, FULL, STAGES, fastSelection, stagesForPaths } from './lib/gateStages';

const args = process.argv.slice(2);
const flag = (k: string): boolean => args.includes(k);
const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const list = (k: string): string[] => (val(k) ?? '').split(',').filter(Boolean);
const root = process.cwd(), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const sh = (cmd: string, ...a: string[]): string => { try { return execFileSync(cmd, a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const jobs = Number(val('--jobs') ?? DEFAULT_JOBS);

function changedFiles(since?: string): { files: string[]; ref: string } {
  let ref = since ?? 'HEAD';
  const names = (r: string): string[] => sh('git', 'diff', '--name-only', r).split('\n').concat(sh('git', 'ls-files', '-o', '--exclude-standard').split('\n')).filter(Boolean);
  let files = names(ref);
  if (!since && !files.length) { ref = 'HEAD~1'; files = names(ref); } // clean tree: the last commit
  return { files, ref };
}

if (flag('--list')) { for (const s of STAGES) console.log(`${s.id.padEnd(22)} slots ${s.slots}${s.exclusive ? ' exclusive' : ''} est ${s.est}s${s.needs?.length ? ` needs ${s.needs.join(',')}` : ''}  ${s.cmd}`); process.exit(0); }

// ---- selection
let selected: string[], why: string[], baseRef = '';
if (flag('--full')) { selected = FULL; why = ['full tier (the release gate)']; }
else if (flag('--fast')) { const c = changedFiles(val('--since')); baseRef = c.ref; const s = fastSelection(c.files); selected = [...s.ids]; why = s.reason; }
else { const c = changedFiles(val('--since')); baseRef = c.ref; const s = stagesForPaths(c.files); selected = [...s.ids]; why = [`${c.files.length} file(s) changed vs ${c.ref}`, ...s.reason]; }
if (list('--only').length) { selected = list('--only'); why.push('--only'); }
const skip = new Set(list('--skip'));
const unknown = [...selected, ...skip].filter((i) => !ALL.includes(i));
if (unknown.length) { console.error(`unknown stage(s): ${unknown.join(', ')} (see --list)`); process.exit(2); }
selected = selected.filter((i) => !skip.has(i));
if (selected.includes('test')) selected = selected.filter((i) => !/^test:(repo|site|scripts|render|audio)$/.test(i)); // the whole suite covers the partial ones
const plan: StageDef[] = withDeps(STAGES, selected); // a skipped stage that a selected one needs comes back (its dependency)

// ---- estimates from the last run
const estFile = '.weave/gate/estimates.json';
const last: Record<string, number> = existsSync(estFile) ? JSON.parse(readFileSync(estFile, 'utf8')) : {};
const est = (s: StageDef): number => last[s.id] ?? s.est;
const total = estimate(plan, jobs, est);
const fmt = (s: number): string => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);

if (flag('--dry')) {
  console.log(`gate plan (${why.join('; ')})  jobs ${jobs}${baseRef ? `  base ${baseRef}` : ''}`);
  for (const s of plan) console.log(`  ${s.id.padEnd(22)} slots ${s.slots}${s.exclusive ? ' exclusive(last)' : ''}  ~${fmt(est(s))}${last[s.id] ? '' : ' (default)'}${s.needs?.length ? `  after ${s.needs.join(',')}` : ''}`);
  console.log(`${plan.length} stage(s), serial ${fmt(plan.reduce((a, s) => a + est(s), 0))}, estimated with ${jobs} slots ${fmt(total)}`);
  process.exit(0);
}
if (!plan.length) { console.log(`gate: nothing to run (${why.join('; ')})`); process.exit(0); }

// ---- run
const dir = join('.weave/gate', stamp);
mkdirSync(dir, { recursive: true });
const procs = new Set<number>();
const killAll = (): void => { for (const pid of procs) { try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ } } };
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });

const logName = (id: string, attempt: number): string => join(dir, `${id.replace(/:/g, '_')}${attempt > 1 ? '.retry' : ''}.log`);
/** vite-node exports NODE_ENV=development to its children, which made `npm run build` emit a DEVELOPMENT bundle (no service worker): stages must not inherit it. */
function stageEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GATE_BASE_REF: baseRef || process.env.GATE_BASE_REF || '' };
  delete env.NODE_ENV;
  return env;
}
function exec(s: StageDef, attempt: 1 | 2, override?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const jsonOut = join(root, dir, `${s.id.replace(/:/g, '_')}${attempt > 1 ? '.retry' : ''}.json`);
    let cmd = override ?? s.cmd;
    if (s.vitest && !override) cmd += `${/^npm run /.test(cmd) && !cmd.includes(' -- ') ? ' --' : ''} --reporter=default --reporter=json --outputFile.json=${jsonOut}`;
    else if (s.vitest && override) cmd += ' --reporter=default --reporter=json --outputFile.json=' + jsonOut;
    const log = createWriteStream(logName(s.id, attempt));
    log.write(`$ ${cmd}\n`);
    const timeoutMs = 90 * 60 * 1000;
    const p = spawn('sh', ['-c', cmd], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: stageEnv() });
    if (p.pid) procs.add(p.pid);
    p.stdout?.pipe(log, { end: false }); p.stderr?.pipe(log, { end: false });
    const timer = setTimeout(() => { log.write('\n[gate] timeout, killing the stage process group\n'); try { if (p.pid) process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer); if (p.pid) procs.delete(p.pid); log.end();
      let failedFiles: string[] | undefined;
      if (s.vitest && (code ?? 1) !== 0 && existsSync(jsonOut)) failedFiles = failedFilesFromVitestJson(readFileSync(jsonOut, 'utf8'), root);
      resolve({ code: code ?? 1, failedFiles });
    });
  });
}

const t0 = Date.now(), tty = !!process.stdout.isTTY, active = new Map<string, number>();
const line = (): string => `[${fmt((Date.now() - t0) / 1000)}] running ${[...active.keys()].join(' ') || '-'}`;
const tick = tty ? setInterval(() => process.stdout.write(`\r\x1b[K${line()}`), 1000) : undefined;
const say = (m: string): void => { if (tty) process.stdout.write('\r\x1b[K'); console.log(m); };
console.log(`gate ${stamp}: ${plan.length} stage(s), ${jobs} slots, logs ${dir}/  (${why.join('; ')})\nestimated ${fmt(total)}; load ${loadavg().map((x) => x.toFixed(1)).join(' ')}, ${cpus().length} cores, node ${process.version}`);

const results: StageResult[] = await runGate(plan, {
  jobs, exec,
  onEvent: (e) => {
    if (e.type === 'start') { active.set(e.id, Date.now()); say(`start ${e.id}${e.attempt > 1 ? ' (retry)' : ''}  [${e.used}/${jobs} slots]`); }
    else if (e.type === 'end') { active.delete(e.id); say(`${e.ok ? 'ok   ' : 'FAIL '} ${e.id}${e.attempt > 1 ? ' (retry)' : ''}  ${e.wallS.toFixed(1)}s${e.ok ? '' : `  log ${logName(e.id, e.attempt)}`}`); }
    else say(`skip  ${e.id} (needs ${e.because})`);
  },
});
if (tick) clearInterval(tick);

// ---- summary
const wall = (Date.now() - t0) / 1000, serial = results.reduce((a, r) => a + r.wallS, 0);
const rows = [...results].sort((a, b) => b.wallS - a.wallS);
const mark = (r: StageResult): string => (r.status === 'pass' ? (r.flaky ? 'PASS (flaky)' : 'pass') : r.status === 'skipped' ? 'SKIPPED' : 'FAIL');
const md = [`# Gate ${stamp}`, '', `Tier: ${why.join('; ')}. ${plan.length} stages, ${jobs} slots, node ${process.version}, ${cpus().length} cores.`, `Wall **${fmt(wall)}**, sum of stage walls ${fmt(serial)}. Flaky: ${results.filter((r) => r.flaky).map((r) => r.id).join(', ') || 'none'}. Failed: ${results.filter((r) => r.status !== 'pass').map((r) => r.id).join(', ') || 'none'}.`, '',
  '| Stage | Wall s | Status | Attempts | Note |', '|---|---:|---|---:|---|', ...rows.map((r) => `| ${r.id} | ${r.wallS} | ${mark(r)} | ${r.attempts} | ${r.note ?? ''} |`), ''].join('\n');
writeFileSync(join(dir, 'summary.md'), md);
writeFileSync(join(dir, 'summary.json'), JSON.stringify({ stamp, tier: why, jobs, node: process.version, cores: cpus().length, wallS: +wall.toFixed(1), results }, null, 2));
const merged = { ...last }; for (const r of results) if (r.status === 'pass' && r.attempts === 1) merged[r.id] = Math.round(r.wallS);
writeFileSync(estFile, JSON.stringify(merged, null, 2));
console.log(`\n${md}\nsummary: ${dir}/summary.md`);
for (const r of results.filter((x) => x.status === 'fail')) console.log(`FAILED ${r.id}: ${logName(r.id, r.attempts)}`);
process.exit(exitCode(results));
