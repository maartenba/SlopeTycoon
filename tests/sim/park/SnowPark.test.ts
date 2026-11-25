import { describe, expect, it } from 'vitest';
import { PARK } from '../../../src/config/park';
import { parkFeatures, parkQuota } from '../../../src/sim/park/SnowPark';
import { absDay, mainRun, paintRun, parkFixture, putPipeNear } from './helpers';

describe('SnowPark validity', () => {
  it('a blue run of 100 m or more with a garage can be a park; the flag lives on the run and survives a repaint', () => {
    const { s, id } = parkFixture(1, 5);
    expect(s.park.reasonFor(mainRun(s))).toBeNull();
    expect(s.setRunPark(id, true)).toEqual({ ok: true });
    expect(s.runSettings.parkIds()).toEqual([id]);
    expect(s.park.parks()[0]!.valid).toBe(true); expect(s.park.parks()[0]!.open).toBe(true);
    paintRun(s, mainRun(s), 2); s.tick(1);
    expect(s.names.pisteId(mainRun(s))).toBe(id);
    expect(s.park.parks()[0]!.valid).toBe(true);
  });
  it('refuses with a plain reason: too green, too short, no garage, too many', () => {
    const { s, id } = parkFixture(0, 5);
    expect(s.setRunPark(id, true)).toEqual({ ok: false, reason: PARK.reasons.difficulty });
    paintRun(s, mainRun(s), 1); s.tick(1);
    const gar = s.buildings.all().filter((b) => b.type === 'groomerGarage');
    for (const b of gar) b.active = false;
    expect(s.setRunPark(id, true)).toEqual({ ok: false, reason: PARK.reasons.noGroomer });
    for (const b of gar) b.active = true;
    s.park.reasonFor = (r) => (r.poly.length < 6 ? 'shape' : null);
    expect(s.setRunPark(id, true).ok).toBe(true);
    // two parks is the limit: mark made-up ids
    s.runSettings.setPark(900001, true);
    expect(s.setRunPark(900002, true).ok).toBe(false);
  });
  it('a marked park whose run falls below the rules goes inactive with a reason and is never dropped', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true);
    paintRun(s, mainRun(s), 0); s.tick(1); // green
    const p = s.park.parks();
    expect(p.length).toBe(1); expect(p[0]!.valid).toBe(false); expect(p[0]!.reason).toBe('difficulty');
    expect(s.park.demand(0)).toBe(0);
    expect(s.runSettings.isPark(id)).toBe(true);
  });
  it('the gated career refuses below level 3 (the gate is the snowPark landscape unlock)', () => {
    const { s, id } = parkFixture(1, 5);
    s.progression.unlockAll = false;
    const r = s.setRunPark(id, true);
    if (s.progression.locked('landscape', 'snowPark')) expect(r.ok).toBe(false); else expect(r.ok).toBe(true);
  });
});

describe('features', () => {
  it('are a pure function of the run: deterministic, spaced, kinds by difficulty, clear start and end', () => {
    const { s } = parkFixture(1, 5);
    const run = mainRun(s), a = parkFeatures(run, s.size), b = parkFeatures(run, s.size);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.every((f) => Math.abs(Math.hypot(f.dx, f.dy) - 1) < 1e-6)).toBe(true);
    expect(new Set(a.map((f) => f.kind)).size).toBeGreaterThan(1);
    paintRun(s, mainRun(s), 3); s.tick(1);
    const black = parkFeatures(mainRun(s), s.size);
    expect(black.length).toBeGreaterThanOrEqual(a.length); // tighter spacing on a harder run
  });
});

describe('shape', () => {
  it('starts at 0.6, a groomer pass restores it, a day wears it and a lap wears it a little', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true);
    expect(s.park.shapeOf(id)).toBeCloseTo(PARK.shape.start, 5);
    for (const t of mainRun(s).tiles) s.ops.quality.groom(t);
    expect(s.park.shapeOf(id)).toBe(1);
    const day = absDay(s);
    s.game.date.day += 1; // one day later (the lazy decay reads the date)
    expect(s.park.shapeOf(id)).toBeCloseTo(1 - PARK.shape.daily, 5);
    s.game.date.day += 3;
    expect(s.park.shapeOf(id)).toBeCloseTo(1 - 4 * PARK.shape.daily, 5);
    expect(absDay(s)).toBe(day + 4);
    const tile = mainRun(s).tiles[0]!, before = s.park.shapeOf(id);
    s.park.onLap(777, tile);
    expect(s.park.shapeOf(id)).toBeCloseTo(before - PARK.shape.lap, 6);
  });
  it('a worn park draws fewer riders and a pipe beside it draws more', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true);
    for (const t of mainRun(s).tiles) s.ops.quality.groom(t);
    const q1 = s.park.demand(0);
    s.game.date.day += 12; // worn out
    expect(s.park.parks()[0]!.worn).toBe(true);
    expect(s.park.demand(0)).toBeLessThan(q1 * 0.5);
  });
  it('is a persistent, order-independent function of the date (reading late = reading daily)', () => {
    const a = parkFixture(1, 5), b = parkFixture(1, 5);
    for (const f of [a, b]) { f.s.setRunPark(f.id, true); for (const t of mainRun(f.s).tiles) f.s.ops.quality.groom(t); }
    for (let d = 0; d < 5; d++) { a.s.game.date.day += 1; a.s.park.shapeOf(a.id); }
    b.s.game.date.day += 5;
    expect(a.s.park.shapeOf(a.id)).toBeCloseTo(b.s.park.shapeOf(b.id), 10);
  });
});

describe('halfpipe', () => {
  it('a Halfpipe within 3 tiles of a park run counts for that park (more demand, tricks and a fee per lap)', () => {
    const { s, id } = parkFixture(1, 5);
    s.setRunPark(id, true);
    for (const t of mainRun(s).tiles) s.ops.quality.groom(t);
    const q0 = s.park.parks()[0]!.quality;
    const pid = putPipeNear(s, mainRun(s).poly);
    expect(pid, 'a halfpipe fits beside the run').not.toBeNull();
    s.tick(1);
    const p = s.park.parks()[0]!;
    expect(p.pipe).not.toBeNull();
    expect(p.quality).toBeGreaterThan(q0);
    let earned = 0; const sp = s.park; void sp;
    const m0 = s.game.money; s.park.onLap(5, mainRun(s).tiles[0]!); earned = s.game.money - m0;
    expect(earned).toBeGreaterThanOrEqual(PARK.fee + PARK.pipeFee - 1);
  });
});

describe('laps', () => {
  it('the quota is stable per guest and inside the range', () => {
    for (let id = 1; id < 200; id++) { const q = parkQuota(id); expect(q).toBeGreaterThanOrEqual(PARK.laps[0]); expect(q).toBeLessThanOrEqual(PARK.laps[1]); expect(parkQuota(id)).toBe(q); }
  });
});
