/**
 * Advisor scenario harness: for EVERY rule, (a) a state where it fires, (b) 2-3 different valid ways to fix the problem, after which the advice must be
 * gone at the NEXT hourly evaluation, (c) incomplete fixes get specific, accurate advice, (d) every proposed site passes the real validators
 * (20 seeds x 3 sizes). Bug classes: stale advice, invalid sites, advice that contradicts the placement rules, false statements, duplicates, wording.
 */
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { RULES, type Advice } from '../../src/sim/advisor/rules';
import { anchors, buildNetwork, findAlongPiste, findSite, placeSite, planPathTo, planRoadTo, type Site } from '../../src/tutorial/suggest';
import { BUILDINGS } from '../../src/config/buildings';
import { GuestType } from '../../src/sim/guests/Guest';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { autoFlattenDefault } from '../../src/sim/PlacementRules';
import { seasonStartDay } from '../../src/sim/Clock';
import { Q } from '../../src/sim/ops/PisteQuality';
import { Layer } from '../../src/world/Networks';
import { sentence } from '../../src/ui/text';
import { tutorialSim, makeEngine } from '../tutorial/helpers';
import { Queries } from '../../src/tutorial/queries';

type Pt = { x: number; y: number };
const make = (seed = 61, size: 64 | 128 | 256 = 64): Sim => {
  const s = createSim({ size, seed, starterResort: true, startSeason: 'winter', now: () => 0 } as never);
  s.tick(240 * 3 + 20); // +20 ticks: lifts open at 08:29 on 4 Dec (calendar fix)
  s.game.money = 5_000_000; // construction must never be the reason a scenario fails
  s.advisor.reset();
  return s;
};
const removeTypes = (s: Sim, ...types: string[]): void => { for (const b of s.buildings.all().slice()) if (types.includes(b.type)) s.buildings.remove(b.id); s.refreshCoverage(undefined, true); };
const hour = (s: Sim): string[] => { s.bus.emit('time:hour', undefined as never); return s.advisor.ranked().map((a) => a.id); };
const adviceOf = (s: Sim, id: string): Advice | undefined => s.advisor.ranked().find((a) => a.id === id);
const link = (s: Sim, site: Site): void => {
  const def = BUILDINGS[site.type]!;
  if (def.access === 'road') { const p = planRoadTo(s, site.rect); if (p?.length) buildNetwork(s, 2, p); }
  else if (def.access === 'path') { const p = planPathTo(s, site.rect); if (p?.length) buildNetwork(s, 1, p); }
};
/** Place + connect a building of `type` near `anchor` (real rules). */
const buildAt = (s: Sim, type: string, anchor: Pt, opts: { connect?: boolean; rmax?: number; avoid?: Pt; minDist?: number } = {}): Site => {
  const route = opts.connect === false ? undefined : BUILDINGS[type]!.access === 'road' ? 'road' as const : undefined;
  const site = findSite(s, type, anchor, { rmax: opts.rmax ?? 8, route, avoid: opts.avoid ? (r) => Math.hypot(r.x - opts.avoid!.x, r.y - opts.avoid!.y) < (opts.minDist ?? 6) : undefined });
  if (!site) throw new Error(`no site for ${type} near ${anchor.x},${anchor.y}`);
  expect(placeSite(s, site).ok, `placed ${type}`).toBe(true);
  if (opts.connect !== false) link(s, site);
  return site;
};
const lodge = (s: Sim): Pt => anchors(s).lodge;
const pistePts = (s: Sim): Pt[] => s.networks.pisteComponents().sort((a, b) => b.count - a.count)[0]!.tiles.map((i) => ({ x: i % s.size, y: (i / s.size) | 0 }));
const pisteMid = (s: Sim): Pt => { const p = pistePts(s); return p[Math.floor(p.length / 2)]!; };
const FAR: Pt = { x: 5, y: 5 };
const setFamilies = (s: Sim, n: number): void => { const st = s.guestSim.store; for (let i = 0; i < n; i++) { st.alive[i] = 1; st.type[i] = GuestType.Family; } st.count = Math.max(st.count, n); };
const guests = (s: Sim, n: number): void => { s.guestSim.store.count = n; };
/** Water tours (Task 24): stub the waterway list + nominal flow of the sim with one river of the given flow classes (the rule only reads them). */
const riverStub = (s: Sim, cls: number[]): void => {
  const way = { id: 'n0', kind: 'natural', path: [], level: [], end: 'edge' };
  (s.waterEnv as unknown as { ways: () => unknown[] }).ways = () => [way];
  (s.waterEnv as unknown as { flow: () => unknown }).flow = () => ({ cls, rapidsTiles: cls.filter((c) => c === 2).length });
};

/** Summer campaigns (Task 51): the starter resort has no Campground / Tackle hut: make the campaign startable. */
const campStub = (s: Sim, id: string): void => { const real = s.marketing.blocker.bind(s.marketing); s.marketing.blocker = (x: string) => (x === id ? null : real(x)); };
/** The starter resort has no Train Station: fake a served one (rail share, station load) and make Come by Train startable. */
const trainStub = (s: Sim, share: number): void => { s.game.money = 50_000; s.marketing.railStatus = () => ({ share, load: 0, capacity: 150, available: true }); const real = s.marketing.blocker.bind(s.marketing); s.marketing.blocker = (id: string) => (id === 'train' ? null : real(id)); };
const parkingStub = (s: Sim, roadLoad: number): void => { const sp = s.guestSim.spawner, real = sp.status.bind(sp); sp.status = () => { const r = real(); return { ...r, arrivals: { ...r.arrivals!, road: { ...r.arrivals!.road, available: true, capacity: 100 } } }; }; sp.modeLoadOf = (m: number) => (m === 0 ? roadLoad : 0); };
const openAll = (s: Sim): void => { for (const l of s.lifts.all()) l.open = true; };

interface Fix { name: string; apply(s: Sim, a: Advice): void }
interface Scenario {
  id: string;
  /** Informational: the old daily-only cadence (all rules now run hourly). */
  daily?: boolean;
  setup(s: Sim): void;
  fixes: Fix[];
}
/** The next hourly tick (every rule runs hourly). */
const reeval = (s: Sim): string[] => hour(s);

const SCENARIOS: Scenario[] = [
  {
    id: 'queue.long',
    setup: (s) => { s.guestSim.queues.waitTicks = () => 40; },
    fixes: [
      { name: 'the queue drains', apply: (s) => { s.guestSim.queues.waitTicks = () => 2; } },
      { name: 'the lift is closed (adjusting the schedule)', apply: (s) => { for (const l of s.lifts.all()) l.open = false; s.bus.emit('lift:opened', { id: 1, open: false }); } },
      { name: 'the lift is under inspection', apply: (s) => { for (const l of s.lifts.all()) { l.open = false; l.opsReason = 'inspection'; } s.bus.emit('lift:opened', { id: 1, open: false }); } },
    ],
  },
  {
    id: 'lift.idle', daily: true,
    setup: (s) => {
      guests(s, 25);
      const l = s.lifts.all()[0]!;
      const busy = { ...l, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 90, perHour: 90 } };
      const idle = { ...l, id: 99, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 0, perHour: 0 } };
      s.lifts.all = () => [busy, idle] as never;
    },
    fixes: [
      { name: 'it gets riders', apply: (s) => { for (const l of s.lifts.all()) l.riders = { total: 90, perHour: 90 } as never; } },
      { name: 'it is closed', apply: (s) => { s.lifts.all().find((l) => l.id === 99)!.open = false; } },
      { name: 'it is night: nobody rides anywhere', apply: (s) => { for (const l of s.lifts.all()) l.riders = { total: 0, perHour: 0 } as never; } },
    ],
  },
  {
    id: 'grooming.none',
    setup: (s) => removeTypes(s, 'groomerGarage', 'snowcatOutpost'),
    fixes: [
      { name: 'garage near the lodge (suggested)', apply: (s, a) => { const st = a.action!.site!; placeSite(s, { type: 'groomerGarage', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: BUILDINGS.groomerGarage!.w, h: BUILDINGS.groomerGarage!.h } }); link(s, findSite(s, 'groomerGarage', st, { rmax: 0 }) ?? ({ type: 'groomerGarage', rect: { x: st.x, y: st.y, w: 3, h: 3 } } as Site)); } },
      { name: 'garage somewhere else, connected', apply: (s) => { buildAt(s, 'groomerGarage', { x: lodge(s).x - 14, y: lodge(s).y + 6 }); } },
      { name: 'garage far from the piste, connected (grooming exists, just out of range)', apply: (s) => { buildAt(s, 'groomerGarage', FAR, { rmax: 10 }); } },
    ],
  },
  {
    id: 'grooming.gap',
    // an active garage far away from the piste: grooming exists but does not reach
    setup: (s) => { removeTypes(s, 'groomerGarage', 'snowcatOutpost'); buildAt(s, 'groomerGarage', FAR, { rmax: 10 }); },
    fixes: [
      { name: 'outpost at the suggested site', apply: (s, a) => { const st = a.action!.site!; const d = BUILDINGS.snowcatOutpost!; expect(placeSite(s, { type: 'snowcatOutpost', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }).ok).toBe(true); } },
      { name: 'outpost at a different spot beside the piste', apply: (s, a) => { buildAt(s, 'snowcatOutpost', pisteMid(s), { connect: false, rmax: 12, avoid: a.action?.site, minDist: 3 }); } },
      { name: 'an outpost placed first at the middle of the piste, then another elsewhere', apply: (s) => { buildAt(s, 'snowcatOutpost', pistePts(s)[0]!, { connect: false, rmax: 12 }); buildAt(s, 'snowcatOutpost', pistePts(s).at(-1)!, { connect: false, rmax: 12 }); } },
    ],
  },
  {
    id: 'piste.icy', daily: true,
    setup: (s) => { const q = s.ops.quality as unknown as { state: Uint8Array }; for (let i = 0; i < q.state.length; i++) if (s.ops.quality.isPiste(i)) q.state[i] = Q.Icy; },
    fixes: [
      { name: 'groomed overnight', apply: (s) => { const q = s.ops.quality as unknown as { state: Uint8Array }; for (let i = 0; i < q.state.length; i++) if (s.ops.quality.isPiste(i)) q.state[i] = Q.Groomed; } },
      { name: 'fresh powder', apply: (s) => { const q = s.ops.quality as unknown as { state: Uint8Array }; for (let i = 0; i < q.state.length; i++) if (s.ops.quality.isPiste(i)) q.state[i] = Q.Powder; } },
    ],
  },
  {
    id: 'patrol.none',
    setup: (s) => { guests(s, 14); removeTypes(s, 'patrolHub', 'firstAid'); openAll(s); },
    fixes: [
      { name: 'hub at the suggested site', apply: (s, a) => { const st = a.action!.site!; const d = BUILDINGS.patrolHub!; const site = { type: 'patrolHub', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }; expect(placeSite(s, site).ok).toBe(true); link(s, site); } },
      { name: 'hub elsewhere (near the lodge), connected', apply: (s) => { buildAt(s, 'patrolHub', { x: lodge(s).x - 12, y: lodge(s).y + 4 }); } },
      { name: 'all lifts closed: nothing to patrol', apply: (s) => { for (const l of s.lifts.all()) { l.open = false; l.opsReason = null; } s.bus.emit('lift:opened', { id: 1, open: false }); } },
    ],
  },
  {
    id: 'aid.gap',
    // an active hub far from the piste: patrol exists but does not reach it
    setup: (s) => { guests(s, 14); removeTypes(s, 'patrolHub', 'firstAid'); openAll(s); buildAt(s, 'patrolHub', FAR, { rmax: 10 }); },
    fixes: [
      { name: 'first aid at the suggested site', apply: (s, a) => { const st = a.action!.site!; const d = BUILDINGS.firstAid!; expect(placeSite(s, { type: 'firstAid', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }).ok).toBe(true); } },
      { name: 'first aid at a different spot on the piste', apply: (s, a) => { buildAt(s, 'firstAid', pisteMid(s), { connect: false, rmax: 12, avoid: a.action?.site, minDist: 3 }); } },
      { name: 'a second hub beside the piste', apply: (s) => { buildAt(s, 'patrolHub', pisteMid(s), { rmax: 14 }); } },
    ],
  },
  {
    id: 'bear.threat',
    setup: (s) => { s.game.date.day = seasonStartDay('summer') + 5; guests(s, 10); s.ops.safety!.wildlife.animals.push({ kind: 'bear', asleep: false, x: 12, y: 12 } as never); },
    fixes: [
      { name: 'ranger station near the lodge', apply: (s) => { buildAt(s, 'rangerStation', lodge(s), { rmax: 18 }); } },
      { name: 'ranger station somewhere else', apply: (s) => { buildAt(s, 'rangerStation', { x: lodge(s).x - 14, y: lodge(s).y + 6 }, { rmax: 12 }); } },
      { name: 'the bear goes to sleep', apply: (s) => { for (const a of s.ops.safety!.wildlife.animals) (a as { asleep: boolean }).asleep = true; } },
    ],
  },
  {
    id: 'toilets.none',
    setup: (s) => { guests(s, 14); removeTypes(s, 'toilets'); },
    fixes: [
      { name: 'toilets at the suggested site', apply: (s, a) => { const st = a.action!.site!; expect(placeSite(s, { type: 'toilets', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: 1, h: 1 } }).ok).toBe(true); } },
      { name: 'toilets near the lodge', apply: (s) => { buildAt(s, 'toilets', lodge(s), { rmax: 10 }); } },
    ],
  },
  {
    id: 'crossing.waits',
    setup: (s) => { const n = s.networks, t = n.kind.findIndex((k, i) => k === 3 && !n.cross[i]); n.cross[t] = 1; n.crossCount++; s.crossings.debugWaits(t, 900); (s as unknown as { _x: number })._x = t; },
    fixes: [
      { name: 'the waiting stops (calmer trains / fewer guests)', apply: (s) => { s.crossings.debugWaits((s as unknown as { _x: number })._x, 10); } },
      { name: 'the crossing is turned into a footbridge', apply: (s) => { const n = s.networks, t = (s as unknown as { _x: number })._x; n.cross[t] = 3; } },
    ],
  },
  {
    id: 'hikers.hungry',
    setup: (s) => { s.guestSim.hikerLeaves.n = 20; s.guestSim.hikerLeaves.starving = 8; },
    fixes: [
      { name: 'hikers stop leaving hungry', apply: (s) => { s.guestSim.hikerLeaves.starving = 0.4; } },
      { name: 'cafe near the middle of the trails', apply: (s) => { const n = s.size, lay = s.networks.layers; let sx = 0, sy = 0, k = 0; for (let i = 0; i < n * n; i++) if (lay[i]! & (Layer.Hike | Layer.Mtb)) { sx += i % n; sy += (i / n) | 0; k++; } buildAt(s, 'cafe', k ? { x: Math.round(sx / k), y: Math.round(sy / k) } : lodge(s), { rmax: 4 }); } },
    ],
  },
  {
    id: 'storm.signs',
    setup: (s) => { guests(s, 12); s.weather.current.kind = 'storm'; },
    fixes: [
      { name: 'sign at the suggested site', apply: (s, a) => { const st = a.action!.site!; expect(placeSite(s, { type: 'warningSign', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: 1, h: 1 } }).ok).toBe(true); } },
      { name: 'sign in the middle of nowhere', apply: (s) => { buildAt(s, 'warningSign', { x: 10, y: 30 }, { rmax: 10 }); } },
      { name: 'the storm passes', apply: (s) => { s.weather.current.kind = 'clear' as never; } },
    ],
  },
  {
    id: 'school.none',
    setup: (s) => { removeTypes(s, 'skiSchoolHQ'); setFamilies(s, 9); },
    fixes: [
      { name: 'HQ at the suggested site, connected', apply: (s, a) => { const st = a.action!.site!; const d = BUILDINGS.skiSchoolHQ!; const site = { type: 'skiSchoolHQ', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }; expect(placeSite(s, site).ok).toBe(true); link(s, site); } },
      { name: 'HQ elsewhere, connected', apply: (s) => { buildAt(s, 'skiSchoolHQ', { x: lodge(s).x - 14, y: lodge(s).y + 6 }); } },
      { name: 'families leave', apply: (s) => { const st = s.guestSim.store; for (let i = 0; i < st.limit; i++) if (st.type[i] === GuestType.Family) st.type[i] = GuestType.Solo; } },
    ],
  },
  {
    id: 'arrival.parking',
    setup: (s) => removeTypes(s, 'parking'),
    fixes: [
      { name: 'parking at the suggested site, connected', apply: (s, a) => { const st = a.action!.site!; const d = BUILDINGS.parking!; const site = { type: 'parking', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }; expect(placeSite(s, site).ok).toBe(true); link(s, site); } },
      { name: 'parking elsewhere, connected', apply: (s) => { buildAt(s, 'parking', { x: lodge(s).x + 10, y: lodge(s).y + 6 }, { rmax: 10 }); } },
      { name: 'a shuttle depot instead, connected', apply: (s) => { buildAt(s, 'shuttleDepot', { x: lodge(s).x - 10, y: lodge(s).y + 6 }, { rmax: 12 }); } },
    ],
  },
  {
    id: 'cash.debt',
    setup: (s) => { (s.finance as unknown as { status: string }).status = 'debt'; s.game.money = -500; },
    fixes: [
      { name: 'take a loan (finance status still says debt until midnight)', apply: (s) => { const o = s.loans.offers(s.creditCtx()).find((x) => x.available)!; expect(s.loans.take(o.id, s.creditCtx(), { year: 1, month: 0 }).ok).toBe(true); s.game.money = Math.max(s.game.money, 50_000); } },
      { name: 'income arrives', apply: (s) => { s.game.money = 2_000_000; } },
    ],
  },
  {
    id: 'cash.runway',
    setup: (s) => { s.game.money = 300; },
    fixes: [
      { name: 'take a loan', apply: (s) => { s.game.money += 400_000; s.bus.emit('loan:taken', { amount: 400_000, total: 400_000, rate: 5, termMonths: 12 }); } },
      { name: 'cut costs: remove all lifts and buildings', apply: (s) => { for (const b of s.buildings.all().slice()) s.buildings.remove(b.id); s.lifts.all = () => [] as never; } },
    ],
  },
  {
    id: 'cash.tips',
    setup: (s) => { s.game.money = 3_000; },
    fixes: [
      { name: 'a loan or income lifts the cash', apply: (s) => { s.game.money = 60_000; } },
      { name: 'the first two years are over', apply: (s) => { s.game.date.year = 3; } },
    ],
  },
  {
    id: 'cash.summerBuffer',
    setup: (s) => { s.game.date.day = seasonStartDay('summer') - 10; s.game.money = 800; },
    fixes: [
      { name: 'cash is saved up', apply: (s) => { s.game.money = 5_000_000; } },
      { name: 'summer arrives', apply: (s) => { s.game.date.day = seasonStartDay('summer') + 1; } },
    ],
  },
  {
    id: 'snow.gaps',
    setup: (s) => { removeTypes(s, 'snowCannon'); },
    fixes: [
      { name: 'the pistes are covered by snowmaking', apply: (s) => { s.coverage.map('snowmaking').fill(1); } },
      { name: 'the reservoir is removed (then season.winter asks for it)', apply: (s) => { removeTypes(s, 'reservoir'); } },
    ],
  },
  {
    id: 'snow.mode',
    setup: (s) => { s.weather.current.snowline = 1e6; },
    fixes: [
      { name: 'switch to Auto', apply: (s) => { s.ops.snowmaking.setMode('auto'); } },
      { name: 'turn the cannons off', apply: (s) => { s.ops.snowmaking.setMode('off'); } },
    ],
  },
  {
    id: 'price.fair',
    setup: (s) => { guests(s, 20); s.pricing.set('dayPass', s.pricing.defaultOf('dayPass') * 3); },
    fixes: [
      { name: 'reset the price', apply: (s) => { s.pricing.set('dayPass', s.pricing.defaultOf('dayPass')); } },
      { name: 'lower it a little', apply: (s) => { s.pricing.set('dayPass', s.pricing.defaultOf('dayPass') * 1.1); } },
      { name: 'guests leave (too few to judge)', apply: (s) => { guests(s, 3); } },
    ],
  },
  {
    id: 'marketing.ready',
    setup: () => { /* the starter resort already qualifies */ },
    fixes: [
      { name: 'start the campaign', apply: (s) => { const def = s.marketing.list().find((d) => s.marketing.blocker(d.id) === null)!; expect(s.marketing.start(def.id)).toBeNull(); } },
      { name: 'cash drops below the threshold', apply: (s) => { s.game.money = 5_000; } },
    ],
  },
  {
    id: 'marketing.trainIdle',
    setup: (s) => { guests(s, 20); trainStub(s, 0.01); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'train' }] as never; } },
      { name: 'more guests take the train', apply: (s) => { trainStub(s, 0.2); } },
    ],
  },
  {
    id: 'marketing.parkingFull',
    setup: (s) => { trainStub(s, 0.3); parkingStub(s, 1e6); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'train' }] as never; } },
      { name: 'the car park empties', apply: (s) => { parkingStub(s, 0); } },
    ],
  },
  {
    id: 'marketing.summerCamp',
    setup: (s) => { guests(s, 20); s.game.date.day = seasonStartDay('summer') + 5; s.game.money = 50_000; campStub(s, 'summerCamp'); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'summerCamp' }] as never; } },
      { name: 'cash drops below the threshold', apply: (s) => { s.game.money = 4_000; } },
      { name: 'summer ends', apply: (s) => { s.game.date.day = seasonStartDay('winter') + 2; } },
    ],
  },
  {
    id: 'marketing.anglers',
    setup: (s) => { guests(s, 20); s.game.money = 50_000; campStub(s, 'angler'); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'angler' }] as never; } },
      { name: 'cash drops below the threshold', apply: (s) => { s.game.money = 2_000; } },
      { name: 'spring arrives', apply: (s) => { s.game.date.day = seasonStartDay('spring') + 2; } },
    ],
  },
  {
    id: 'marketing.wellness',
    setup: (s) => { guests(s, 20); s.game.money = 50_000; campStub(s, 'wellness'); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'wellness' }] as never; } },
      { name: 'cash drops below the threshold', apply: (s) => { s.game.money = 2_000; } },
      { name: 'spring arrives', apply: (s) => { s.game.date.day = seasonStartDay('spring') + 2; } },
    ],
  },
  {
    id: 'marketing.school',
    setup: (s) => { guests(s, 20); s.game.date.day = seasonStartDay('summer') + 5; s.game.money = 50_000; campStub(s, 'school'); },
    fixes: [
      { name: 'the campaign starts', apply: (s) => { s.marketing.running = () => [{ id: 'school' }] as never; } },
      { name: 'cash drops below the threshold', apply: (s) => { s.game.money = 2_000; } },
      { name: 'the season turns to autumn', apply: (s) => { s.game.date.day = seasonStartDay('autumn') + 2; } },
    ],
  },
  {
    id: 'season.winter',
    setup: (s) => { s.game.date.day = seasonStartDay('winter') - 10; removeTypes(s, 'snowCannon'); },
    fixes: [
      { name: 'cannon at the suggested site', apply: (s, a) => { const st = a.action!.site; if (a.action!.building === 'reservoir' || !st) { buildAt(s, 'reservoir', lodge(s), { rmax: 20 }); buildAt(s, 'snowCannon', pisteMid(s), { connect: false, rmax: 6 }); return; } const d = BUILDINGS.snowCannon!; expect(placeSite(s, { type: 'snowCannon', x: st.x, y: st.y, rot: st.rot, autoFlatten: true, cost: 0, rect: { x: st.x, y: st.y, w: d.w, h: d.h } }).ok).toBe(true); } },
      { name: 'a cannon anywhere along the piste', apply: (s) => { const c = findAlongPiste(s, 'snowCannon', 6, [0.8, 0.2]); if (!c) { buildAt(s, 'reservoir', lodge(s), { rmax: 20 }); } buildAt(s, 'snowCannon', pisteMid(s), { connect: false, rmax: 8 }); } },
    ],
  },
  {
    id: 'farm.almabtrieb', daily: true,
    setup: (s) => { s.events.setAuto(true); removeTypes(s, 'alpineFarm'); s.game.date.day = seasonStartDay('summer') + 5; },
    fixes: [
      { name: 'an Alpine Farm is built', apply: (s) => { buildAt(s, 'alpineFarm', lodge(s), { rmax: 14 }); } },
      { name: 'winter arrives', apply: (s) => { s.game.date.day = seasonStartDay('winter') + 2; } },
    ],
  },
  {
    id: 'season.summer', daily: true,
    setup: (s) => { s.game.date.day = seasonStartDay('summer') - 10; },
    fixes: [
      { name: 'a hike trail anywhere', apply: (s) => { const i = s.networks.layers.findIndex((v, k) => v === 0 && k > 1000); s.networks.layers[i] = (s.networks.layers[i]! | Layer.Hike) as never; } },
      { name: 'a bike trail anywhere', apply: (s) => { const i = s.networks.layers.findIndex((v, k) => v === 0 && k > 1500); s.networks.layers[i] = (s.networks.layers[i]! | Layer.Mtb) as never; } },
    ],
  },
  {
    id: 'summer.camp', daily: true,
    setup: (s) => { guests(s, 40); s.game.date.day = seasonStartDay('summer') + 5; },
    fixes: [
      { name: 'a campground with toilets stands', apply: (s) => { const c = buildAt(s, 'campground', lodge(s), { rmax: 22 }); buildAt(s, 'toilets', { x: c.x + 2, y: c.y + 2 }, { rmax: 6 }); } },
      { name: 'winter comes', apply: (s) => { s.game.date.day = seasonStartDay('winter') + 5; } },
    ],
  },
  {
    id: 'tour.quad', daily: true,
    setup: (s) => { s.progression.unlockAll = true; guests(s, 40); s.game.date.day = seasonStartDay('summer') + 5; },
    fixes: [
      { name: 'a quad base stands', apply: (s) => { buildAt(s, 'quadBase', lodge(s), { rmax: 14 }); } },
      { name: 'the resort is quiet', apply: (s) => { guests(s, 5); } },
      { name: 'winter comes', apply: (s) => { s.game.date.day = seasonStartDay('winter') + 5; } },
    ],
  },
  {
    id: 'tour.water', daily: true,
    setup: (s) => { s.progression.unlockAll = true; guests(s, 40); s.game.date.day = seasonStartDay('summer') + 5; riverStub(s, [1, 1, 1, 1, 1, 2, 2, 1]); },
    fixes: [
      { name: 'a rafting base stands', apply: (s) => { s.buildings.add('raftingBase', 8, 8); } },
      { name: 'the resort is quiet', apply: (s) => { guests(s, 5); } },
      { name: 'the river runs dry (calm water)', apply: (s) => { riverStub(s, [0, 0, 0, 0, 0, 0, 0, 0]); } },
      { name: 'winter comes', apply: (s) => { s.game.date.day = seasonStartDay('winter') + 5; } },
    ],
  },
  {
    id: 'fish.overfished',
    setup: (s) => { s.progression.unlockAll = true; buildAt(s, 'tackleHut', lodge(s), { rmax: 14 }); s.fishStock.set('l0', 0.1); },
    fixes: [
      { name: 'the water recovers', apply: (s) => { s.fishStock.set('l0', 0.8); } },
      { name: 'the hut is bulldozed', apply: (s) => { for (const b of s.buildings.all().filter((x) => x.type === 'tackleHut')) s.buildings.remove(b.id); } },
    ],
  },
  {
    id: 'piste.disconnected', daily: true,
    setup: (s) => { let t = 0; for (let i = 0; i < s.size * s.size; i++) if (s.ops.quality.isPiste(i)) { t = i; break; } const real = s.networks.pisteComponents.bind(s.networks); s.networks.pisteComponents = () => [...real(), { disconnected: true, count: 9, tiles: [t] }] as never; },
    fixes: [
      { name: 'the piste gets linked to a lift', apply: (s) => { const real = s.networks.pisteComponents.bind(s.networks); s.networks.pisteComponents = () => real().map((c) => ({ ...c, disconnected: false })) as never; } },
      { name: 'the loose piste is erased', apply: (s) => { const real = s.networks.pisteComponents.bind(s.networks); s.networks.pisteComponents = () => real().filter((c) => !c.disconnected) as never; } },
    ],
  },
  {
    id: 'building.inactive',
    // a road-fed shop placed with no road: inactive
    setup: (s) => { buildAt(s, 'shop', { x: 10, y: 20 }, { connect: false, rmax: 10 }); },
    fixes: [
      { name: 'a road is built to it', apply: (s) => { const b = s.buildings.all().find((x) => x.type === 'shop' && !x.active)!; const p = planRoadTo(s, { x: b.x, y: b.y, w: b.w, h: b.h }); if (p?.length) buildNetwork(s, 2, p); } },
      { name: 'it is bulldozed', apply: (s) => { const b = s.buildings.all().find((x) => x.type === 'shop' && !x.active)!; s.buildings.remove(b.id); } },
    ],
  },
  {
    id: 'lift.service',
    setup: (s) => { s.game.date.day = seasonStartDay('winter') - 10; for (const l of s.lifts.all()) l.ops!.maint = { last: -400, count: 0 }; },
    fixes: [
      { name: 'serviced', apply: (s) => { for (const l of s.lifts.all()) l.ops!.maint = { last: s.game.date.year * 180 + s.game.date.day, count: 1, level: 'basic' }; } },
    ],
  },
  {
    id: 'lift.worn',
    setup: (s) => { removeTypes(s, 'liftWorkshop'); s.lifts.all()[0]!.ops!.condition = 20; },
    fixes: [
      { name: 'repaired', apply: (s) => { s.lifts.all()[0]!.ops!.condition = 95; } },
    ],
  },
  {
    id: 'energy.green', daily: true,
    setup: (s) => { s.sustain.last = () => ({ energy: 0.1, trees: 0.9, habitat: 0.9, score: 60, raw: { energyPerGuest: 10.5, treeLoss: 0, habitatOverlap: 0, protection: 0 } }); },
    fixes: [
      { name: 'energy is no longer the weakest part', apply: (s) => { s.sustain.last = () => ({ energy: 0.9, trees: 0.9, habitat: 0.9, score: 90, raw: { energyPerGuest: 3, treeLoss: 0, habitatOverlap: 0, protection: 0 } }); } },
      { name: 'a solar array stands and works', apply: (s) => { s.energy.hasRenewable = () => true; } },
    ],
  },
  {
    id: 'eco.centre', daily: true,
    setup: (s) => { s.progression.unlockAll = true; s.sustain.last = () => ({ energy: 0.9, trees: 0.9, habitat: 0.9, score: 40, raw: { energyPerGuest: 3, treeLoss: 0, habitatOverlap: 0, protection: 0 } }); s.energy.hasRenewable = () => true; s.rating.breakdown = () => ({ score: 70, stars: 3.5, components: [{ id: 'sustainability', label: 'Sustainability', score: 40, weight: 0.08, hint: 'Plant trees' }, { id: 'happiness', label: 'Guest happiness', score: 85, weight: 0.22, hint: 'Guests are happy' }], bonus: 0, bonusHints: [], hints: [] }); },
    fixes: [
      { name: 'sustainability is no longer the weakest area', apply: (s) => { s.rating.breakdown = () => ({ score: 70, stars: 3.5, components: [{ id: 'sustainability', label: 'Sustainability', score: 90, weight: 0.08, hint: 'Gentle on the mountain' }, { id: 'happiness', label: 'Guest happiness', score: 60, weight: 0.22, hint: 'x' }], bonus: 0, bonusHints: [], hints: [] }); } },
      { name: 'an Eco Centre stands', apply: (s) => { buildAt(s, 'ecoCentre', { x: 10, y: 20 }, { connect: false, rmax: 12 }); } },
    ],
  },
  {
    id: 'rating.lowest', daily: true,
    setup: () => { /* starter resort: variety is weakest */ },
    fixes: [
      { name: 'weakest area now reads as good news', apply: (s) => { s.rating.breakdown = () => ({ score: 58, stars: 3, components: [{ id: 'happiness', label: 'Guest happiness', score: 58, weight: 0.25, hint: 'Guests are happy' }], bonus: 0, bonusHints: [], hints: [] }); } },
      { name: 'scores recover', apply: (s) => { s.rating.breakdown = () => ({ score: 90, stars: 4.5, components: [{ id: 'variety', label: 'Variety', score: 90, weight: 0.2, hint: 'Add attractions' }], bonus: 0, bonusHints: [], hints: [] }); } },
    ],
  },
  {
    id: 'goal.next', daily: true,
    setup: () => { /* active goals exist */ },
    fixes: [
      { name: 'goals paused', apply: (s) => { s.goals.paused = true; } },
    ],
  },
];

describe('every rule has a scenario', () => {
  it('every rule has exactly one scenario', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(21);
    expect(SCENARIOS.map((s) => s.id).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
});

describe('(a)+(b) each rule fires, and goes away at the next evaluation after every valid fix', () => {
  for (const sc of SCENARIOS) {
    const fires = (s: Sim): Advice => {
      sc.setup(s);
      s.advisor.evaluate(true);
      const a = adviceOf(s, sc.id);
      expect(a, `${sc.id} fires`).toBeTruthy();
      return a!;
    };
    it(`${sc.id}: fires`, () => { fires(make()); });
    for (const fix of sc.fixes) {
      it(`${sc.id}: cleared when ${fix.name}`, () => {
        const s = make();
        const a = fires(s);
        fix.apply(s, a);
        const ids = reeval(s);
        expect(ids, `${sc.id} after "${fix.name}"`).not.toContain(sc.id);
      });
    }
  }
});

describe('(c) incomplete fixes get specific, accurate advice', () => {
  const unconnected = (type: string, anchor: (s: Sim) => Pt, rule: string, setup: (s: Sim) => void, word: RegExp): void => {
    it(`${rule}: a ${type} that is placed but not connected is named, with the right requirement, and cleared once connected`, () => {
      const s = make();
      setup(s);
      const site = buildAt(s, type, anchor(s), { connect: false, rmax: 12 });
      const b = s.buildings.all().find((x) => x.type === type && !x.active)!;
      expect(b, `${type} inactive`).toBeTruthy();
      const ids = hour(s);
      expect(ids).toContain(rule);
      const a = adviceOf(s, rule)!;
      expect(a.action).toBeUndefined();
      expect(a.target).toMatchObject({ kind: 'building', id: b.id });
      expect(a.why).toMatch(/^Your /);
      expect(a.why).toContain(s.names.buildingName(b.id));
      expect(a.why).toMatch(word);
      expect(a.why).not.toMatch(/\d+, \d+/); // no coordinates-only language
      expect(ids).not.toContain('building.inactive'); // one root cause, one advice
      link(s, site);
      expect(hour(s)).not.toContain(rule);
    });
  };
  unconnected('groomerGarage', (s) => ({ x: lodge(s).x - 14, y: lodge(s).y + 6 }), 'grooming.none', (s) => removeTypes(s, 'groomerGarage', 'snowcatOutpost'), /road/);
  unconnected('patrolHub', (s) => ({ x: lodge(s).x - 12, y: lodge(s).y + 4 }), 'patrol.none', (s) => { guests(s, 14); removeTypes(s, 'patrolHub', 'firstAid'); openAll(s); }, /road/);
  unconnected('skiSchoolHQ', (s) => ({ x: lodge(s).x - 14, y: lodge(s).y + 6 }), 'school.none', (s) => { removeTypes(s, 'skiSchoolHQ'); setFamilies(s, 9); }, /road/);
  unconnected('parking', (s) => ({ x: lodge(s).x + 10, y: lodge(s).y + 6 }), 'arrival.parking', (s) => removeTypes(s, 'parking'), /road/);

  it('building.inactive: a road-fed building names a road; a path-fed one names a footpath (never "road" for a cafe)', () => {
    const s = make();
    buildAt(s, 'cafe', { x: 10, y: 20 }, { connect: false, rmax: 10 });
    hour(s);
    const a = adviceOf(s, 'building.inactive')!;
    expect(a, 'inactive cafe is reported').toBeTruthy();
    expect(a.why).toMatch(/footpath, road or piste/);
    expect(a.title).toMatch(/Caf/i);
  });

  it('remote buildings in the middle of nowhere are never reported inactive', () => {
    const s = make();
    for (const t of ['snowcatOutpost', 'firstAid', 'warningSign', 'helipad']) {
      const site = findSite(s, t, { x: 8, y: 25 }, { rmax: 14 });
      if (site) placeSite(s, site);
    }
    s.advisor.evaluate(true);
    const inactive = adviceOf(s, 'building.inactive');
    if (inactive) expect(inactive.why).not.toMatch(/not connected/i);
    for (const b of s.buildings.all()) if (BUILDINGS[b.type]!.access === 'none') expect(b.reason ?? '').not.toMatch(/not connected/i);
  });

  it('queue.long never fires for a closed lift', () => {
    const s = make();
    s.guestSim.queues.waitTicks = () => 40;
    for (const l of s.lifts.all()) { l.open = false; l.opsReason = 'hours'; }
    expect(hour(s)).not.toContain('queue.long');
  });
  it('lift.idle stays quiet when every lift is quiet (night)', () => {
    const s = make();
    guests(s, 25);
    const l = s.lifts.all()[0]!;
    s.lifts.all = () => [{ ...l, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 0, perHour: 0 } }, { ...l, id: 99, ops: { ...l.ops!, ageDays: 9 }, riders: { total: 0, perHour: 0 } }] as never;
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'lift.idle')).toBeUndefined();
  });
  it('grooming: an outpost on its own is not "no grooming"; a far garage says "gap", not "none"; icy is not blamed on missing snowcats', () => {
    const s = make();
    removeTypes(s, 'groomerGarage', 'snowcatOutpost');
    const q = s.ops.quality as unknown as { state: Uint8Array };
    for (let i = 0; i < q.state.length; i++) if (s.ops.quality.isPiste(i)) q.state[i] = Q.Icy;
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'grooming.none')).toBeTruthy();
    expect(adviceOf(s, 'piste.icy')).toBeUndefined(); // root cause is grooming.none
    buildAt(s, 'groomerGarage', FAR, { rmax: 10 });
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'grooming.none')).toBeUndefined();
    const gap = adviceOf(s, 'grooming.gap')!;
    expect(gap.why).toMatch(/^\d+% of piste tiles are outside grooming coverage/);
    expect(gap.action?.building).toBe('snowcatOutpost');
    // an outpost needs no road: its suggested site must not depend on one
    expect(BUILDINGS.snowcatOutpost!.access).toBe('none');
  });
  it('patrol: "no ski patrol" is not claimed while an active hub exists; a far hub is an aid gap with an accurate percentage', () => {
    const s = make();
    guests(s, 14); openAll(s);
    removeTypes(s, 'patrolHub', 'firstAid');
    buildAt(s, 'patrolHub', FAR, { rmax: 10 });
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'patrol.none')).toBeUndefined();
    const a = adviceOf(s, 'aid.gap')!;
    const pct = Number(/^(\d+)%/.exec(a.why)![1]);
    const facts = s.ops.quality;
    let tiles = 0, uncovered = 0;
    for (let i = 0; i < s.size * s.size; i++) if (facts.isPiste(i)) { tiles++; const x = i % s.size, y = (i / s.size) | 0; if (!s.coverage.isCovered('patrol', x, y) && !s.coverage.isCovered('firstAid', x, y)) uncovered++; }
    expect(pct).toBe(Math.round((uncovered / tiles) * 100));
  });
  it('season.winter: with a lake or reservoir in reach the advice asks for cannons, not "reservoir first"; an inactive cannon is not "missing"', () => {
    const s = make();
    s.game.date.day = seasonStartDay('winter') - 10;
    removeTypes(s, 'snowCannon');
    s.advisor.evaluate(true);
    const a = adviceOf(s, 'season.winter')!;
    // starter resort has a reservoir: the cannon is what is missing
    expect(a.action?.building).toBe('snowCannon');
    buildAt(s, 'snowCannon', pisteMid(s), { connect: false, rmax: 8 });
    removeTypes(s, 'reservoir'); // the cannon may now lack water
    const cannons = s.buildings.all().filter((b) => b.type === 'snowCannon');
    if (cannons.length && !cannons[0]!.active) {
      s.advisor.evaluate(true);
      expect(adviceOf(s, 'season.winter')).toBeUndefined();
      expect(adviceOf(s, 'building.inactive')?.why).toMatch(/Reservoir|Lake/i);
    }
  });
  it('lift.worn with an idle workshop does not ask for a second workshop', () => {
    const s = make();
    removeTypes(s, 'liftWorkshop');
    s.lifts.all()[0]!.ops!.condition = 20;
    buildAt(s, 'liftWorkshop', { x: lodge(s).x - 14, y: lodge(s).y + 6 }, { connect: false, rmax: 12 });
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'lift.worn')?.action).toBeUndefined();
    expect(adviceOf(s, 'building.inactive')?.why).toMatch(/road/);
  });
  it('rating.lowest never shows good news as a to-do and never repeats patrol / price advice', () => {
    const s = make();
    s.rating.breakdown = () => ({ score: 58, stars: 3, components: [{ id: 'happiness', label: 'Guest happiness', score: 58, weight: 0.25, hint: 'Guests are happy' }], bonus: 0, bonusHints: [], hints: [] });
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'rating.lowest')).toBeUndefined();
    guests(s, 14); openAll(s); removeTypes(s, 'patrolHub', 'firstAid');
    s.rating.breakdown = () => ({ score: 50, stars: 2, components: [{ id: 'safety', label: 'Safety', score: 40, weight: 0.2, hint: 'Add a Ski Patrol Hub' }], bonus: 0, bonusHints: [], hints: [] });
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'patrol.none')).toBeTruthy();
    expect(adviceOf(s, 'rating.lowest')).toBeUndefined();
  });
  it('goal.next does not repeat a building advice that is already live', () => {
    const s = make();
    guests(s, 14); openAll(s); removeTypes(s, 'patrolHub', 'firstAid');
    s.goals.view = () => ({ active: [{ id: 'patrol', title: 'Safety first', todo: 'Build a Ski Patrol Hub on a road.', progress: 0 }] }) as never;
    s.advisor.evaluate(true);
    expect(adviceOf(s, 'patrol.none')).toBeTruthy();
    expect(adviceOf(s, 'goal.next')).toBeUndefined();
  });
  it('cash rules follow the cash, not the midnight status flag: a loan clears "In debt" within the hour', () => {
    const s = make();
    (s.finance as unknown as { status: string }).status = 'debt';
    s.game.money = -500;
    expect(hour(s)).toContain('cash.debt');
    s.game.money = 80_000;
    const ids = hour(s);
    expect(ids).not.toContain('cash.debt');
  });
});

describe('wording: factual, capitalised, named, no ids / coordinates', () => {
  it('every live advice of a stressed resort passes the text rules', () => {
    const s = make();
    for (const sc of [...SCENARIOS.filter((x) => !x.id.startsWith('cash.')), ...SCENARIOS.filter((x) => x.id.startsWith('cash.'))]) sc.setup(s);
    s.advisor.evaluate(true);
    expect(s.advisor.ranked().length).toBeGreaterThan(5);
    for (const a of s.advisor.ranked()) for (const txt of [a.title, a.why]) {
      expect(txt, a.id).toBe(sentence(txt));
      expect(txt, a.id).not.toMatch(/[a-z]+[A-Z][a-z]+/); // no raw camelCase ids (groomerGarage)
      expect(txt, a.id).not.toMatch(/\b\d+, \d+\b/); // no bare coordinates
      expect(txt, a.id).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});

describe('(d) every proposed site passes the real validators (20 seeds x 3 sizes)', () => {
  const PREP: Array<(s: Sim) => void> = [
    (s) => removeTypes(s, 'groomerGarage', 'snowcatOutpost'),
    (s) => { guests(s, 14); openAll(s); removeTypes(s, 'patrolHub', 'firstAid'); },
    (s) => { removeTypes(s, 'skiSchoolHQ'); setFamilies(s, 9); },
    (s) => removeTypes(s, 'parking'),
    (s) => { guests(s, 12); s.weather.current.kind = 'storm'; },
    (s) => { s.game.date.day = seasonStartDay('winter') - 10; removeTypes(s, 'snowCannon', 'reservoir'); },
    (s) => { removeTypes(s, 'liftWorkshop'); for (const l of s.lifts.all()) l.ops!.condition = 20; },
    (s) => { s.game.date.day = seasonStartDay('summer') + 5; guests(s, 10); s.ops.safety!.wildlife.animals.push({ kind: 'bear', asleep: false, x: 12, y: 12 } as never); removeTypes(s, 'rangerStation'); },
  ];
  const check = (s: Sim, label: string): number => {
    let n = 0;
    for (const a of s.advisor.ranked()) {
      const site = a.action?.site;
      if (!site || !a.action) continue;
      n++;
      const def = BUILDINGS[a.action.building]!;
      const chk = validatePlacement(s.env, a.action.building, site.x, site.y, site.rot, autoFlattenDefault(a.action.building));
      expect(chk.reasons.filter((r) => !r.startsWith('Not enough funds')), `${label} ${a.id} ${a.action.building}@${site.x},${site.y}`).toEqual([]);
      // a road-fed / path-fed site must be connectable (the building would otherwise start inactive)
      const w = site.rot % 2 ? def.h : def.w, h = site.rot % 2 ? def.w : def.h, rect = { x: site.x, y: site.y, w, h };
      if (def.access === 'road') expect(planRoadTo(s, rect), `${label} ${a.id}: no road route`).not.toBeNull();
      if (def.access === 'path') expect(planPathTo(s, rect), `${label} ${a.id}: no path route`).not.toBeNull();
      // a remote type never asks for a road
      if (def.access === 'none') expect(a.why, `${label} ${a.id}`).not.toMatch(/road|footpath/i);
    }
    return n;
  };
  for (const size of [64, 128, 256] as const) {
    it(`size ${size}: seeds 1..20`, () => {
      let proposed = 0;
      const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
      for (const seed of seeds) {
        const s = make(seed * 7 + 3, size);
        PREP.forEach((p) => p(s));
        s.advisor.evaluate(true);
        proposed += check(s, `size${size} seed${seed}`);
      }
      expect(proposed).toBeGreaterThan(0);
    }, 240_000);
  }
});

describe('tutorial / hints / goals: the same state-based rules', () => {
  const advanceTo = (id: string) => {
    const sim = tutorialSim(64);
    const eng = makeEngine(sim);
    eng.start({ fresh: true });
    for (let i = 0; i < 40 && eng.current?.id !== id; i++) { if (eng.current?.ack) eng.next(); else eng.doItForMe(); eng.evaluate(); }
    expect(eng.current?.id).toBe(id);
    return { sim, eng };
  };
  it("'Show me' on a building step points at the unconnected building that already stands, not at a second site", () => {
    const { sim, eng } = advanceTo('patrol');
    sim.game.money = 1e7;
    const site = findSite(sim, 'patrolHub', { x: lodge(sim).x - 12, y: lodge(sim).y + 4 }, { rmax: 12 })!;
    expect(placeSite(sim, site).ok).toBe(true);
    const b = sim.buildings.all().find((x) => x.type === 'patrolHub')!;
    expect(b.active).toBe(false);
    eng.evaluate(true);
    expect(eng.current?.id).toBe('patrol');
    const m = eng.showMe().map!;
    expect([m.x, m.y]).toEqual([b.x, b.y]);
    link(sim, site);
    eng.evaluate(true);
    expect(eng.state.completed).toContain('patrol');
  });
  it('the parking road lesson is state-based: any road-served lot counts; the unserved lot is the one shown', () => {
    const s = make();
    const q = new Queries(s);
    expect(q.parkingRoadServed()).toBe(true);
    buildAt(s, 'parking', { x: 10, y: 20 }, { connect: false, rmax: 10 }); // a second lot, no road
    expect(q.parkingRoadServed()).toBe(true); // the first one still works
    const lone = q.unservedParking()!;
    expect(lone.active).toBe(false);
    removeTypes(s, 'parking');
    expect(q.parkingRoadServed()).toBe(false);
  });
});
