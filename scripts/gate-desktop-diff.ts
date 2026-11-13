/** Gate stage `desktop:diff`: captures the desktop UI in a throw-away worktree of the BEFORE commit and in the working tree, then compares (must stay SAME).
 * Before = $GATE_BASE_REF, else HEAD when the working tree is dirty, else HEAD~1. The worktree lives in the opencode temp folder and is always removed again
 * (git worktree remove --force on OUR path only; node_modules is a symlink to the repo's). */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.cwd();
const git = (...a: string[]): string => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const TEMP = '/private/var/folders/02/plxhpv253dxd7nkzg5r_z4080000gn/T/opencode';
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
const ref = process.env.GATE_BASE_REF || (dirty ? 'HEAD' : 'HEAD~1');
const root = mkdtempSync(join(existsSync(TEMP) ? TEMP : tmpdir(), 'gate-dd-'));
const wt = join(root, 'before'), outBefore = resolve(repo, '.weave/gate/desktop-diff/before'), outAfter = resolve(repo, '.weave/gate/desktop-diff/after');
mkdirSync(outBefore, { recursive: true }); mkdirSync(outAfter, { recursive: true });
let code = 1;
try {
  console.log(`[desktop:diff] before = ${ref} in ${wt}`);
  git('worktree', 'add', '--detach', wt, ref);
  symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'));
  const run = (cwd: string, ...a: string[]): number => spawnSync('npx', ['vite-node', 'scripts/desktop-diff.ts', ...a], { cwd, stdio: 'inherit' }).status ?? 1;
  if (run(wt, '--out', outBefore) !== 0) throw new Error('capture of the before tree failed');
  if (run(repo, '--out', outAfter) !== 0) throw new Error('capture of the working tree failed');
  code = run(repo, '--compare', outBefore, outAfter);
} catch (e) { console.error(String(e)); }
finally {
  try { git('worktree', 'remove', '--force', wt); } catch { /* maybe never created */ }
  rmSync(root, { recursive: true, force: true });
  try { git('worktree', 'prune'); } catch { /* ignore */ }
}
process.exit(code);
