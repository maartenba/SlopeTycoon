/** `npm run whats-new` regenerates src/config/whatsNew.generated.ts from CHANGELOG.md; `--check` only verifies (exit 1 when stale). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseChangelog, renderGenerated } from './lib/whatsNew';

const out = 'src/config/whatsNew.generated.ts';
const next = renderGenerated(parseChangelog(readFileSync('CHANGELOG.md', 'utf8')));
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== next) { console.error(`${out} is stale: run \`npm run whats-new\``); process.exit(1); }
  console.log('[whats-new] up to date');
} else {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== next) writeFileSync(out, next);
  console.log('[whats-new] ok');
}
