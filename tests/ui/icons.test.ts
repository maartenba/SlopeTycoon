// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { icon, smileyIcon, starFills, starRow, weatherIconName } from '../../src/ui/icons';

describe('rating stars', () => {
  it('maps a rating to full / half / empty fills', () => {
    expect(starFills(0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
    expect(starFills(3)).toEqual(['full', 'full', 'full', 'empty', 'empty']);
    expect(starFills(3.5)).toEqual(['full', 'full', 'full', 'half', 'empty']);
    expect(starFills(4.4)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFills(4.8)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(starFills(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });
  it('clamps / sanitises', () => {
    expect(starFills(-2)).toEqual(starFills(0));
    expect(starFills(9)).toEqual(starFills(5));
    expect(starFills(Number.NaN)).toEqual(starFills(0));
  });
  it('starRow draws 5 outlines (+ one overlay for a half star) as SVG, never font glyphs', () => {
    const svg = starRow(2.5);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.querySelectorAll('path').length).toBe(6);
    expect(starRow(3).querySelectorAll('path').length).toBe(5);
    expect(svg.textContent).toBe('');
    expect(svg.getAttribute('aria-label')).toContain('2.5');
  });
});

describe('icons', () => {
  it('builds aria-hidden SVGs', () => {
    const i = icon('moon', 16);
    expect(i.getAttribute('aria-hidden')).toBe('true');
    expect(i.getAttribute('width')).toBe('16');
    expect(i.querySelector('path')).toBeTruthy();
  });
  it('maps weather kinds and happiness', () => {
    expect(weatherIconName('clear')).toBe('sun');
    expect(weatherIconName('heavySnow')).toBe('snow');
    expect(weatherIconName('storm')).toBe('storm');
    expect(smileyIcon(0.9)).toBe('smile');
    expect(smileyIcon(0.5)).toBe('meh');
    expect(smileyIcon(0.1)).toBe('frown');
  });
});
