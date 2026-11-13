/** Fail fast (exit 1, one clear line) when `dist/` is missing or older than the sources it was built from. Used by every script that serves `dist/`
 * (analytics:e2e, offline:splash, menu-music:e2e, sfx:e2e, music:e2e). Escape hatch: SLOPE_ALLOW_STALE_DIST=1 (missing dist still fails). */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIRS = ['src', 'public', 'vite-plugins'];
const SRC_FILES = ['index.html', 'vite.config.ts', 'package.json'];

function newest(dir: string, best: { t: number; f: string }): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest(p, best);
    else { const t = statSync(p).mtimeMs; if (t > best.t) { best.t = t; best.f = p; } }
  }
}

/** Returns an error message, or '' when dist is present and fresh. */
export function distProblem(root = process.cwd(), allowStale = process.env.SLOPE_ALLOW_STALE_DIST === '1'): string {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'sw.js'))) return 'dist/ missing (no index.html / sw.js): run `npm run build` first';
  if (allowStale) return '';
  const built = statSync(join(dist, 'sw.js')).mtimeMs, best = { t: 0, f: '' };
  for (const d of SRC_DIRS) if (existsSync(join(root, d))) newest(join(root, d), best);
  for (const f of SRC_FILES) if (existsSync(join(root, f))) { const t = statSync(join(root, f)).mtimeMs; if (t > best.t) { best.t = t; best.f = f; } }
  // the build writes src/config/whatsNew.generated.ts before emitting dist, so a fresh dist is always newer than every source file
  if (best.t > built) return `dist/ is stale (${best.f} is newer than dist/sw.js): run \`npm run build\` first (or SLOPE_ALLOW_STALE_DIST=1)`;
  return '';
}

export function requireFreshDist(): void {
  const p = distProblem();
  if (p) { console.error(p); process.exit(1); }
}
