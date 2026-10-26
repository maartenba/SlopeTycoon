/** `npm run release -- patch|minor|major [--dry-run]`: bump version, changelog section, build:pages, commit + tag vX.Y.Z. Does not push. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { bumpVersion, releaseChangelog, type Bump } from './lib/release';

const args = process.argv.slice(2), dry = args.includes('--dry-run');
const kind = args.find((a) => a === 'patch' || a === 'minor' || a === 'major') as Bump | undefined;
if (!kind) { console.error('usage: npm run release -- patch|minor|major [--dry-run]'); process.exit(1); }
const git = (...a: string[]): string => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain') && !dry) { console.error('Working tree is dirty: commit first.'); process.exit(1); }
const pkgRaw = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(pkgRaw) as { version: string };
const next = bumpVersion(pkg.version, kind), tag = `v${next}`, date = new Date().toISOString().slice(0, 10);
console.log(`[release] ${pkg.version} -> ${next} (${tag}, ${date})${dry ? ' [dry-run]' : ''}`);
if (dry) {
  console.log('[dry-run] would: update package.json + CHANGELOG.md, npm run build:pages, git commit -am "Release ' + tag + '", git tag ' + tag);
  process.exit(0);
}
writeFileSync('package.json', pkgRaw.replace(/"version": "[^"]+"/, `"version": "${next}"`));
writeFileSync('CHANGELOG.md', releaseChangelog(readFileSync('CHANGELOG.md', 'utf8'), next, date));
execFileSync('npm', ['run', 'build:pages'], { stdio: 'inherit' });
git('add', 'package.json', 'CHANGELOG.md');
git('commit', '-m', `Release ${tag}`);
git('tag', tag);
console.log(`[release] done. Push with: git push origin main ${tag}`);
