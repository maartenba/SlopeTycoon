import { describe, expect, it } from 'vitest';
import { snowlineFraction } from '../../src/config/balance';
import { Economy } from '../../src/sim/Economy';
import { constructionMultiplierAt, isSummer, snowlineHeight, worldScaleFor, altitudeMetres, freezeFromTemp, temperatureAtAltitude } from '../../src/sim/Season';
import { BUILDINGS } from '../../src/config/buildings';

describe('snowline curve', () => {
  it('is below the valley floor in winter, rises through spring, tops the summits in summer, falls in autumn', () => {
    for (const d of [135, 150, 165]) expect(snowlineFraction(d)).toBeLessThan(0);
    let prev = snowlineFraction(0);
    for (let d = 2.5; d <= 60; d += 2.5) { const v = snowlineFraction(d); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    expect(snowlineFraction(60)).toBeGreaterThan(1.05);
    expect(snowlineFraction(30)).toBeLessThan(1); // highest peaks keep snow at the start of summer
    prev = snowlineFraction(75);
    for (let d = 80; d <= 130; d += 5) { const v = snowlineFraction(d); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
  });
  it('is cyclic', () => { expect(snowlineFraction(180 + 15)).toBeCloseTo(snowlineFraction(15), 9); });
  it('scales to every map size (world units)', () => {
    for (const n of [64, 128, 256]) {
      const sc = worldScaleFor(n);
      expect(snowlineHeight({ day: 150, minute: 0 }, sc)).toBeLessThan(sc.baseWorld);
      expect(snowlineHeight({ day: 60, minute: 0 }, sc)).toBeGreaterThan(sc.baseWorld + sc.reliefWorld);
    }
  });
  it('lapse rate: 0 °C at the snowline, colder above', () => {
    const sc = worldScaleFor(128);
    const T = 8;
    const line = sc.baseWorld + sc.reliefWorld * 0.5;
    expect(temperatureAtAltitude(T, line, sc)).toBeCloseTo(0, 9);
    expect(temperatureAtAltitude(T, line + 3, sc)).toBeLessThan(0);
  });
  it('altitude and freeze helpers', () => {
    expect(altitudeMetres(0)).toBe(1200);
    expect(freezeFromTemp(-6)).toBe(1);
    expect(freezeFromTemp(5)).toBe(0);
  });
});

describe('summer construction discount', () => {
  it('halves construction costs in summer only', () => {
    const e = new Economy({ money: 0 });
    const date = { day: 0 };
    e.setSeasonHook(() => constructionMultiplierAt(date));
    const cost = BUILDINGS.cafe!.cost;
    date.day = 50; // summer = months 2..5 => days 30..89
    expect(isSummer(date)).toBe(true);
    expect(cost * e.constructionMultiplier()).toBe(cost * 0.5);
    for (const day of [0, 29, 90, 125, 179]) { date.day = day; expect(e.constructionMultiplier()).toBe(1); }
    date.day = 30; expect(e.constructionMultiplier()).toBe(0.5);
    date.day = 89; expect(e.constructionMultiplier()).toBe(0.5);
  });
});
