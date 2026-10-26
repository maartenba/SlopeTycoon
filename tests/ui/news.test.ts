import { describe, expect, it } from 'vitest';
import { GAME_EVENT_NAMES, type GameEvents } from '../../src/core/events';
import { MilestoneTracker, NEWS_FORMATTERS, formatEvent } from '../../src/ui/newsFormat';
import { guestInspectorModel } from '../../src/ui/guestInfo';
import { GuestStore, GuestType, GState } from '../../src/sim/guests/Guest';
import { Act } from '../../src/sim/guests/Decision';
import { gatherRatingInput, LeaverTracker } from '../../src/sim/RatingInputs';

describe('news formatter', () => {
  it('every GameEvents name has a formatter or an explicit ignore', () => {
    for (const n of GAME_EVENT_NAMES) expect(n in NEWS_FORMATTERS, n).toBe(true);
    expect(Object.keys(NEWS_FORMATTERS).sort()).toEqual([...GAME_EVENT_NAMES].sort());
  });
  it('formats representative events with severity, icon, key and location', () => {
    const a = formatEvent('incident:avalanche', { x: 10, y: 20, severity: 1, buried: 2 })!;
    expect(a.severity).toBe('bad'); expect(a.loc).toEqual({ x: 10, y: 20 }); expect(a.category).toBe('incident'); expect(a.icon).toBeTruthy();
    expect(formatEvent('lift:closed', { id: 3, reason: 'Closed: no snow' }, { liftName: () => 'Chairlift 1' })!.text).toContain('Chairlift 1');
    expect(formatEvent('weather:changed', { kind: 'heavySnow', previous: 'clear', temperature: -3, snowline: 1, precipitation: 'snow' })!.text).toMatch(/Powder/);
    expect(formatEvent('weather:changed', { kind: 'rain', previous: 'snow', temperature: 3, snowline: 1, precipitation: 'rain' })!.text).toMatch(/Thaw/);
    expect(formatEvent('finance:monthClosed', { year: 0, month: 2, net: -500, income: 1, expense: 2 })!.severity).toBe('warn');
    expect(formatEvent('rating:changed', { stars: 4, previous: 3.5, reason: 'x' })!.severity).toBe('good');
    expect(formatEvent('money:changed', { money: 1, delta: 1 })).toBeNull();
  });
  it('every formatter handles a minimal payload without throwing', () => {
    const samples: Partial<{ [K in keyof GameEvents]: GameEvents[K] }> = {
      'guest:left': { id: 1, reason: 'injured' }, 'lift:closed': { id: 1, reason: 'r' }, 'attraction:opened': { id: 1, type: 't' }, 'attraction:closed': { id: 1, type: 't', reason: 'r' },
      'piste:opened': { id: 1, open: false }, 'weather:changed': { kind: 'clear', previous: 'snow', temperature: 0, snowline: 0, precipitation: 'none' },
      'loan:taken': { amount: 1, total: 1, rate: 5, termMonths: 12 }, 'season:changed': { season: 'winter', previous: 'autumn' },
      'incident:avalanche': { x: 1, y: 1, severity: 1 }, 'incident:wildlife': { x: 1, y: 1, kind: 'bear', outcome: 'attack' }, 'ops:grooming': { vehicles: 1, tiles: 5 },
      'incident:injury': { guestId: 1, x: 1, y: 1 }, 'incident:created': { id: 1, kind: 'injury', severity: 2, x: 1, y: 1, guestId: 1 },
      'incident:resolved': { id: 1, responder: 'patrol', responseTicks: 3, outcome: 'recovered' }, 'incident:escalated': { id: 1, to: 'heli' },
      'finance:bankruptcyWarning': { money: -1, daysLeft: 5 }, 'finance:bankrupt': { money: -1, day: 1 }, 'finance:monthClosed': { year: 0, month: 0, net: 1, income: 1, expense: 0 },
      'rating:changed': { stars: 3, previous: 4, reason: 'r' },
    };
    for (const [k, v] of Object.entries(samples)) {
      const item = formatEvent(k as never, v as never);
      expect(item, k).not.toBeNull();
      expect(item!.key.length).toBeGreaterThan(0); expect(item!.text.length).toBeGreaterThan(0);
    }
  });
  it('milestones fire once at each mark', () => {
    const m = new MilestoneTracker([3, 5]); const out = [];
    for (let i = 0; i < 8; i++) { const r = m.arrived(); if (r) out.push(r.text); }
    expect(out.length).toBe(2); expect(out[0]).toMatch(/3 guests/);
  });
});

describe('guest inspector helpers', () => {
  it('builds the model: bars, activity, queue, thoughts', () => {
    const s = new GuestStore(10);
    const i = s.add({ x: 3, y: 4, z: 0, type: GuestType.Family, skill: 1, budget: 250, group: 1, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: 0.8, happiness: 0.2 });
    s.state[i] = GState.Queueing; s.act[i] = Act.Queue;
    const m = guestInspectorModel(s, i, { ctx: { queueTicks: 40, onIcyPiste: true, noKidsVenue: true }, queueLift: 'Chairlift 1', familyText: 'Family of 4' })!;
    expect(m.type).toBe('family'); expect(m.skill).toBe('intermediate');
    expect(m.bars.map((b) => b.id)).toEqual(['hunger', 'fatigue', 'happiness', 'budget']);
    expect(m.bars[3]!.text).toBe('$250'); expect(m.bars[3]!.value).toBeCloseTo(0.5);
    expect(m.queue).toBe('Chairlift 1'); expect(m.family).toBe('Family of 4');
    for (const t of ['Lift queue is too long', 'The piste is icy', 'No ski school for my kids', 'I am starving!']) expect(m.thoughts).toContain(t);
    s.remove(i);
    expect(guestInspectorModel(s, i)).toBeNull();
  });
});

describe('rating input adapter', () => {
  it('gathers variety/queues/patrol from system sources', () => {
    const leavers = new LeaverTracker(); leavers.record('satisfied'); leavers.record('bored'); leavers.record('closing');
    expect(leavers.share).toBeGreaterThan(0); expect(leavers.share).toBeLessThan(1);
    const i = gatherRatingInput({
      guests: () => ({ count: 10, avgHappiness: 0.7, skillMix: [5, 3, 2, 0], avgNeighbours: 3, overnight: 4 }), leavers: () => leavers.share,
      incidents: () => ({ penalty: 0, open: 0, unresolved: 0, meanResponseTicks: 0, severe: 0 }),
      buildings: () => [{ type: 'patrolHub', active: true }, { type: 'cafe', active: true }, { type: 'chalet', active: true }],
      lifts: () => [{ id: 1, kind: 'chair4', open: true, name: 'Chairlift 1' }, { id: 2, kind: 'tbar', open: false }],
      waitTicks: () => 20,
      forEachOpenPisteTile: (cb) => { for (let k = 0; k < 40; k++) cb(k % 2, k % 4 === 0 ? 4 : 2); },
      season: () => 'winter', trailOpen: () => ({ mtb: 0, hike: 0 }), qualityLike: (_s, q) => (q === 4 ? 0 : 1),
    });
    expect(i.safety.patrolHubs).toBe(1); expect(i.amenities.restaurants).toBe(1); expect(i.amenities.lodgingCapacity).toBe(12);
    expect(i.variety.liftKinds).toBe(1); expect(i.openLifts).toBe(1); expect(i.queues.worst).toEqual({ name: 'Chairlift 1', waitTicks: 20 });
    expect(i.pisteQuality.icyShare).toBeCloseTo(0.25); expect(i.variety.pisteTiles).toEqual([20, 20, 0, 0]);
  });
});
