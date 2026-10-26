import { describe, expect, it } from 'vitest';
import {
  ASPECT_IDS, FILTER_IDS, FILTER_OPS, IDENTITY_XFORM, VIGNETTE_MAX, aspectRect, aspectRatio, applyFilter, applyFrame, applyVignette, clampExportSize, composeXform, compositeExport, cropFov, filterCss, filterXform,
  frameRects, opXform, paintSkyBehind, photoFileName, skyAt, vignetteCss, vignetteFactor, FRAME_IDS, type FrameId,
} from '../../src/render/view/postfx';
import {
  DEFAULT_PHOTO_SETTINGS, HourOverride, PHOTO_FOV_MAX, PHOTO_FOV_MIN, PHOTO_MIN_CLEARANCE, heroState, orbitFromPose, orbitPose, panFocus, sanitizeSettings, type OrbitPose, type OrbitState,
} from '../../src/render/view/PhotoMode';
import { ViewModeMachine } from '../../src/render/view/ViewMode';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { spawnGuests } from '../../src/game/demoResort';
import { fullHash } from '../game/harness';

const px = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => Uint8ClampedArray.from([r, g, b, a]);

describe('filter colour maths', () => {
  it('none = identity; every filter keeps alpha and is deterministic', () => {
    const d = px(10, 120, 250, 77); applyFilter(d, 'none'); expect([...d]).toEqual([10, 120, 250, 77]);
    for (const id of FILTER_IDS) { const a = px(200, 100, 50, 200), b = px(200, 100, 50, 200); applyFilter(a, id); applyFilter(b, id); expect([...a]).toEqual([...b]); expect(a[3]).toBe(200); }
  });
  it('mono makes grey (R = G = B) with Rec.709 weights; grey stays grey under saturate', () => {
    const d = px(255, 0, 0); applyFilter(d, 'mono');
    expect(Math.abs(d[0]! - d[1]!)).toBeLessThanOrEqual(1); expect(Math.abs(d[1]! - d[2]!)).toBeLessThanOrEqual(1);
    const g = px(128, 128, 128); applyFilter(g, 'vivid'); expect(Math.abs(g[0]! - g[1]!)).toBeLessThanOrEqual(2);
  });
  it('spec matrices: saturate(1) = identity, grayscale(0) = identity, hue-rotate(0) = identity, contrast offset 0.5(1-c)', () => {
    for (const op of [{ fn: 'saturate', v: 1 }, { fn: 'grayscale', v: 0 }, { fn: 'sepia', v: 0 }, { fn: 'hue-rotate', v: 0 }, { fn: 'brightness', v: 1 }, { fn: 'contrast', v: 1 }] as const) {
      const x = opXform(op); x.m.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY_XFORM.m[i]!, 6)); x.o.forEach((v) => expect(v).toBeCloseTo(0, 6));
    }
    expect(opXform({ fn: 'contrast', v: 1.2 }).o[0]).toBeCloseTo(-0.1, 6);
    // grayscale(1) rows sum to 1 (white stays white), hue-rotate keeps luminance-ish white
    const gs = opXform({ fn: 'grayscale', v: 1 }); for (let r = 0; r < 3; r++) expect(gs.m[r * 3]! + gs.m[r * 3 + 1]! + gs.m[r * 3 + 2]!).toBeCloseTo(1, 6);
  });
  it('compose applies a first then b; warm pushes red above blue, cool the other way (on neutral grey)', () => {
    const a = opXform({ fn: 'brightness', v: 0.5 }), b = opXform({ fn: 'contrast', v: 2 }), ab = composeXform(a, b);
    // grey 0.8 -> *0.5 = 0.4 -> contrast 2 => (0.4-0.5)*2+0.5 = 0.3
    expect(ab.m[0]! * 0.8 + ab.o[0]!).toBeCloseTo(0.3, 6);
    const w = px(128, 128, 128); applyFilter(w, 'warm'); expect(w[0]!).toBeGreaterThan(w[2]!);
    const c = px(128, 128, 128); applyFilter(c, 'cool'); expect(c[2]!).toBeGreaterThan(c[0]!);
    expect(filterXform('none')).toEqual(IDENTITY_XFORM);
  });
  it('the CSS preview string is built from the same table', () => {
    expect(filterCss('none')).toBe('none');
    for (const id of FILTER_IDS.filter((f) => f !== 'none')) expect(filterCss(id).split(' ').length).toBe(FILTER_OPS[id].length);
    expect(filterCss('mono')).toContain('grayscale(1)'); expect(filterCss('warm')).toContain('hue-rotate(-6deg)');
  });
  it('output is clamped to 0..255', () => { const d = px(255, 255, 255); applyFilter(d, 'vivid'); expect(Math.max(...d)).toBeLessThanOrEqual(255); const e = px(0, 0, 0); applyFilter(e, 'vintage'); expect(Math.min(...e)).toBeGreaterThanOrEqual(0); });
});

describe('vignette', () => {
  it('1 at the centre, darkest at the corners, scales with strength, none at 0', () => {
    expect(vignetteFactor(0, 0, 1)).toBe(1);
    expect(vignetteFactor(1, 1, 1)).toBeCloseTo(1 - VIGNETTE_MAX, 6);
    expect(vignetteFactor(1, 1, 0.5)).toBeGreaterThan(vignetteFactor(1, 1, 1));
    expect(vignetteFactor(1, 1, 0)).toBe(1);
    expect(vignetteCss(0)).toBe('none'); expect(vignetteCss(1)).toContain('radial-gradient');
  });
  it('applyVignette darkens the corners of a flat image, never the centre', () => {
    const w = 21, h = 21, d = new Uint8ClampedArray(w * h * 4).fill(200);
    applyVignette(d, w, h, 1);
    const at = (x: number, y: number): number => d[(y * w + x) * 4]!;
    expect(at(10, 10)).toBe(200); expect(at(0, 0)).toBeLessThan(80); expect(d[3]).toBe(200);
  });
});

describe('frames', () => {
  const W = 400, H = 300;
  it('every frame paints inside the image, none paints nothing, polaroid has the thick bottom margin', () => {
    expect(frameRects('none', W, H)).toEqual([]);
    for (const id of FRAME_IDS.filter((f) => f !== 'none')) for (const r of frameRects(id, W, H)) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(W); expect(r.y + r.h).toBeLessThanOrEqual(H); }
    const pol = frameRects('polaroid', W, H), bottom = pol.find((r) => r.y + r.h === H && r.w === W)!, top = pol.find((r) => r.y === 0)!;
    expect(bottom.h).toBeGreaterThan(top.h * 2.5);
  });
  it('applyFrame paints opaque pixels at the margins and leaves the centre', () => {
    for (const id of ['thin', 'polaroid', 'film'] as FrameId[]) {
      const d = new Uint8ClampedArray(W * H * 4).fill(0); for (let i = 3; i < d.length; i += 4) d[i] = 255;
      applyFrame(d, W, H, id);
      expect(d[(150 * W + 200) * 4]).toBe(0); // centre untouched
      expect(frameRects(id, W, H).length).toBeGreaterThan(0);
      const r = frameRects(id, W, H)[0]!, i = (r.y * W + r.x) * 4; expect(d[i]).toBeGreaterThan(0);
    }
  });
});

describe('aspect and export size', () => {
  it('window = the whole window; presets fit centred inside with the right ratio', () => {
    expect(aspectRect(1600, 1000, 'window')).toEqual({ x: 0, y: 0, w: 1600, h: 1000 });
    for (const id of ASPECT_IDS.filter((a) => a !== 'window')) {
      for (const [w, h] of [[1600, 1000], [900, 1200], [390, 844]]) {
        const r = aspectRect(w!, h!, id);
        expect(r.w / r.h).toBeCloseTo(aspectRatio(id)!, 1);
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(w!); expect(r.y + r.h).toBeLessThanOrEqual(h!);
        expect(Math.abs(r.x * 2 + r.w - w!)).toBeLessThanOrEqual(1); expect(Math.abs(r.y * 2 + r.h - h!)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('crop FOV: the full window keeps the FOV; a shorter rect narrows it consistently (tan ratio)', () => {
    expect(cropFov(55, 1000, 1000)).toBeCloseTo(55, 6);
    const f = cropFov(60, 500, 1000);
    expect(Math.tan((f * Math.PI) / 360)).toBeCloseTo(Math.tan((60 * Math.PI) / 360) * 0.5, 6);
  });
  it('size clamp: 1x/2x scale, GPU max texture and memory budget, aspect preserved, never below 2 px', () => {
    expect(clampExportSize(1600, 1000, 1, 16384)).toMatchObject({ w: 1600, h: 1000, clamped: false });
    expect(clampExportSize(1600, 1000, 2, 16384)).toMatchObject({ w: 3200, h: 2000, clamped: false });
    const t = clampExportSize(3000, 2000, 2, 4096); // 6000x4000 on a 4096 GPU
    expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(4096); expect(t.clamped).toBe(true); expect(t.w / t.h).toBeCloseTo(1.5, 1);
    const m = clampExportSize(3840, 2160, 2, 16384, 16_000_000); // 7680x4320 = 33 MP
    expect(m.w * m.h).toBeLessThanOrEqual(16_000_000); expect(m.clamped).toBe(true); expect(m.w / m.h).toBeCloseTo(16 / 9, 1);
    expect(clampExportSize(1, 1, 1, 1).w).toBeGreaterThanOrEqual(2);
  });
});

describe('export compositing', () => {
  const W = 64, H = 48;
  const sky = { top: [0.1, 0.3, 0.8] as [number, number, number], horizon: [0.9, 0.8, 0.7] as [number, number, number], horizonAt: 0.7 };
  it('paints the sky behind transparent pixels: no transparent pixel remains, rows follow the CSS gradient', () => {
    const d = new Uint8ClampedArray(W * H * 4); // fully transparent frame (the WebGL canvas where nothing was drawn)
    // a 'terrain' block in the lower half is opaque; one half-transparent pixel in the sky
    for (let y = 44; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; d[i] = 240; d[i + 1] = 240; d[i + 2] = 250; d[i + 3] = 255; }
    const half = (5 * W + 5) * 4; d[half] = 255; d[half + 1] = 255; d[half + 2] = 255; d[half + 3] = 128;
    paintSkyBehind(d, W, H, sky);
    for (let i = 3; i < d.length; i += 4) expect(d[i]).toBe(255);
    const top = skyAt(sky, 0.5 / H, [0, 0, 0]), row0 = [d[0], d[1], d[2]];
    expect(row0).toEqual([...top]);
    expect(d[(0 * W + 3) * 4 + 2]).toBeGreaterThan(d[(0 * W + 3) * 4]!); // blue overhead
    const hz = (40 * W + 3) * 4; expect([d[hz], d[hz + 1], d[hz + 2]]).toEqual([Math.round(0.9 * 255), Math.round(0.8 * 255), Math.round(0.7 * 255)]); // below the horizon stop: horizon colour
    expect(d[(46 * W + 3) * 4]).toBe(240); // opaque pixels untouched
    expect(d[half]).toBeGreaterThan(130); expect(d[half]).toBeLessThan(255); // half-transparent white blends with the sky
  });
  it('full pipeline: sky + filter + vignette + frame => opaque, deterministic; skipping sky leaves transparency (that is what the PNG would look like without the fix)', () => {
    const mk = (): Uint8ClampedArray => new Uint8ClampedArray(W * H * 4);
    const a = mk(), b = mk(), c = mk();
    const style = { sky, filter: 'warm' as const, vignette: 0.5, frame: 'thin' as const };
    compositeExport(a, W, H, style); compositeExport(b, W, H, style); compositeExport(c, W, H, { ...style, sky: null });
    expect([...a]).toEqual([...b]);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    expect(c[3]).toBe(0);
  });
  it('mono filter applied to the sky: grey export', () => {
    const d = new Uint8ClampedArray(W * H * 4); compositeExport(d, W, H, { sky, filter: 'mono', vignette: 0, frame: 'none' });
    for (let i = 0; i < d.length; i += 4) expect(Math.abs(d[i]! - d[i + 1]!)).toBeLessThanOrEqual(2);
  });
  it('file name: slugified resort + date', () => {
    expect(photoFileName('Resort — Year 3, Day 12', new Date(2026, 9, 5))).toBe('slope-tycoon-resort-year-3-day-12-2026-10-05.png');
    expect(photoFileName('Ünïcode  Alpen!', new Date(2025, 0, 31))).toBe('slope-tycoon-unicode-alpen-2025-01-31.png');
    expect(photoFileName('***', new Date(2025, 0, 1))).toBe('slope-tycoon-resort-2025-01-01.png');
  });
});

describe('settings and orbit maths', () => {
  const flat = (): number => 5, hilly = (x: number): number => 5 + x * 0.5;
  it('sanitize clamps FOV 20..90, wraps the hour, rejects NaN / unknown ids', () => {
    let s = sanitizeSettings(DEFAULT_PHOTO_SETTINGS, { fov: 500 }); expect(s.fov).toBe(PHOTO_FOV_MAX);
    s = sanitizeSettings(s, { fov: -3 }); expect(s.fov).toBe(PHOTO_FOV_MIN);
    s = sanitizeSettings(s, { fov: Number.NaN }); expect(s.fov).toBe(PHOTO_FOV_MIN);
    s = sanitizeSettings(s, { hour: 25.5 }); expect(s.hour).toBeCloseTo(1.5, 6);
    s = sanitizeSettings(s, { hour: -1 }); expect(s.hour).toBe(23);
    s = sanitizeSettings(s, { hour: null }); expect(s.hour).toBeNull();
    s = sanitizeSettings(s, { filter: 'bogus' as never, frame: 'x' as never, aspect: 'y' as never, vignette: 9 }); expect([s.filter, s.frame, s.aspect, s.vignette]).toEqual(['none', 'none', 'window', 1]);
    expect(sanitizeSettings(s, { scale: 3 as never }).scale).toBe(1);
  });
  it('orbit pose: camera sits `dist` from the focus on the opposite side of the view direction and looks at it', () => {
    const o: OrbitState = { fx: 50, fz: 50, lift: 2, yaw: 0.7, pitch: -0.5, dist: 20 };
    const p = orbitPose(o, flat, 128, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 });
    expect(Math.hypot(p.x - 50, p.y - 7, p.z - 50)).toBeCloseTo(20, 4);
    // forward vector of the camera (rotation YXZ, looking down -Z) points at the focus
    const fwd = [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
    expect(p.x + fwd[0]! * 20).toBeCloseTo(50, 4); expect(p.y + fwd[1]! * 20).toBeCloseTo(7, 4); expect(p.z + fwd[2]! * 20).toBeCloseTo(50, 4);
  });
  it('orbitFromPose round-trips a free pose (ride -> photo keeps the view)', () => {
    const st = orbitFromPose(40, 30, 60, 1.1, -0.2, 12, flat);
    const p = orbitPose(st, flat, 128, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 });
    expect(p.x).toBeCloseTo(40, 4); expect(p.y).toBeCloseTo(30, 4); expect(p.z).toBeCloseTo(60, 4); expect(p.yaw).toBeCloseTo(1.1, 6); expect(p.pitch).toBeCloseTo(-0.2, 6);
  });
  it('the camera never goes below the surface (pitch is raised to clear a slope)', () => {
    const o: OrbitState = { fx: 30, fz: 30, lift: 0, yaw: Math.PI / 2, pitch: 0.4, dist: 25 }; // looking up from below a rising slope
    const p = orbitPose(o, hilly, 128, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 });
    expect(p.y).toBeGreaterThanOrEqual(hilly(p.x) + PHOTO_MIN_CLEARANCE - 1e-6);
  });
  it('panFocus moves along the camera yaw; heroState frames the village', () => {
    const o: OrbitState = { fx: 0, fz: 0, lift: 0, yaw: 0, pitch: -0.5, dist: 10 };
    panFocus(o, 0, 1); expect(o.fz).toBeCloseTo(-1, 6); expect(o.fx).toBeCloseTo(0, 6); // yaw 0 looks toward -z
    panFocus(o, 1, 0); expect(o.fx).toBeCloseTo(1, 6);
    const h = heroState(64, 100, 128); expect(h.dist).toBeGreaterThanOrEqual(16); expect(h.pitch).toBeLessThan(0);
  });
});

describe('hour override is render-only and restores', () => {
  it('begin remembers the lock, apply sets, null returns to it, end restores exactly', () => {
    let lock: number | null = 13.5; const log: Array<number | null> = [];
    const set = (h: number | null): void => { lock = h; log.push(h); };
    const o = new HourOverride(() => lock, set);
    o.apply(5); expect(lock).toBe(13.5); // not active yet: ignored
    o.begin(); o.apply(18); expect(lock).toBe(18); o.apply(null); expect(lock).toBe(13.5); o.apply(7); o.end(); expect(lock).toBe(13.5);
    o.apply(3); expect(lock).toBe(13.5);
    lock = null; o.begin(); o.apply(20); o.end(); expect(lock).toBeNull();
  });
});

describe('view mode transitions photo <-> iso <-> ride', () => {
  it('legal transitions both ways; walk is reachable from iso only (not from ride); listeners see from/to', () => {
    const m = new ViewModeMachine(); const seen: string[] = [];
    m.onChange((to, from) => seen.push(`${from}>${to}`));
    expect(m.set('photo')).toBe(true); expect(m.set('ride')).toBe(true); expect(m.set('photo')).toBe(true); expect(m.set('iso')).toBe(true); expect(m.set('ride')).toBe(true); expect(m.set('iso')).toBe(true);
    expect(m.set('ride')).toBe(true); expect(m.set('walk')).toBe(false); expect(m.set('iso')).toBe(true); expect(m.set('iso')).toBe(false);
    expect(m.set('walk')).toBe(true); expect(m.set('photo')).toBe(true); expect(m.set('walk')).toBe(true); expect(m.set('iso')).toBe(true);
    expect(seen).toEqual(['iso>photo', 'photo>ride', 'ride>photo', 'photo>iso', 'iso>ride', 'ride>iso', 'iso>ride', 'ride>iso', 'iso>walk', 'walk>photo', 'photo>walk', 'walk>iso']);
  });
});

describe('stateHash determinism', () => {
  it('is identical after 2 sim days with photo mode toggled (render-only maths running every tick)', () => {
    const go = (photo: boolean): string => {
      const sim = createSim({ size: 64, seed: 11, now: () => 0 });
      buildStarterResort(sim);
      spawnGuests(sim, 40, 'skiers', 1);
      const o: OrbitState = { fx: 32, fz: 32, lift: 1, yaw: 0, pitch: -0.5, dist: 20 }, out: OrbitPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fy: 0 };
      let lock: number | null = null; const ho = new HourOverride(() => lock, (h) => { lock = h; });
      if (photo) ho.begin();
      for (let t = 1; t <= 480; t++) {
        sim.tick(1);
        if (!photo) continue;
        o.yaw += 0.01; panFocus(o, 0.1, 0.05); orbitPose(o, (x, z) => x * 0.1 + z * 0.05, 64, out); ho.apply((t / 20) % 24);
        const d = new Uint8ClampedArray(16 * 16 * 4); if (t % 100 === 0) compositeExport(d, 16, 16, { sky: { top: [0, 0, 1], horizon: [1, 1, 1], horizonAt: 0.5 }, filter: 'vivid', vignette: 0.4, frame: 'polaroid' });
      }
      if (photo) ho.end();
      return fullHash(sim);
    };
    expect(go(true)).toBe(go(false));
  }, 60000);
});
