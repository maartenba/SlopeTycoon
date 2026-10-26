import { describe, expect, it } from 'vitest';
import { siteUrl } from '../../src/ui/siteLink';

describe('siteUrl', () => {
  it('links back to the website only when served under /play/', () => {
    expect(siteUrl('', { pathname: '/play/' })).toBe('../');
    expect(siteUrl('guide/', { pathname: '/slopetycoon/play/' })).toBe('../guide/');
    expect(siteUrl('guide/', { pathname: '/slopetycoon/play/index.html' })).toBe('../guide/');
    expect(siteUrl('', { pathname: '/' })).toBeNull();
    expect(siteUrl('', { pathname: '/slopetycoon/' })).toBeNull();
  });
});
