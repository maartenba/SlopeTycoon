import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChangelog, plainText, renderGenerated, renderJson, MAX_HIGHLIGHTS } from '../../scripts/lib/whatsNew';
import { enumerateDist } from '../../vite-plugins/precache';
import { isManifestRequest } from '../../sw/core';

const MD = `# Changelog

## [Unreleased]

- **Hidden**: not released yet.

## [0.3.0] - 2026-11-01 (pre-release)

Intro text.

### Highlights

- **Sleighs** are here, see [the guide](guide/x.md) and \`docs/sleigh.md\`.
- A second one.

### Changes

- Long technical bullet.

## [0.2.9] - 2026-10-01

- **First bullet**: with a long explanation that goes on. More text here.
- Second bullet.
- Third.
- Fourth.
- Fifth.

## [0.2.8] - 2026-09-01

- Old.
`;

describe('whats-new generator', () => {
  it('parses Highlights, skips Unreleased, strips markdown', () => {
    const e = parseChangelog(MD);
    expect(e.map((x) => x.version)).toEqual(['0.3.0', '0.2.9', '0.2.8']);
    expect(e[0]).toEqual({ version: '0.3.0', date: '2026-11-01', highlights: ['Sleighs are here, see the guide and docs/sleigh.md.', 'A second one.'] });
  });
  it('falls back to the first 4 bullets and honours the version count', () => {
    const e = parseChangelog(MD, 2);
    expect(e).toHaveLength(2);
    expect(e[1]!.highlights).toHaveLength(4);
    expect(e[1]!.highlights[0]).toBe('First bullet: with a long explanation that goes on. More text here.');
  });
  it('clips long bullets and caps the list', () => {
    const md = `## [1.0.0] - 2026-01-01\n\n### Highlights\n\n${Array.from({ length: 9 }, (_, i) => `- ${'word '.repeat(60)}${i}`).join('\n')}\n`;
    const h = parseChangelog(md)[0]!.highlights;
    expect(h).toHaveLength(MAX_HIGHLIGHTS);
    expect(h[0]!.length).toBeLessThanOrEqual(150); expect(h[0]!.endsWith('\u2026')).toBe(true);
  });
  it('plainText', () => { expect(plainText('**a** `b` [c](d) *e*')).toBe('a b c e'); });
  it('the committed generated file is NOT stale (run `npm run whats-new`)', () => {
    const want = renderGenerated(parseChangelog(readFileSync('CHANGELOG.md', 'utf8')));
    expect(readFileSync('src/config/whatsNew.generated.ts', 'utf8')).toBe(want);
  });
  it('the newest 3 released CHANGELOG sections carry 3-6 Highlights', () => {
    const md = readFileSync('CHANGELOG.md', 'utf8');
    for (const e of parseChangelog(md)) {
      const sec = md.slice(md.indexOf(`## [${e.version}]`)).split(/\n## /)[0]!;
      expect(sec, e.version).toMatch(/\n### Highlights\n/);
      expect(e.highlights.length, e.version).toBeGreaterThanOrEqual(3); expect(e.highlights.length).toBeLessThanOrEqual(6);
    }
    expect(parseChangelog(md)[0]!.version).toBe((JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version);
  });
  it('json for the build; never precached; served network-first', () => {
    expect(JSON.parse(renderJson(parseChangelog(MD)))).toEqual({ entries: parseChangelog(MD) });
    const d = mkdtempSync(join(tmpdir(), 'wn-')); mkdirSync(join(d, 'a'));
    writeFileSync(join(d, 'index.html'), 'x'); writeFileSync(join(d, 'whats-new.json'), '{}');
    expect(enumerateDist(d).map((x) => x.url)).toEqual(['./index.html']);
    expect(isManifestRequest('https://x.test/play/whats-new.json')).toBe(true);
    expect(isManifestRequest('https://x.test/play/manifest.webmanifest')).toBe(true);
    expect(isManifestRequest('https://x.test/play/assets/a.js')).toBe(false);
  });
});
