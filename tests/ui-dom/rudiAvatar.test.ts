// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { RUDI_EXPRESSIONS, rudiElement, rudiMarkup } from '../../src/ui/components/rudiAvatar';

describe('Ranger Rudi avatar', () => {
  it.each(RUDI_EXPRESSIONS)('%s: valid, self-contained SVG with the ranger parts, accessible name and no external refs', (e) => {
    const m = rudiMarkup(e);
    const doc = new DOMParser().parseFromString(m, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const svg = doc.documentElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 72 72');
    expect(svg.getAttribute('aria-label')).toBe('Ranger Rudi');
    expect(svg.getAttribute('data-rudi')).toBe(e);
    expect(svg.querySelectorAll('.eyes, [class="eyes"]').length).toBe(1);
    expect(m).not.toMatch(/href|url\(|<image|<script|<style/);
    expect(m).toContain('#2f6a3d'); // ranger green hat
    expect(m).toContain('#d9442f'); // alpine-red neckerchief
    expect(rudiElement(e).tagName.toLowerCase()).toBe('svg');
  });
  it('size budget: every expression under 6 kB, the 24 px mini lighter than the full one', () => {
    for (const e of RUDI_EXPRESSIONS) expect(rudiMarkup(e).length, e).toBeLessThan(6000);
    expect(rudiMarkup('idle', true).length).toBeLessThan(rudiMarkup('idle').length);
  });
  it('expressions differ', () => { expect(new Set(RUDI_EXPRESSIONS.map((e) => rudiMarkup(e))).size).toBe(RUDI_EXPRESSIONS.length); });
});
