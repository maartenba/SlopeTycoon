/** `npm run deploy:gh-pages [-- --dry-run] [-- --force]`: manual deploy of dist-site/ (website + game) to the `gh-pages` branch (for people not using Actions). */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2), dry = args.includes('--dry-run'), force = args.includes('--force');
const sh = (cmd: string, a: string[], cwd?: string): string => execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (what: string, fn: () => void): void => { if (dry) console.log(`[dry-run] ${what}`); else fn(); };

if (sh('git', ['status', '--porcelain']) && !force) { console.error('Working tree is dirty: commit/stash first or pass --force.'); process.exit(1); }
const sha = sh('git', ['rev-parse', '--short', 'HEAD']);
console.log('[deploy:gh-pages] building (npm run build:pages)…');
run('npm run build:pages', () => { execFileSync('npm', ['run', 'build:pages'], { stdio: 'inherit' }); });
const dist = join(process.cwd(), 'dist-site');
if (!dry && !existsSync(join(dist, 'index.html'))) { console.error('dist-site/index.html missing'); process.exit(1); }

const remoteBranch = (() => { try { return execFileSync('git', ['ls-remote', '--heads', 'origin', 'gh-pages'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0; } catch { return false; } })();
const tmp = mkdtempSync(join(tmpdir(), 'gh-pages-'));
const wt = join(tmp, 'wt');
try {
  run(`git worktree add ${remoteBranch ? '' : '--orphan '}${wt} gh-pages`, () => {
    if (remoteBranch) { sh('git', ['fetch', 'origin', 'gh-pages']); sh('git', ['worktree', 'add', '-B', 'gh-pages', wt, 'origin/gh-pages']); }
    else sh('git', ['worktree', 'add', '--orphan', '-b', 'gh-pages', wt]);
  });
  run('replace worktree contents with dist-site/', () => {
    for (const n of readdirSync(wt)) if (n !== '.git') rmSync(join(wt, n), { recursive: true, force: true });
    cpSync(dist, wt, { recursive: true });
  });
  run(`git add -A && git commit -m "Deploy ${sha}"`, () => {
    sh('git', ['add', '-A'], wt);
    if (!sh('git', ['status', '--porcelain'], wt)) { console.log('Nothing changed; nothing to deploy.'); return; }
    sh('git', ['commit', '-m', `Deploy ${sha}`], wt);
  });
  run('git push origin gh-pages', () => { sh('git', ['push', 'origin', 'gh-pages'], wt); });
} finally {
  if (!dry) { try { sh('git', ['worktree', 'remove', '--force', wt]); } catch { /* ignore */ } }
  rmSync(tmp, { recursive: true, force: true });
}
console.log(dry ? '[deploy:gh-pages] dry run finished.' : '[deploy:gh-pages] pushed. Set Pages source to branch gh-pages / (root) in repo settings.');
