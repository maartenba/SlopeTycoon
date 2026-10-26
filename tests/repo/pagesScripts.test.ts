import { describe, expect, it } from 'vitest';
import { bumpVersion, releaseChangelog } from '../../scripts/lib/release';
import { normalizeBase } from '../../scripts/lib/static-server';
import { NOT_FOUND_HTML } from '../../scripts/lib/notFound';

describe('pages scripts', () => {
  it('bumpVersion', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });
  it('releaseChangelog inserts a dated section under Unreleased', () => {
    const out = releaseChangelog('# C\n\n## [Unreleased]\n\n### Added\n- x\n', '1.0.1', '2026-01-02');
    expect(out).toBe('# C\n\n## [Unreleased]\n\n## [1.0.1] - 2026-01-02\n\n### Added\n- x\n');
    expect(() => releaseChangelog('nothing', '1.0.1', 'd')).toThrow();
  });
  it('normalizeBase', () => {
    expect(normalizeBase('slopetycoon')).toBe('/slopetycoon/');
    expect(normalizeBase('/a/b/')).toBe('/a/b/');
  });
  it('404 page is tiny and redirects', () => { expect(NOT_FOUND_HTML.length).toBeLessThan(1500); expect(NOT_FOUND_HTML).toContain('location.replace'); });
});
