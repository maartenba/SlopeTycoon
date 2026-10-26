import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pngSize, encodePng, renderLogo, crc32 } from '../../scripts/lib/png';

const pub = join(process.cwd(), 'public');
const man = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown> & { icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> };

describe('web app manifest', () => {
  it('has the required fields', () => {
    expect(man.name).toBe('Slope Tycoon'); expect(man.short_name).toBeTruthy(); expect(man.display).toBe('standalone'); expect(man.orientation).toBe('any');
    expect(man.start_url).toBe('./'); expect(man.scope).toBe('./'); expect(man.categories).toEqual(['games', 'simulation']);
    expect(man.theme_color).toMatch(/^#[0-9a-f]{6}$/i); expect(man.background_color).toMatch(/^#[0-9a-f]{6}$/i); expect(man.description).toBeTruthy();
  });
  it('icons exist, are relative and match their declared size', () => {
    for (const i of man.icons) {
      expect(i.src).not.toMatch(/^\/|:\/\//); expect(existsSync(join(pub, i.src))).toBe(true);
      const sz = pngSize(readFileSync(join(pub, i.src)))!; expect(`${sz.w}x${sz.h}`).toBe(i.sizes);
    }
    const sizes = man.icons.map((i) => i.sizes); expect(sizes).toContain('192x192'); expect(sizes).toContain('512x512'); expect(sizes).toContain('180x180');
    expect(man.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(existsSync(join(pub, 'icons/favicon.svg'))).toBe(true);
  });
  it('index.html links manifest, theme colour and apple meta', () => {
    const h = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(h).toContain('rel="manifest"'); expect(h).toContain(`content="${man.theme_color as string}"`); expect(h).toContain('apple-touch-icon'); expect(h).toContain('apple-mobile-web-app-capable'); expect(h).toContain('viewport-fit=cover');
  });
});
describe('png encoder', () => {
  it('crc32 known value; deterministic output with correct IHDR', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const a = encodePng(32, 32, renderLogo(32)), b = encodePng(32, 32, renderLogo(32));
    expect(a.equals(b)).toBe(true); expect(pngSize(a)).toEqual({ w: 32, h: 32 });
  });
  it('maskable icon is fully opaque, "any" icon has transparent corners', () => {
    expect(renderLogo(64, { maskable: true })[3]).toBe(255); expect(renderLogo(64, { rounded: true })[3]).toBe(0);
  });
});
