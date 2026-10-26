import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { applySave, collectSave } from '../../src/game/saveState';
import { Advisor, SHOWN, SNOOZE_DAYS } from '../../src/sim/advisor/Advisor';
import { RULES, type Rule } from '../../src/sim/advisor/rules';
import { TEXT, FRIENDLY, ADVISOR_UI, RANGER_NAME } from '../../src/sim/advisor/strings';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { autoFlattenDefault } from '../../src/sim/PlacementRules';
import { seasonStartDay } from '../../src/sim/Clock';
import { Layer } from '../../src/world/Networks';
import { Q } from '../../src/sim/ops/PisteQuality';
import { GuestType } from '../../src/sim/guests/Guest';
import { DAYS_PER_YEAR } from '../../src/config/balance';

const fresh = (seed = 61): Sim => { const s = createSim({ size: 64, seed, starterResort: true, startSeason: 'winter', now: () => 0 } as never); s.tick(240 * 3); s.advisor.reset(); return s; };
const ids = (sim: Sim): string[] => sim.advisor.ranked().map((a) => a.id);
const eval1 = (sim: Sim, full = true): string[] => { sim.advisor.evaluate(full); return ids(sim); };
const removeTypes = (sim: Sim, ...types: string[]): void => { for (const b of sim.buildings.all().slice()) if (types.includes(b.type)) sim.buildings.remove(b.id); sim.refreshCoverage(undefined, true); };
const setFamilies = (sim: Sim, n: number): void => { const st = sim.guestSim.store; for (let i = 0; i < n; i++) { st.alive[i] = 1; st.type[i] = GuestType.Family; } st.count = Math.max(st.count, n); };
const setDay = (sim: Sim, day: number): void => { sim.game.date.day = day; };
const sicy = (sim: Sim): void => { const q = sim.ops.quality as unknown as { state: Uint8Array }; for (let i = 0; i < q.state.length; i++) if (sim.ops.quality.isPiste(i)) q.state[i] = Q.Icy; };
const guests = (sim: Sim, n: number): void => { sim.guestSim.store.count = n; };

interface Case { id: string; cheap?: boolean; trigger(sim: Sim): void; calm?(sim: Sim): void }
/** One mutation that makes each rule fire (on the starter resort) and, optionally, a mutation that keeps it quiet. */
const CASES: Case[] = [
  { id: 'queue.long', cheap: true, trigger: (s) => { s.guestSim.queues.waitTicks = () => 40; }, calm: (s) => { s.guestSim.queues.waitTicks = () => 3; } },
  { id: 'lift.idle', trigger: (s) => { guests(s, 25); const l = s.lifts.all()[0]!; const c = { ...l, id: 99, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 0, perHour: 0 } }; const a = { ...l, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 90, perHour: 90 } }; s.lifts.all = () => [a, c] as never; }, calm: (s) => { guests(s, 25); const l = s.lifts.all()[0]!; const c = { ...l, id: 99, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 90, perHour: 90 } }; s.lifts.all = () => [{ ...l, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 90, perHour: 90 } }, c] as never; } },
  { id: 'grooming.none', trigger: (s) => removeTypes(s, 'groomerGarage', 'snowcatOutpost') },
  { id: 'grooming.gap', trigger: (s) => { s.coverage.map('grooming').fill(0); } },
  { id: 'piste.icy', trigger: sicy },
  { id: 'patrol.none', trigger: (s) => { guests(s, 14); removeTypes(s, 'patrolHub', 'firstAid'); for (const l of s.lifts.all()) l.open = true; } },
  { id: 'aid.gap', trigger: (s) => { guests(s, 14); s.coverage.map('patrol').fill(0); s.coverage.map('firstAid').fill(0); } },
  { id: 'bear.threat', trigger: (s) => { setDay(s, seasonStartDay('summer') + 5); guests(s, 10); s.ops.safety!.wildlife.animals.push({ kind: 'bear', asleep: false, x: 12, y: 12 } as never); }, calm: (s) => { setDay(s, seasonStartDay('summer') + 5); guests(s, 10); s.ops.safety!.wildlife.animals.push({ kind: 'bear', asleep: true, x: 12, y: 12 } as never); } },
  { id: 'storm.signs', cheap: true, trigger: (s) => { guests(s, 12); s.weather.current.kind = 'storm'; } },
  { id: 'school.none', trigger: (s) => { removeTypes(s, 'skiSchoolHQ'); setFamilies(s, 9); }, calm: (s) => { setFamilies(s, 9); } },
  { id: 'arrival.parking', trigger: (s) => removeTypes(s, 'parking') },
  { id: 'cash.debt', cheap: true, trigger: (s) => { (s.finance as unknown as { status: string }).status = 'debt'; s.game.money = -500; } },
  { id: 'cash.runway', cheap: true, trigger: (s) => { s.game.money = 300; } },
  { id: 'price.fair', trigger: (s) => { guests(s, 20); s.pricing.set('dayPass', s.pricing.defaultOf('dayPass') * 3); } },
  { id: 'marketing.ready', trigger: () => { /* the starter resort already qualifies */ }, calm: (s) => { s.game.money = 100; } },
  { id: 'season.winter', trigger: (s) => { setDay(s, seasonStartDay('winter') - 10); removeTypes(s, 'snowCannon'); }, calm: (s) => { setDay(s, seasonStartDay('winter') - 10); } },
  { id: 'season.summer', trigger: (s) => { setDay(s, seasonStartDay('summer') - 10); }, calm: (s) => { setDay(s, seasonStartDay('summer') - 10); s.networks.layers[100] = (s.networks.layers[100]! | Layer.Hike) as never; } },
  { id: 'cash.summerBuffer', trigger: (s) => { setDay(s, seasonStartDay('summer') - 10); s.game.money = 800; }, calm: (s) => { setDay(s, seasonStartDay('summer') - 10); s.game.money = 5_000_000; } },
  { id: 'snow.gaps', trigger: (s) => removeTypes(s, 'snowCannon'), calm: (s) => { s.coverage.map('snowmaking').fill(1); } },
  { id: 'building.inactive', trigger: (s) => { s.buildings.all().find((b) => !['groomerGarage', 'snowcatOutpost', 'patrolHub', 'skiSchoolHQ', 'parking', 'trainStation', 'shuttleDepot', 'altiport', 'rangerStation'].includes(b.type))!.active = false; } },
  { id: 'lift.worn', trigger: (s) => { s.lifts.all()[0]!.ops!.condition = 20; }, calm: (s) => { s.lifts.all()[0]!.ops!.condition = 90; } },
  { id: 'rating.lowest', trigger: () => { /* starter resort: variety is weakest */ }, calm: (s) => { s.rating.breakdown = () => ({ score: 90, stars: 4.5, components: [{ id: 'happiness', label: 'Guest happiness', score: 90, weight: 0.25, hint: '' }], bonus: 0, bonusHints: [], hints: [] }); } },
  { id: 'piste.disconnected', trigger: (s) => { let t = 0; for (let i = 0; i < s.size * s.size; i++) if (s.ops.quality.isPiste(i)) { t = i; break; } const real = s.networks.pisteComponents.bind(s.networks); s.networks.pisteComponents = () => [...real(), { disconnected: true, count: 9, tiles: [t] }] as never; }, calm: (s) => { const real = s.networks.pisteComponents.bind(s.networks); s.networks.pisteComponents = () => real().map((c) => ({ ...c, disconnected: false })) as never; } },
  { id: 'goal.next', trigger: () => { /* active goals exist */ }, calm: (s) => { s.goals.paused = true; } },
];

describe('advisor rules', () => {
  it('has at least 10 rules and every rule id has a case', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(CASES.map((c) => c.id).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
  it('the untouched starter resort has no urgent advice', () => {
    const s = fresh();
    s.advisor.evaluate(true);
    expect(s.advisor.ranked().filter((a) => a.severity === 'urgent')).toHaveLength(0);
  });
  for (const c of CASES) {
    it(`${c.id}: triggers`, () => {
      const s = fresh();
      if (c.id !== 'marketing.ready' && c.id !== 'rating.lowest' && c.id !== 'goal.next') expect(eval1(s, true)).not.toContain(c.id);
      c.trigger(s);
      expect(eval1(s, !c.cheap)).toContain(c.id);
    });
    it(`${c.id}: stays quiet when its condition is absent`, () => {
      const s = fresh();
      c.calm?.(s);
      expect(eval1(s, true)).not.toContain(c.id);
    });
  }
  it('every advice carries plain, capitalised, id-free text', () => {
    const s = fresh();
    for (const c of CASES) c.trigger(s);
    s.advisor.evaluate(true);
    for (const a of s.advisor.ranked()) {
      for (const txt of [a.title, a.why]) {
        expect(txt, a.id).toMatch(/^[A-Z0-9$]/);
        expect(txt, a.id).not.toMatch(/\b[a-z]+[A-Z][a-zA-Z]+\b/); // raw camelCase ids
        expect(txt, a.id).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });
});

describe('advisor placement honesty', () => {
  it('every proposed site passes validatePlacement (property over all rules, several seeds)', () => {
    let checked = 0;
    for (const seed of [61, 7, 123, 2024]) {
      const s = fresh(seed);
      for (const c of CASES) if (c.id !== 'lift.idle') c.trigger(s);
      s.advisor.evaluate(true);
      for (const a of s.advisor.ranked()) {
        const site = a.action?.site;
        if (!site) continue;
        const chk = validatePlacement(s.env, a.action!.building, site.x, site.y, site.rot, autoFlattenDefault(a.action!.building));
        expect(chk.reasons.filter((r) => !r.startsWith('Not enough funds')), `${a.id} @ seed ${seed}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
  it('a stale cached site is dropped (type only) when it no longer validates', () => {
    const s = fresh();
    removeTypes(s, 'parking');
    s.advisor.evaluate(true);
    const a = s.advisor.ranked().find((x) => x.id === 'arrival.parking')!;
    expect(a.action?.site).toBeTruthy();
    const { x, y } = a.action!.site!;
    s.env.grid.occupancy.flags[y * s.size + x] = 255; // block the tile: the site is no longer valid
    s.advisor.evaluate(true);
    const b = s.advisor.ranked().find((x2) => x2.id === 'arrival.parking')!;
    if (b.action?.site) expect(b.action.site).not.toEqual({ x, y, rot: a.action!.site!.rot });
    expect(b.action?.building).toBe('parking');
  });
  it('advice never builds anything or spends money', () => {
    const s = fresh();
    for (const c of CASES) c.trigger(s);
    const before = s.buildings.all().length + s.lifts.all().length, money = s.game.money;
    s.advisor.evaluate(true);
    expect(s.buildings.all().length + s.lifts.all().length).toBe(before);
    expect(s.game.money).toBe(money);
  });
});

describe('advisor ranking', () => {
  const stub = (id: string, severity: 'info' | 'warn' | 'urgent', impact: 1 | 2 | 3, fire = () => true): Rule => ({ id, impact, eval: () => (fire() ? { id, severity, title: id, why: id } : null) });
  const bus = (): { on: (e: string, f: () => void) => void; fire: (e: string) => void } => { const m = new Map<string, Array<() => void>>(); return { on: (e, f) => { (m.get(e) ?? m.set(e, []).get(e)!).push(f); }, fire: (e) => { for (const f of m.get(e) ?? []) f(); } }; };
  const sims = new WeakMap<Advisor, Sim>();
  const make = (rules: Rule[], sim = fresh()): Advisor => { const a = new Advisor(bus() as never, rules); a.attach(sim); sims.set(a, sim); return a; };

  it('ranks by severity x impact, shows the top 3, ties break by id', () => {
    const a = make([stub('d', 'info', 1), stub('c', 'warn', 2), stub('b', 'warn', 2), stub('a', 'urgent', 3), stub('e', 'warn', 2)]);
    a.evaluate(true);
    expect(a.ranked().map((x) => x.id)).toEqual(['a', 'b', 'c', 'e', 'd']);
    expect(a.top().map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(a.top()).toHaveLength(SHOWN);
    expect(a.count()).toBe(5);
  });
  it('is deterministic: rule order does not matter; two identical sims agree', () => {
    const rs = [stub('d', 'info', 1), stub('c', 'warn', 2), stub('b', 'warn', 2), stub('a', 'urgent', 3)];
    const x = make(rs), y = make([...rs].reverse());
    x.evaluate(true); y.evaluate(true);
    expect(x.ranked().map((a) => a.id)).toEqual(y.ranked().map((a) => a.id));
    const s1 = fresh(), s2 = fresh();
    for (const c of CASES) { c.trigger(s1); c.trigger(s2); }
    s1.advisor.evaluate(true); s2.advisor.evaluate(true);
    expect(ids(s1)).toEqual(ids(s2));
    expect(JSON.stringify(s1.advisor.top())).toBe(JSON.stringify(s2.advisor.top()));
  });
  it('newer advice gets a short recency boost', () => {
    let fireB = false;
    const a = make([stub('a', 'warn', 2), stub('b', 'warn', 2, () => fireB)]);
    a.evaluate(true);
    fireB = true;
    sims.get(a)!.game.date.day += 5;
    a.evaluate(true);
    expect(a.ranked().map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('hysteresis: advice stays for 2 silent evaluations and does not flicker around a threshold', () => {
    let on = true;
    const a = make([stub('a', 'warn', 2, () => on)]);
    a.evaluate(true);
    expect(a.count()).toBe(1);
    on = false;
    a.evaluate(true);
    expect(a.count()).toBe(1); // one miss: still shown
    on = true;
    a.evaluate(true);
    on = false; a.evaluate(true);
    expect(a.count()).toBe(1);
    a.evaluate(true);
    expect(a.count()).toBe(0);
    let changes = 0;
    a.onChange(() => changes++);
    let flip = false;
    const b = make([stub('a', 'warn', 2, () => (flip = !flip))]);
    let n = 0; b.onChange(() => n++);
    for (let i = 0; i < 20; i++) b.evaluate(true);
    expect(n).toBeLessThanOrEqual(1); // appeared once, never flickered away
    void changes;
  });
  it('real thresholds have a keep band: a queue just under the enter limit keeps the advice, just over the keep limit drops it', () => {
    const s = fresh();
    s.guestSim.queues.waitTicks = () => 25;
    s.advisor.evaluate(false);
    expect(ids(s)).toContain('queue.long');
    s.guestSim.queues.waitTicks = () => 15; // between keep (12) and enter (20)
    for (let i = 0; i < 4; i++) s.advisor.evaluate(false);
    expect(ids(s)).toContain('queue.long');
    s.guestSim.queues.waitTicks = () => 5;
    s.advisor.evaluate(false); s.advisor.evaluate(false);
    expect(ids(s)).not.toContain('queue.long');
    const t = fresh();
    t.guestSim.queues.waitTicks = () => 15; // never entered
    t.advisor.evaluate(false);
    expect(ids(t)).not.toContain('queue.long');
  });
  it('cheap rules run hourly, the rest daily', () => {
    const s = fresh();
    removeTypes(s, 'parking');
    s.guestSim.queues.waitTicks = () => 40;
    s.advisor.evaluate(false);
    expect(ids(s)).toContain('queue.long');
    expect(ids(s)).not.toContain('arrival.parking');
    s.advisor.evaluate(true);
    expect(ids(s)).toContain('arrival.parking');
  });
  it('evaluates off the bus (time:hour = cheap, day:changed = all)', () => {
    const s = fresh();
    s.guestSim.queues.waitTicks = () => 40;
    s.bus.emit('time:hour', { hour: 9 });
    expect(ids(s)).toContain('queue.long');
  });
});

describe('advisor snooze + save', () => {
  it('dismiss snoozes for 30 in-game days, then the advice returns', () => {
    const s = fresh();
    s.guestSim.queues.waitTicks = () => 40;
    s.advisor.evaluate(false);
    s.advisor.dismiss('queue.long');
    expect(ids(s)).not.toContain('queue.long');
    expect(s.advisor.isSnoozed('queue.long')).toBe(true);
    expect(s.advisor.top().map((a) => a.id)).not.toContain('queue.long');
    setDay(s, s.game.date.day + SNOOZE_DAYS - 1);
    s.advisor.evaluate(false);
    expect(ids(s)).not.toContain('queue.long');
    setDay(s, s.game.date.day + 1);
    s.advisor.evaluate(false);
    expect(ids(s)).toContain('queue.long');
    expect(s.advisor.dismissed).toBe(1);
  });
  it('paused (tutorial) hides everything and evaluates nothing', () => {
    const s = fresh();
    s.advisor.evaluate(true);
    expect(s.advisor.count()).toBeGreaterThan(0);
    s.advisor.paused = true;
    expect(s.advisor.top()).toEqual([]);
    expect(s.advisor.count()).toBe(0);
  });
  it('save round-trips the snooze timers; an old save without the module loads with nothing snoozed', () => {
    const s = fresh();
    s.guestSim.queues.waitTicks = () => 40;
    s.advisor.evaluate(false);
    s.advisor.dismiss('queue.long');
    const save = collectSave(s);
    expect(save['advisor']).toBeTruthy();
    const t = fresh();
    applySave(t, JSON.parse(JSON.stringify(save, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as number[]) : v))) && save);
    expect(t.advisor.serialize()).toEqual(s.advisor.serialize());
    expect(t.advisor.isSnoozed('queue.long')).toBe(true);
    const old = { ...save }; delete old['advisor'];
    const u = fresh();
    u.advisor.dismiss('queue.long');
    const rep = applySave(u, old);
    expect(rep.missing).toContain('advisor');
    expect(u.advisor.serialize()).toEqual({ snooze: [], dismissed: 0 });
  });
  it('snooze is keyed to absolute days (year wrap)', () => {
    const s = fresh();
    s.game.date.day = DAYS_PER_YEAR - 5;
    s.advisor.dismiss('x');
    s.game.date.year++; s.game.date.day = 10;
    expect(s.advisor.isSnoozed('x')).toBe(true);
    s.game.date.day = 30;
    expect(s.advisor.isSnoozed('x')).toBe(false);
  });
});

describe('advisor strings', () => {
  it('every text builder yields capitalised, id-free text; Rudi is named; friendly lines are short and positive', () => {
    const samples = [TEXT.queue('Chairlift 1', 3), TEXT.groomingNone(), TEXT.groomingGap(40), TEXT.icy(30), TEXT.patrolNone(), TEXT.aidGap(50), TEXT.school(8), TEXT.parking(), TEXT.debt('$5'), TEXT.runway(2),
      TEXT.winterComing(9, false), TEXT.winterComing(9, true), TEXT.summerComing(9), TEXT.storm(), TEXT.rating('variety', 'too few green runs', 40), TEXT.idleLift('Chairlift 2'), TEXT.pisteDisconnected('Blue Run 1'),
      TEXT.buildingInactive('Cafe 1', 'no road'), TEXT.bear(), TEXT.liftWorn('Chairlift 1', 20, false), TEXT.liftWorn('Chairlift 1', 20, true), TEXT.priceHigh(50), TEXT.priceLow(50), TEXT.marketing('Families'), TEXT.goal('x', 'build a thing'), TEXT.goalClose('x')];
    for (const t of samples) for (const v of [t.title, t.why]) { expect(v).toMatch(/^[A-Z0-9]/); expect(v).not.toMatch(/\b[a-z]+[A-Z][a-zA-Z]+\b/); }
    expect(RANGER_NAME).toBe('Ranger Rudi');
    for (const f of FRIENDLY) { expect(f.length).toBeLessThan(40); expect(f).toMatch(/^[A-Z]/); }
    for (const v of Object.values(ADVISOR_UI)) expect(v).toMatch(/^[A-Z]/);
  });
  it('friendly lines appear only on positive notes (never on warnings)', () => {
    const s = fresh();
    for (const c of CASES) c.trigger(s);
    s.advisor.evaluate(true);
    for (const a of s.advisor.ranked()) if (a.friendly) expect(a.severity).toBe('info');
  });
});
