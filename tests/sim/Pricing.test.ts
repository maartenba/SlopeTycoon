import { PASS_PRICES } from '@/config/prices';
import { describe, expect, it } from 'vitest';
import { Pricing, isHoliday } from '@/sim/Pricing';
import { weekdayOf } from '@/sim/Clock';
import { mixVolume } from '@/sim/Elasticity';
import { TYPE_MIX } from '@/sim/guests/Spawner';

const bound = (day: number, o: { powder?: boolean; stars?: number; year?: number } = {}): Pricing => {
  const p = new Pricing();
  p.bind({ date: () => ({ year: o.year ?? 0, day }), powder: () => !!o.powder, stars: () => o.stars ?? 3 });
  return p;
};
// year 0: day%7 == weekday. winter = days 120..179 (months 8..11 of the 15-day calendar).
const MON = 126, FRI = 130, SAT = 131, SUMMER_MON = 35;

describe('Pricing menu', () => {
  it('defaults, clamps and free toggle', () => {
    const p = new Pricing();
    expect(p.get('dayPass')).toBe(45);
    expect(p.get('night:chalet')).toBe(40);
    p.set('dayPass', 0); expect(p.get('dayPass')).toBe(11); // 25 % floor
    p.set('dayPass', 9999); expect(p.get('dayPass')).toBe(120);
    p.setFree('dayPass', true); expect(p.get('dayPass')).toBe(0); expect(p.isFree('dayPass')).toBe(true);
    p.setFree('seasonPass', true); expect(p.isFree('seasonPass')).toBe(false); // season pass can never be free
    p.reset('dayPass'); expect(p.get('dayPass')).toBe(45);
  });
  it('weekday concept: 7-day weeks from the day index', () => {
    expect(weekdayOf({ year: 0, day: 0 })).toBe(0);
    expect(weekdayOf({ year: 0, day: SAT })).toBe(5);
    expect(weekdayOf({ year: 1, day: 0 })).toBe(180 % 7);
  });
  it('day classes: weekend/holiday/powder = peak, Mon-Thu off-peak, Fri regular', () => {
    expect(bound(SAT).dayClass()).toBe('peak');
    expect(bound(MON).dayClass()).toBe('off');
    expect(bound(FRI).dayClass()).toBe('regular');
    expect(isHoliday(177)).toBe(true);
    expect(bound(177).dayClass()).toBe('peak');
    expect(bound(MON, { powder: true }).dayClass()).toBe('peak');
    expect(bound(SUMMER_MON, { powder: true }).dayClass()).toBe('off'); // no powder days in summer
  });
  it('seasonal schedule multipliers apply to day pass, attractions and lodging but not season passes', () => {
    const p = bound(SAT);
    p.setSchedule('winter', 'peak', 1.3); p.setSchedule('winter', 'off', 0.8);
    expect(p.effective('dayPass')).toBe(58.5);
    expect(p.effective('night:chalet')).toBe(52);
    expect(p.effective('stuntPark')).toBe(13);
    expect(p.effective('seasonPass')).toBe(PASS_PRICES.seasonPass.price);
    const off = bound(MON); off.schedule = p.schedule;
    expect(off.effective('dayPass')).toBe(36);
    const summer = bound(SUMMER_MON); summer.setSchedule('summer', 'off', 0.7);
    expect(summer.effective('dayPass')).toBe(31.5);
  });
  it('powder day surcharge only on fresh-snow winter days and only when enabled', () => {
    const p = bound(MON, { powder: true });
    p.setSchedule('winter', 'peak', 1.1);
    expect(p.effective('dayPass')).toBe(49.5);
    p.powderSurcharge = true;
    expect(p.effective('dayPass')).toBe(59.4);
    const dry = bound(MON); dry.powderSurcharge = true; dry.setSchedule('winter', 'off', 1);
    expect(dry.effective('dayPass')).toBe(45);
  });
  it('shop / restaurant markup scales prices', () => {
    const p = new Pricing();
    p.set('markup:restaurants', 135); p.set('markup:shops', 80);
    expect(p.effective('cafe')).toBe(8.1);
    expect(p.effective('shop')).toBe(12);
    expect(p.effective('iceRink')).toBe(6);
  });
  it('fair value follows quality; verdicts cheap / fair / expensive', () => {
    const lo = bound(MON, { stars: 0 }), hi = bound(MON, { stars: 5 });
    expect(hi.fairOf('dayPass')).toBeGreaterThan(lo.fairOf('dayPass'));
    const p = new Pricing();
    expect(p.verdictOf('dayPass')).toBe('fair');
    p.set('dayPass', 100); expect(p.verdictOf('dayPass')).toBe('expensive');
    p.set('dayPass', 20); expect(p.verdictOf('dayPass')).toBe('cheap');
  });
  it('extreme prices lower the value-for-money score; free passes are capped', () => {
    const p = new Pricing();
    const base = p.valueScore();
    expect(base).toBeGreaterThan(0.4); expect(base).toBeLessThan(0.6);
    p.set('dayPass', 120); p.set('markup:shops', 160); p.set('markup:restaurants', 160);
    expect(p.valueScore()).toBeLessThan(base - 0.1);
    const f = new Pricing(); f.setFree('dayPass', true);
    expect(f.valueScore()).toBeLessThan(base + 0.05); // free pass is no value bonus
  });
  it('price shock: a big day-to-day jump lowers value temporarily and decays', () => {
    const p = new Pricing();
    p.newDay(); expect(p.shock).toBe(0);
    const calm = p.valueScore();
    p.set('dayPass', 100); p.newDay();
    expect(p.shock).toBeGreaterThan(0.5);
    expect(p.valueScore()).toBeLessThan(calm);
    for (let i = 0; i < 12; i++) p.newDay();
    expect(p.shock).toBe(0);
  });
  it('no infinite-money exploit: capped pass x volume loses to balanced; free pass earns 0', () => {
    const rev = (p: Pricing): number => p.get('dayPass') * mixVolume(TYPE_MIX.winter, p.ratioOf('dayPass'));
    const balanced = new Pricing(), cap = new Pricing(), free = new Pricing();
    cap.set('dayPass', 9999); free.setFree('dayPass', true);
    expect(rev(cap)).toBeLessThan(rev(balanced));
    expect(rev(free)).toBe(0);
  });
  it('serialises and reloads everything', () => {
    const p = new Pricing();
    p.set('dayPass', 60); p.setFree('iceRink', true); p.setSchedule('summer', 'off', 0.75); p.powderSurcharge = true; p.newDay();
    const q = new Pricing(); q.load(JSON.parse(JSON.stringify(p.serialize())));
    expect(q.serialize()).toEqual(p.serialize());
    expect(q.get('dayPass')).toBe(60); expect(q.isFree('iceRink')).toBe(true);
  });
});
