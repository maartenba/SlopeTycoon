/** Chapel + weddings (0.7.1, docs/chapel.md): the pure schedule, the timeline (bell, ceremony, feast, income), village charm, save round trip, no wedding without a chapel. */
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { anchors, buildNetwork, findSite, placeSite, planPathTo, planRoadTo } from '../../src/tutorial/suggest';
import { BUILDINGS } from '../../src/config/buildings';
import { CHAPEL, WEDDING } from '../../src/config/wedding';
import { DAYS_PER_YEAR } from '../../src/config/balance';
import { Wedding, weddingPlan } from '../../src/sim/events/Wedding';
import { seasonOf, weekdayOf } from '../../src/sim/Clock';
import { Achievements } from '../../src/sim/meta/Achievements';
import { ACHIEVEMENT_BY_ID } from '../../src/config/achievements';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';

const make = (seed = 61): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, startSeason: 'summer', now: () => 0 } as never);
  s.tick(240 * 3 + 20);
  s.game.money = 5_000_000;
  s.progression.unlockAll = true;
  return s;
};
const withChapel = (s: Sim): void => {
  const site = findSite(s, 'chapel', anchors(s).lodge, { rmax: 24 });
  if (!site) throw new Error('no chapel site');
  expect(placeSite(s, site).ok).toBe(true);
  const p = planPathTo(s, site.rect) ?? planRoadTo(s, site.rect);
  if (p?.length) buildNetwork(s, BUILDINGS.chapel!.access === 'road' ? 2 : 1, p);
  s.refreshCoverage(undefined, true);
};

describe('weddingPlan (pure schedule)', () => {
  it('only on Saturdays, deterministic, summer-weighted, and a few a year', () => {
    const byseason: Record<string, number> = { spring: 0, summer: 0, autumn: 0, winter: 0 };
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) for (let d = 0; d < DAYS_PER_YEAR * 2; d++) {
      const p = weddingPlan(seed, d);
      expect(weddingPlan(seed, d)).toEqual(p);
      if (!p) continue;
      n++;
      const date = { year: Math.floor(d / DAYS_PER_YEAR), day: d % DAYS_PER_YEAR };
      expect(weekdayOf(date)).toBe(5);
      byseason[seasonOf(date)]!++;
      expect(WEDDING.departHours).toContain(p.departHour);
      expect(p.guests).toBeGreaterThanOrEqual(WEDDING.partyMin); expect(p.guests).toBeLessThanOrEqual(WEDDING.partyMax);
    }
    expect(byseason.summer).toBeGreaterThan(byseason.winter! * 2);
    expect(byseason.summer).toBeGreaterThan(byseason.spring!);
    const perYear = n / 40 / 2;
    expect(perYear).toBeGreaterThan(1.5); expect(perYear).toBeLessThan(8); // rare: a few a year
  });
});

describe('Wedding (a real resort)', () => {
  it('no chapel: nothing starts, even when forced', () => {
    const s = make();
    expect(s.wedding.force()).toBe(false);
    expect(s.wedding.rec).toBeNull();
  });

  it('a forced wedding: news, two bells, the ceremony, the feast income, and the party is gone afterwards', () => {
    const s = make();
    withChapel(s);
    const log: string[] = []; let income = 0;
    for (const n of ['wedding:started', 'wedding:bell', 'wedding:held', 'wedding:feast'] as const) s.bus.on(n, ((p: { income?: number }) => { log.push(n); if (p.income) income += p.income; }) as never);
    s.game.money = 1_000_000;
    const before = s.game.money;
    expect(s.wedding.force(5)).toBe(true);
    const rec = s.wedding.rec!;
    expect(rec.guests).toBe(5);
    expect(rec.tBell).toBeGreaterThan(rec.tArrive); expect(rec.tEnd - rec.tBell).toBe(WEDDING.ceremonyMin);
    expect(rec.tBell % 60).toBe(0);
    // while the ceremony stands: the couple is in front of the chapel door, facing it
    const mid = (rec.tBell + rec.tEnd) / 2, bride = s.wedding.poseOf(0, mid)!, groom = s.wedding.poseOf(1, mid)!;
    expect(bride.mode).toBe('stand');
    expect(Math.hypot(bride.x - rec.fx, bride.y - rec.fy)).toBeLessThan(1); expect(Math.hypot(groom.x - rec.fx, groom.y - rec.fy)).toBeLessThan(1);
    expect(s.wedding.poseOf(0, rec.tDepart - 1)).toBeNull();
    for (let i = 0; i < 240 * 2 && s.wedding.rec; i++) s.tick(1);
    expect(s.wedding.rec).toBeNull();
    expect(log.filter((x) => x === 'wedding:started')).toHaveLength(1);
    expect(log.filter((x) => x === 'wedding:bell')).toHaveLength(2);
    expect(log.filter((x) => x === 'wedding:held')).toHaveLength(1);
    expect(s.wedding.count).toBe(1);
    if (rec.sx !== null) { expect(log).toContain('wedding:feast'); expect(income).toBe(5 * WEDDING.feastPerPerson); }
    expect(s.game.money).toBeGreaterThan(before - 5000); // (the day's other sales and costs run too; the feast is small and positive)
  });

  it('bulldozing the chapel mid-wedding sends the party home (no crash, nothing left)', () => {
    const s = make();
    withChapel(s);
    expect(s.wedding.force()).toBe(true);
    s.buildings.remove(s.buildings.all().find((b) => b.type === 'chapel')!.id);
    s.bus.emit('time:hour', undefined as never);
    expect(s.wedding.rec).toBeNull();
  });

  it('save round trip: the same record gives the same poses, the same count', () => {
    const s = make();
    withChapel(s);
    s.wedding.force(6); s.wedding.count = 2;
    const data = JSON.parse(JSON.stringify(s.wedding.serialize()));
    const s2 = make();
    s2.wedding.load(data);
    expect(s2.wedding.serialize()).toEqual(s.wedding.serialize());
    const r = s.wedding.rec!;
    for (const t of [r.tDepart + 5, r.tArrive + 1, r.tBell + 10, r.tEnd + 5, r.tFeast - 1]) for (let i = 0; i < 6; i++) expect(s2.wedding.poseOf(i, t)).toEqual(s.wedding.poseOf(i, t));
  });

  it('village charm: a connected chapel lifts the scenery value by the capped charm; nothing else changes', () => {
    const a = make(), b = make();
    withChapel(b);
    expect(CHAPEL.charm).toBeGreaterThan(0); expect(CHAPEL.charm).toBeLessThanOrEqual(0.1);
    expect(b.buildings.all().filter((x) => x.type === 'chapel')).toHaveLength(1);
    expect(a.buildings.all().some((x) => x.type === 'chapel')).toBe(false);
  });

  it('the Chapel is one per resort, level 2, cheap to mid-priced', () => {
    const d = BUILDINGS.chapel!;
    expect(d.maxCount).toBe(1); expect(d.w * d.h).toBe(6);
    expect(d.cost).toBeGreaterThanOrEqual(2000); expect(d.cost).toBeLessThanOrEqual(8000); expect(d.upkeep).toBeLessThanOrEqual(15);
  });
});

describe('Wedding bells achievement', () => {
  it('unlocks after three weddings in one game, not before', () => {
    const bus = new EventBus<GameEvents>();
    const a = new Achievements(bus, { runKind: () => 'career', facts: () => ({ stars: 2, level: 1, guests: 30, openLifts: 1, money: 1000, festivals: 0, report: null }), now: () => 1_700_000_000_000, gameId: 'gtest' });
    a.arm();
    const got: string[] = [];
    a.onUnlock((d) => got.push(d.id));
    expect(ACHIEVEMENT_BY_ID['wedding-bells']!.tracker).toMatchObject({ kind: 'event', event: 'wedding:held', n: 3, per: 'game' });
    bus.emit('wedding:held', { count: 1 }); bus.emit('wedding:held', { count: 2 });
    expect(got).not.toContain('wedding-bells');
    bus.emit('wedding:held', { count: 3 });
    expect(got).toContain('wedding-bells');
  });
  it('the Wedding class exposes the door side for each rotation', () => {
    expect(Wedding.doorDir(0)).toEqual([0, 1]); expect(Wedding.doorDir(1)).toEqual([-1, 0]); expect(Wedding.doorDir(2)).toEqual([0, -1]); expect(Wedding.doorDir(3)).toEqual([1, 0]);
  });
});
