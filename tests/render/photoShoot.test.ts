import { describe, expect, it } from 'vitest';
import { PHOTO_SHOOT, PhotoShoots, flashLevel, nextShotAfter, posing, sessionLength, shotTime, shownShots } from '../../src/render/photoShoot';

describe('photographer shooting timing (pure)', () => {
  it('shot times are deterministic, increasing, and gaps stay in the configured range', () => {
    for (let id = 1; id < 40; id++) {
      expect(shotTime(id, 0)).toBe(PHOTO_SHOOT.raiseS);
      for (let k = 1; k < 8; k++) {
        const gap = shotTime(id, k) - shotTime(id, k - 1);
        expect(gap).toBeGreaterThanOrEqual(PHOTO_SHOOT.gapS[0] - 1e-9); expect(gap).toBeLessThanOrEqual(PHOTO_SHOOT.gapS[1] + 1e-9);
      }
      expect(shotTime(id, 3)).toBe(shotTime(id, 3));
    }
  });
  it('shown shots are clamped to 1..maxShots', () => { expect(shownShots(0)).toBe(1); expect(shownShots(5)).toBe(5); expect(shownShots(99)).toBe(PHOTO_SHOOT.maxShots); });
  it('the camera is up from the event until holdS after the last shot', () => {
    const id = 7, shots = 4, len = sessionLength(id, shots);
    expect(len).toBeCloseTo(shotTime(id, 3) + PHOTO_SHOOT.holdS, 9);
    expect(posing(id, shots, -0.01)).toBe(false); expect(posing(id, shots, 0)).toBe(true); expect(posing(id, shots, len - 0.01)).toBe(true); expect(posing(id, shots, len)).toBe(false);
  });
  it('the flash is brief: 1 at a shot, 0 after flashS, and 0 between shots', () => {
    const id = 11, shots = 5, t = shotTime(id, 2);
    expect(flashLevel(id, shots, t)).toBeCloseTo(1, 9);
    expect(flashLevel(id, shots, t + PHOTO_SHOOT.flashS / 2)).toBeCloseTo(0.5, 6);
    expect(flashLevel(id, shots, t + PHOTO_SHOOT.flashS)).toBe(0);
    expect(flashLevel(id, shots, t - 0.01)).toBe(0); expect(flashLevel(id, shots, 0)).toBe(0);
    expect(PHOTO_SHOOT.flashS).toBeLessThanOrEqual(0.15);
    // no overlap between two flashes: the minimum gap is longer than a flash
    expect(PHOTO_SHOOT.gapS[0]).toBeGreaterThan(PHOTO_SHOOT.flashS * 2);
  });
  it('nextShotAfter finds the next shot', () => { const id = 3; expect(nextShotAfter(id, 4, 0)).toBe(0); expect(nextShotAfter(id, 4, shotTime(id, 1) + 0.01)).toBe(2); expect(nextShotAfter(id, 4, 999)).toBe(4); });
  it('PhotoShoots reports every shot once, skips stale ones, and expires', () => {
    const p = new PhotoShoots(), id = 21;
    p.start(id, 100, 3);
    expect(p.isPosing(id, 100.1)).toBe(true);
    let total = 0;
    for (let c = 100; c < 100 + sessionLength(id, 3) + 1; c += 0.05) total += p.dueShots(id, c);
    expect(total).toBe(3);
    expect(p.isPosing(id, 100 + sessionLength(id, 3) + 0.01)).toBe(false); expect(p.size).toBe(0);
    p.start(id, 0, 3); expect(p.dueShots(id, 50)).toBe(0); // a long frame (paused, tab hidden): the old shots are not replayed as flashes
    expect(p.dueShots(99, 1)).toBe(0); expect(p.isPosing(99, 1)).toBe(false);
  });
});

import { GState, GuestStore } from '../../src/sim/guests/Guest';
import { Gear, HairStyle } from '../../src/render/guestAppearance';
import { GuestRenderer } from '../../src/render/GuestRenderer';
import { buildGearGeometry, visibleTriangles } from '../../src/render/meshes/Figures';

describe('Gear.Shoot (raised camera pose)', () => {
  it('keeps the figure triangle budget of the walking figure (same parts, only the camera moves)', () => {
    for (const near of [false, true]) for (const pack of [false, true]) expect(visibleTriangles(buildGearGeometry(Gear.Shoot, near), HairStyle.Beret, pack)).toBe(visibleTriangles(buildGearGeometry(Gear.Walk, near), HairStyle.Beret, pack));
  });
  const mk = (): { st: GuestStore; r: GuestRenderer; slot: number } => {
    const st = new GuestStore(8);
    const slot = st.add({ x: 10, y: 10, z: 0, type: 0, skill: 1, budget: 1, group: 0, mode: 0, overnight: false, leaveDay: 1, tick: 0 });
    st.state[slot] = GState.Walking; st.px[slot] = st.x[slot]!; st.py[slot] = st.y[slot]!; // standing
    return { st, r: new GuestRenderer(st), slot };
  };
  it('a standing guest in a photo session is drawn with the Shoot gear and flashes once per shot, then goes back to Walk', () => {
    const { st, r, slot } = mk();
    r.frameSeconds = 0.05;
    const flashes: number[] = []; r.onFlash = (x, y, z, k): void => { flashes.push(x, y, z, k); };
    r.startShoot(st.id[slot]!, 3);
    let tick = 0, shootFrames = 0, walkAfter = 0;
    for (let f = 0; f < 400; f++) { tick = Math.floor(f / 4); r.update((f % 4) / 4, 20, undefined, tick); const c = r.batchCounts(); if (c[Gear.Shoot]) shootFrames++; else if (shootFrames > 0 && c[Gear.Walk]) walkAfter++; }
    expect(shootFrames).toBeGreaterThan(20); expect(walkAfter).toBeGreaterThan(0);
    expect(flashes.length / 4).toBe(3);
    expect(flashes.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('a moving guest is never swapped to the shooting pose', () => {
    const { st, r, slot } = mk();
    st.px[slot] = st.x[slot]! - 0.1; r.frameSeconds = 0.05;
    r.startShoot(st.id[slot]!, 3); r.update(0.5, 20); expect(r.batchCounts()[Gear.Shoot]).toBe(0);
  });
});
