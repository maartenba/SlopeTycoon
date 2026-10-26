/** `npm run site:shots [-- --only a,b | --missing | --optimize-only | --list]`: re-shoots the manifest (site/shots.json) through the QA harness
 * (own vite + own Chrome only, sequential, cleaned up on exit), saves raw PNGs to site/shots-raw/ (gitignored) and writes optimised WebP to site/assets/shots/. */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, validateManifest } from './manifest';
import { optimizeAll, readIndex } from './optimize';

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : (argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : '1'); };
const man = loadManifest();
const errs = validateManifest(man); if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
const RAW = 'site/shots-raw'; mkdirSync(RAW, { recursive: true });
if (flag('list')) { for (const s of man.shots) console.log(`${s.id.padEnd(22)} ${s.kind.padEnd(8)} ${s.pages.join(',')}`); process.exit(0); }
const only = flag('only')?.split(',');
const idx = readIndex();
let todo = man.shots.filter((s) => !only || only.includes(s.id));
if (flag('missing')) todo = todo.filter((s) => !idx[s.id]);
if (only) for (const o of only) if (!man.shots.some((s) => s.id === o)) { console.error(`unknown id ${o}`); process.exit(1); }

const done: { id: string; png: string }[] = [];
if (flag('optimize-only')) { for (const s of todo) if (existsSync(join(RAW, `${s.id}.png`))) done.push({ id: s.id, png: join(RAW, `${s.id}.png`) }); }
else {
  const harness = todo.filter((s) => s.kind === 'harness');
  for (const s of todo.filter((x) => x.kind === 'copy')) { const dst = join(RAW, `${s.id}.png`); copyFileSync(s.source!, dst); done.push({ id: s.id, png: dst }); }
  if (harness.length) {
    const { launch, shot, startServer } = await import('../lib/harness');
    const srv = await startServer(); const br = await launch();
    try {
      for (const s of harness) {
        const opts = Object.fromEntries(Object.entries(s.shot!).filter(([, v]) => v !== null && v !== undefined));
        const out = `site-${s.id}`;
        try {
          const r = await shot(br, srv.url, { ...opts, out } as never);
          const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt|GPU stall/.test(e));
          if (real.length) console.warn(`[site] ${s.id}: ${real.length} console errors: ${real[0]!.slice(0, 200)}`);
          const dst = join(RAW, `${s.id}.png`); copyFileSync(r.file, dst); done.push({ id: s.id, png: dst });
          console.log(`[site] shot ${s.id}`);
        } catch (e) { console.error(`[site] FAILED ${s.id}: ${String(e).slice(0, 300)}`); process.exitCode = 1; }
      }
    } finally { await br.close(); srv.stop(); }
  }
}
if (done.length) await optimizeAll(done);
console.log(`[site] ${done.length} of ${todo.length} shots processed`);
