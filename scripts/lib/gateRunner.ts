/** Pure DAG scheduler of the local release gate (scripts/gate.ts, docs/gate-speed.md). No process spawning here: `exec` is injected, so it is unit-tested with fake stages.
 * Rules: a stage starts when its `needs` have all passed and its slot weight fits the cap; ready stages go longest-estimate first; `exclusive` stages run alone, after every
 * other stage has finished; a failed stage is retried ONCE (the retry callback may narrow it, e.g. to the failing vitest files) and reported `flaky` when the retry passes;
 * stages whose dependency failed are `skipped` (which is a failure for the exit code). */
export interface StageDef {
  id: string;
  cmd: string;
  /** Stage ids that must have passed first. */
  needs?: string[];
  /** CPU slots taken while running (clamped to the cap). */
  slots: number;
  /** Runs alone, after everything else. */
  exclusive?: boolean;
  /** Estimated wall seconds (fallback; replaced by the last measured time). */
  est: number;
  /** Vitest stage: the runner reads the JSON report and retries only the failing files with `retryCmd(files)`. */
  vitest?: { retryCmd: (files: string[]) => string };
}
export type Status = 'pass' | 'fail' | 'skipped';
export interface ExecResult { code: number; failedFiles?: string[] }
export type Exec = (stage: StageDef, attempt: 1 | 2, cmdOverride?: string) => Promise<ExecResult>;
export interface StageResult { id: string; status: Status; flaky: boolean; wallS: number; attempts: number; startedAt: number; note?: string }
export interface RunOpts { jobs: number; exec: Exec; now?: () => number; onEvent?: (e: GateEvent) => void }
export type GateEvent =
  | { type: 'start'; id: string; attempt: 1 | 2; used: number; running: string[] }
  | { type: 'end'; id: string; attempt: 1 | 2; ok: boolean; wallS: number }
  | { type: 'skip'; id: string; because: string };

export function validate(stages: StageDef[]): void {
  const ids = new Set(stages.map((s) => s.id));
  if (ids.size !== stages.length) throw new Error('duplicate stage id');
  for (const s of stages) for (const n of s.needs ?? []) if (!ids.has(n)) throw new Error(`stage ${s.id} needs unknown stage ${n}`);
  const seen = new Set<string>(), visiting = new Set<string>();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`);
    visiting.add(id); for (const n of byId.get(id)!.needs ?? []) visit(n); visiting.delete(id); seen.add(id);
  };
  stages.forEach((s) => visit(s.id));
}

/** Keep the selected stages plus (transitively) everything they need. */
export function withDeps(all: StageDef[], selected: Iterable<string>): StageDef[] {
  const byId = new Map(all.map((s) => [s.id, s])), keep = new Set<string>();
  const add = (id: string): void => { if (keep.has(id)) return; const s = byId.get(id); if (!s) throw new Error(`unknown stage ${id}`); keep.add(id); (s.needs ?? []).forEach(add); };
  for (const id of selected) add(id);
  return all.filter((s) => keep.has(s.id));
}

export async function runGate(stages: StageDef[], o: RunOpts): Promise<StageResult[]> {
  validate(stages);
  const now = o.now ?? Date.now, cap = Math.max(1, o.jobs);
  const results = new Map<string, StageResult>(), done = new Set<string>(), failed = new Set<string>(), running = new Map<string, number>();
  const slotsOf = (s: StageDef): number => Math.min(Math.max(1, s.slots), cap);
  let used = 0;
  const pending = new Map(stages.map((s) => [s.id, s]));

  const skipBlocked = (): void => {
    for (let again = true; again;) { again = false; for (const s of [...pending.values()]) {
      const bad = (s.needs ?? []).find((n) => failed.has(n));
      if (bad) { again = true; pending.delete(s.id); failed.add(s.id); done.add(s.id); results.set(s.id, { id: s.id, status: 'skipped', flaky: false, wallS: 0, attempts: 0, startedAt: now(), note: `needs ${bad}` }); o.onEvent?.({ type: 'skip', id: s.id, because: bad }); }
    } }
  };
  const ready = (s: StageDef): boolean => (s.needs ?? []).every((n) => done.has(n) && !failed.has(n));

  const runStage = async (s: StageDef): Promise<void> => {
    const t0 = now(); let attempts = 1, res: ExecResult;
    const go = async (attempt: 1 | 2, cmd?: string): Promise<ExecResult> => {
      const a0 = now(); o.onEvent?.({ type: 'start', id: s.id, attempt, used, running: [...running.keys()] });
      const r = await o.exec(s, attempt, cmd);
      o.onEvent?.({ type: 'end', id: s.id, attempt, ok: r.code === 0, wallS: (now() - a0) / 1000 }); return r;
    };
    res = await go(1);
    let flaky = false, note: string | undefined;
    if (res.code !== 0) {
      attempts = 2;
      const files = res.failedFiles ?? [];
      const narrowed = s.vitest && files.length ? s.vitest.retryCmd(files) : undefined;
      const r2 = await go(2, narrowed);
      if (r2.code === 0) { flaky = true; note = narrowed ? `retry of ${files.length} failing file(s) passed` : 'retry passed'; res = r2; } else { res = r2; note = files.length ? `still failing: ${(r2.failedFiles?.length ? r2.failedFiles : files).join(', ')}` : undefined; }
    }
    const ok = res.code === 0;
    results.set(s.id, { id: s.id, status: ok ? 'pass' : 'fail', flaky, wallS: +((now() - t0) / 1000).toFixed(1), attempts, startedAt: t0, note });
    if (!ok) failed.add(s.id);
    done.add(s.id);
  };

  const inflight = new Set<Promise<void>>();
  const launch = (s: StageDef): void => {
    pending.delete(s.id); used += slotsOf(s); running.set(s.id, slotsOf(s));
    const p: Promise<void> = runStage(s).finally(() => { used -= slotsOf(s); running.delete(s.id); inflight.delete(p); });
    inflight.add(p);
  };
  const pick = (exclusivePhase: boolean): StageDef | undefined => {
    const c = [...pending.values()].filter((s) => !!s.exclusive === exclusivePhase && ready(s) && used + slotsOf(s) <= cap).sort((a, b) => b.est - a.est || a.id.localeCompare(b.id));
    return c[0];
  };
  for (;;) {
    skipBlocked();
    // normal phase: fill the slots
    let s: StageDef | undefined;
    while ((s = pick(false))) launch(s);
    if (inflight.size) { await Promise.race(inflight); continue; }
    // nothing is running; stages left are exclusive ones (or blocked by a failure, handled by skipBlocked)
    const normalLeft = [...pending.values()].some((x) => !x.exclusive);
    if (normalLeft) { // not ready and nothing running: only possible with a failed dependency chain, already skipped
      throw new Error(`scheduler stuck: ${[...pending.keys()].join(', ')}`);
    }
    const ex = pick(true);
    if (!ex) break;
    launch(ex);
    await Promise.all(inflight);
  }
  return stages.map((s) => results.get(s.id)!).filter(Boolean);
}

export function exitCode(results: StageResult[]): number { return results.every((r) => r.status === 'pass') ? 0 : 1; }

/** Longest-first packing used by `--dry` and the docs: estimated makespan of the plan under the slot cap (ignores CPU contention). */
export function estimate(stages: StageDef[], jobs: number, est: (s: StageDef) => number = (s) => s.est): number {
  const cap = Math.max(1, jobs), byId = new Map(stages.map((s) => [s.id, s]));
  const finish = new Map<string, number>(), pending = new Set(stages.filter((s) => !s.exclusive).map((s) => s.id));
  const running: Array<{ id: string; end: number; slots: number }> = [];
  let t = 0, used = 0;
  while (pending.size || running.length) {
    const cand = [...pending].map((i) => byId.get(i)!).filter((s) => (s.needs ?? []).every((n) => finish.has(n) || !byId.has(n)) && used + Math.min(s.slots, cap) <= cap).sort((a, b) => est(b) - est(a));
    if (cand[0]) { const s = cand[0]; pending.delete(s.id); used += Math.min(s.slots, cap); running.push({ id: s.id, end: t + est(s), slots: Math.min(s.slots, cap) }); continue; }
    if (!running.length) break;
    running.sort((a, b) => a.end - b.end); const r = running.shift()!; t = r.end; used -= r.slots; finish.set(r.id, t);
  }
  for (const s of stages.filter((x) => x.exclusive)) t += est(s);
  return t;
}

/** Failing test files from a vitest JSON report (`--reporter=json`): files with any failed test or a failed suite. Paths are made relative to `root`. */
export function failedFilesFromVitestJson(json: string, root: string): string[] {
  let j: { testResults?: Array<{ name: string; status: string }> };
  try { j = JSON.parse(json); } catch { return []; }
  const pre = root.endsWith('/') ? root : `${root}/`;
  return (j.testResults ?? []).filter((f) => f.status === 'failed').map((f) => (f.name.startsWith(pre) ? f.name.slice(pre.length) : f.name));
}
