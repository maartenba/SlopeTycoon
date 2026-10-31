import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('licence (owner decision: proprietary, all rights reserved)', () => {
  const lic = readFileSync('LICENSE', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { license?: string; private?: boolean };
  it('LICENSE is a proprietary all-rights-reserved text naming the holder and year', () => {
    expect(lic).toMatch(/All rights reserved/i);
    expect(lic).toContain('Maarten Balliauw');
    expect(lic).toContain('2026');
    expect(lic).toMatch(/three\.js/);
    expect(lic).not.toMatch(/Permission is hereby granted/i);
  });
  it('package.json is UNLICENSED and private', () => {
    expect(pkg.license).toBe('UNLICENSED');
    expect(pkg.private).toBe(true);
  });
  it('README says proprietary and never claims open source', () => {
    const r = readFileSync('README.md', 'utf8');
    expect(r).toMatch(/proprietary, all rights reserved/i);
    expect(r).not.toMatch(/\bis open[- ]source\b/i);
  });
});
