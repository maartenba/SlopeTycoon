import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parseChangelog, renderJson } from '../scripts/lib/whatsNew';

/** Emits `whats-new.json` (newest versions + highlights) next to index.html. NOT precached (the service worker serves it network-first) so the running OLD build can fetch the NEW highlights. */
export function whatsNewPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'slope-whats-new', apply: 'build',
    configResolved(c) { root = c.root; },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'whats-new.json', source: renderJson(parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))) }); },
  };
}
