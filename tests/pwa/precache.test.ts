import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateDist, writeServiceWorker, cacheVersion } from '../../vite-plugins/precache';

const entry = fileURLToPath(new URL('../../sw/sw.ts', import.meta.url));
let dist = '';
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'st-dist-'));
  mkdirSync(join(dist, 'assets')); mkdirSync(join(dist, 'icons'));
  writeFileSync(join(dist, 'index.html'), '<html></html>');
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dist, 'assets', 'index-abc.js.map'), '{}');
  writeFileSync(join(dist, 'assets', 'a.css'), 'a{}');
  writeFileSync(join(dist, 'icons', 'icon-192.png'), 'png');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('precache plugin', () => {
  it('lists every emitted asset exactly once with hashes, relative URLs, no maps/sw.js', () => {
    const m = enumerateDist(dist);
    expect(m.map((e) => e.url)).toEqual(['./assets/a.css', './assets/index-abc.js', './icons/icon-192.png', './index.html', './manifest.webmanifest']);
    for (const e of m) { expect(e.revision).toMatch(/^[0-9a-f]{16}$/); expect(e.url.startsWith('./')).toBe(true); }
  });
  it('writes a self-contained ES2019 sw.js with version + list injected', () => {
    const r = writeServiceWorker(dist, entry, '1.2.3');
    const code = readFileSync(join(dist, 'sw.js'), 'utf8');
    expect(code).toContain(r.version);
    expect(r.version).toMatch(/^1\.2\.3-[0-9a-f]{10}$/);
    for (const e of r.manifest) expect(code).toContain(e.url);
    expect(code).not.toMatch(/__PRECACHE_MANIFEST__|__CACHE_VERSION__/);
    expect(code).not.toMatch(/\bimport\s*[({]|\bexport\s/); // single file, no module syntax
    expect(code).not.toMatch(/https?:\/\//);
    expect(r.manifest.some((e) => e.url === './sw.js')).toBe(false);
    // second run (sw.js now exists) is stable: sw.js is excluded from the list
    expect(writeServiceWorker(dist, entry, '1.2.3').version).toBe(r.version);
  });
  it('version changes with content', () => {
    const a = enumerateDist(dist); writeFileSync(join(dist, 'a2.css'), 'x');
    expect(cacheVersion('0.1.0', enumerateDist(dist))).not.toBe(cacheVersion('0.1.0', a));
  });
  it('emits no absolute "/" precache URLs', () => { for (const e of enumerateDist(dist)) expect(e.url).not.toMatch(/^\/|:\/\//); });
});
