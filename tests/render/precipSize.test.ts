import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Precipitation, precipPixelScale, PRECIP_REF_HEIGHT } from '@/render/Precipitation';

describe('snow keeps its apparent size on high-resolution screens', () => {
  it('scale is 1 up to the 1080 px reference and grows in proportion above it (capped at 4)', () => {
    expect(PRECIP_REF_HEIGHT).toBe(1080);
    expect(precipPixelScale(720)).toBe(1); // small frames keep the old look
    expect(precipPixelScale(1080)).toBe(1);
    expect(precipPixelScale(1440)).toBeCloseTo(4 / 3, 6);
    expect(precipPixelScale(2160)).toBe(2);
    expect(precipPixelScale(1440 * 4)).toBe(4);
    expect(precipPixelScale(0)).toBe(1); expect(precipPixelScale(NaN)).toBe(1);
  });
  it('the point size in pixels is the same share of the frame height at 2560x1440, 1280x720 at DPR 2 and 3840x2160 as at 1080p', () => {
    const p = new Precipitation(64); const snow = p.group.children[0] as THREE.Points; const u = (snow.material as THREE.ShaderMaterial).uniforms;
    const px = (h: number): number => { p.update(0.016, new THREE.Vector3(), { precip: 'snow', intensity: 1, wind: 0.1, viewHeight: h }); return (u.uSize!.value as number) * 9 * (u.uPx!.value as number); };
    const base = px(1080); expect(base).toBeCloseTo(3.15, 6);
    expect(px(2160) / 2160).toBeCloseTo(base / 1080, 6); // 4K
    expect(px(1440) / 1440).toBeCloseTo(base / 1080 * (1440 / 1440), 1); // 1440: within the reference share
    expect(px(720 * 2)).toBe(px(1440)); // 1280x720 CSS at DPR 2 draws a 1440 px buffer: same as 2560x1440 at DPR 1
    expect(px(720)).toBe(base); // 720p is untouched
    p.sizeScale = 2; expect(px(1080)).toBeCloseTo(base * 2, 6); // the promo film's own boost
    p.dispose();
  });
  it('rain does not use the point size (line segments)', () => {
    const p = new Precipitation(8); expect(p.group.children[1]).toBeInstanceOf(THREE.LineSegments); p.dispose();
  });
});
