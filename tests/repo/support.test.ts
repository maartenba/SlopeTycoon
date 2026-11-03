import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Support = Ko-fi only (AGENTS.md privacy bullet): the exact URL, nothing else, and no widget outside site/assets/support.js. */
describe('support link rule', () => {
  const files = execSync('git ls-files src site scripts public', { encoding: 'utf8' }).split('\n').filter((f) => /\.(ts|js|html|md|json)$/.test(f) && !f.includes('shots-raw') && !f.includes('.generated.'));
  it('no GitHub Sponsors / patreon / buymeacoffee URL in the game or the site sources', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/github\.com\/sponsors|patreon\.com|buymeacoffee\.com|paypal\.me/i);
  });
  it('every ko-fi.com URL in src/ and site/ is exactly https://ko-fi.com/slopetycoon (the widget query lives only in site/pages/support.md)', () => {
    for (const f of files.filter((x) => /^(src|site|scripts\/site)\//.test(x))) for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/ko-fi\.com[^\s"'`)<>;,]*/g)) {
      if (f === 'site/pages/support.md' && m[0].startsWith('https://ko-fi.com/slopetycoon/?')) continue;
      expect(m[0], f).toBe('https://ko-fi.com/slopetycoon');
    }
  });
  it('no iframe in the game', () => {
    for (const f of files.filter((x) => x.startsWith('src/'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/createElement\(['"]iframe|<iframe/i);
  });
});
