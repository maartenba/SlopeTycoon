import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { Plugin } from 'vite';

export interface PrecacheEntry { url: string; revision: string }
const SKIP = (rel: string): boolean => rel === 'sw.js' || rel === '404.html' || rel === '.nojekyll' || rel === 'CNAME' || rel.endsWith('.map') || rel.endsWith('.DS_Store');

/** Every emitted file in `dist` (relative './' URLs, posix) with a content hash. Sorted for determinism. */
export function enumerateDist(dist: string): PrecacheEntry[] {
  const out: PrecacheEntry[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(dist, p).split(sep).join('/');
      if (SKIP(rel)) continue;
      out.push({ url: `./${rel}`, revision: createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) });
    }
  };
  walk(dist);
  return out;
}
export const cacheVersion = (pkgVersion: string, manifest: readonly PrecacheEntry[]): string =>
  `${pkgVersion}-${createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 10)}`;

/** Compiles sw/sw.ts into one self-contained ES2019 script with the manifest + version injected; writes `<dist>/sw.js`. */
export function writeServiceWorker(dist: string, swEntry: string, pkgVersion: string): { manifest: PrecacheEntry[]; version: string; bytes: number } {
  const manifest = enumerateDist(dist), version = cacheVersion(pkgVersion, manifest);
  const res = buildSync({
    entryPoints: [swEntry], bundle: true, write: false, format: 'iife', target: 'es2019', minify: true, legalComments: 'none',
    define: { __PRECACHE_MANIFEST__: JSON.stringify(manifest), __CACHE_VERSION__: JSON.stringify(version) },
  });
  const code = `/* Slope Tycoon service worker ${version} */\n${res.outputFiles[0]!.text}`;
  writeFileSync(join(dist, 'sw.js'), code);
  return { manifest, version, bytes: Buffer.byteLength(code) };
}

export function precachePlugin(): Plugin {
  let outDir = 'dist', root = process.cwd();
  return {
    name: 'slope-precache', apply: 'build', enforce: 'post',
    configResolved(c) { outDir = c.build.outDir; root = c.root; },
    closeBundle() {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
      const entry = fileURLToPath(new URL('../sw/sw.ts', import.meta.url));
      const r = writeServiceWorker(join(root, outDir), entry, pkg.version);
      console.log(`[precache] ${r.manifest.length} files, version ${r.version}, sw.js ${r.bytes} B`);
    },
  };
}
