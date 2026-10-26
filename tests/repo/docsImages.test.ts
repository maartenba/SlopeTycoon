import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const IMG = 'docs/img';
const mdFiles = (): string[] => ['README.md', 'CHANGELOG.md', 'site/README.md', ...['docs', 'site/guide'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => join(d, f)))];

describe('docs/img policy', () => {
  it('every docs/img/* reference in markdown exists', () => {
    const missing: string[] = [];
    for (const f of mdFiles()) {
      const dir = f.startsWith('docs/') ? 'docs' : f.startsWith('site/guide') ? 'site/guide' : '.';
      for (const m of readFileSync(f, 'utf8').matchAll(/\]\(((?:\.\.?\/)*(?:docs\/)?img\/[^)\s#]+)\)/g)) {
        const rel = m[1]!; if (!existsSync(join(dir, rel)) && !existsSync(rel)) missing.push(`${f}: ${rel}`);
      }
      for (const m of readFileSync(f, 'utf8').matchAll(/docs\/img\/([A-Za-z0-9_.-]+\.(?:png|webp|jpg))/g)) if (!existsSync(join(IMG, m[1]!))) missing.push(`${f}: docs/img/${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
  it('no PNG over 400 kB, total <= 25 MB', () => {
    const files = readdirSync(IMG);
    const bigPng = files.filter((f) => f.endsWith('.png') && statSync(join(IMG, f)).size > 400 * 1024);
    expect(bigPng).toEqual([]);
    const total = files.reduce((a, f) => a + statSync(join(IMG, f)).size, 0);
    expect(total).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
  it('site/shots.json copy sources exist', () => {
    const j = JSON.parse(readFileSync('site/shots.json', 'utf8')) as { shots?: { source?: string }[] } | { source?: string }[];
    const list = Array.isArray(j) ? j : j.shots ?? [];
    for (const s of list) if (s.source) expect(existsSync(s.source), s.source).toBe(true);
  });
});
