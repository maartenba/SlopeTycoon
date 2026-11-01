import { describe, expect, it } from 'vitest';
import { paintSkyBehind } from '../../src/render/view/postfx';
import { NO_DECOR, paintSkyDecor } from '../../src/render/atmosphere/SkyOverlay';
import { FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogUniforms, fogVert } from '../../src/render/Fog';

const W = 160, H = 100;
const sky = { top: [0.04, 0.07, 0.2] as [number, number, number], horizon: [0.1, 0.12, 0.3] as [number, number, number], horizonAt: 0.7 };
const transparent = (): Uint8ClampedArray => new Uint8ClampedArray(W * H * 4);

describe('photo export keeps the atmosphere (no fake effects: the saved PNG matches the screen)', () => {
  it('no decor = the plain gradient; with stars + a full moon the sky has bright pixels', () => {
    const plain = transparent(); paintSkyBehind(plain, W, H, sky);
    const none = transparent(); paintSkyBehind(none, W, H, { ...sky, decor: NO_DECOR });
    expect(Array.from(none)).toEqual(Array.from(plain));
    const night = transparent(); paintSkyBehind(night, W, H, { ...sky, decor: { stars: 1, moonPhase: 0.5, moonAlpha: 1, rainbow: 0, horizonAt: 0.7 } });
    let bright = 0, differs = 0; for (let i = 0; i < night.length; i += 4) { if (night[i]! > 120) bright++; if (night[i] !== plain[i]) differs++; }
    expect(bright).toBeGreaterThan(40); expect(differs).toBeGreaterThan(100);
    for (let i = 3; i < night.length; i += 4) expect(night[i]).toBe(255);
  });
  it('the new moon draws no disc; the phase moves the lit side', () => {
    const buf = (phase: number): Uint8ClampedArray => { const b = new Uint8ClampedArray(W * H * 3); paintSkyDecor(b, W, H, { stars: 0, moonPhase: phase, moonAlpha: 1, rainbow: 0, horizonAt: 0.7 }); return b; };
    const lit = (b: Uint8ClampedArray, left: boolean): number => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[(y * W + x) * 3]! > 100 && (x < W * 0.78) === left) n++; return n; };
    expect(lit(buf(0), true) + lit(buf(0), false)).toBe(0);
    const waxing = buf(0.25), waning = buf(0.75);
    expect(lit(waxing, false)).toBeGreaterThan(lit(waxing, true)); expect(lit(waning, true)).toBeGreaterThan(lit(waning, false));
  });
  it('rainbow paints coloured pixels only when asked', () => {
    const b = new Uint8ClampedArray(W * H * 3); paintSkyDecor(b, W, H, { ...NO_DECOR, rainbow: 1 });
    expect(b.some((v) => v > 0)).toBe(true);
    const c = new Uint8ClampedArray(W * H * 3); paintSkyDecor(c, W, H, NO_DECOR); expect(c.every((v) => v === 0)).toBe(true);
  });
});

describe('fog shader contract', () => {
  it('default valley fog amount is 0 (exact old look, no recompile when toggled) and the GLSL never reads gl_FragCoord', () => {
    expect(fogUniforms.uValleyFog.value.x).toBe(0);
    for (const g of [FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogVert('vp')]) expect(g).not.toContain('gl_FragCoord');
    expect(FOG_FRAG).toContain('if (uValleyFog.x > 0.001)');
    expect(fogVert('vp')).toContain('vFogW');
  });
});
