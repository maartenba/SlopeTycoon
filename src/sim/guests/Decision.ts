import { BUILDINGS } from '../../config/buildings';
import { LIFTS } from '../../config/lifts';
import { Layer } from '../../world/Networks';
import type { LiftData } from '../Lift';
import { coreOf, GuestType, type GuestStore } from './Guest';
import type { WorldBuilding } from './GuestWorld';
import { NavMode, type NavGraph } from './NavGraph';
import type { DecisionPort } from './AttractionPort';
import { maxDifficultyFor } from './Skill';
import { EVENING } from '../../config/balance';
import { apresEnd, eveningTypeBias, isApres, sleepHour, venueDemand, venueKindOf } from '../Evening';
import { TrailGoals } from './TrailGoals';
import { NEEDS } from './Needs';

/** Current activity of a guest (stored in GuestStore.act). */
export const Act = { None: 0, ToBuilding: 1, ToLift: 2, Queue: 3, Ride: 4, SkiDown: 5, ToTrail: 6, Excursion: 7 } as const;
/** Activity preference (GuestStore.pref). */
export const Pref = { Ski: 0, Hike: 1, Bike: 2 } as const;

export type IntentKind = 'eat' | 'rest' | 'ski' | 'lesson' | 'activity' | 'shop' | 'home' | 'hike' | 'bike';

export const FOOD = new Set(['baseLodge', 'lodge', 'cafe', 'mountainHut', 'heatedTerrace']);
/** Evening venues beyond the daytime FOOD list: the Après-Ski Bar (a drinks stop, not a meal). */
export const BAR = new Set(['apresBar']);
/** Every venue the evening model schedules (dinner, drinks, terrace). */
export const EVENING_VENUES: readonly string[] = [...FOOD, ...BAR];
export const REST = new Set(['baseLodge', 'lodge', 'chalet', 'apartment']);
export const SHOP = new Set(['shop', 'rental']);
/** Real attractions (activity goals); everything else visitable counts as generic wandering. */
export const ACTIVITY = new Set(['iceRink', 'stuntPark', 'adventurePark', 'beach', 'boatRental', 'playground', 'kidsGround', 'magicCarpet']);
export const LESSON = new Set(['skiSchoolHQ']);
const VISIT_CATEGORIES = new Set(['core', 'services', 'lodging', 'recreation', 'kids', 'water']);

export interface LiftInfo {
  lift: LiftData;
  /** Carries skiers up AND a ski route from its top back to its base exists for max difficulty d (index d = 0..3). */
  skiDescent: [boolean, boolean, boolean, boolean];
  bikeDescent: boolean;
  topDepth: number;
  bottomX: number; bottomY: number;
}

export interface Intent {
  kind: IntentKind;
  building?: WorldBuilding;
  lift?: LiftInfo;
  tile?: number;
  /** Excursion: lift-top tile to ride up to first (-1/undefined = none) and whether the route is a one-way descent. */
  via?: number; oneWay?: boolean;
  /** Overnight trek: Mountain Hut building id to sleep in. */
  trek?: number;
  offPiste?: boolean;
  score: number;
}

/** Snow preference 0..1 by skill: experts want deep powder, beginners packed snow and no slush. */
export function snowPreference(skill: number, depth: number): number {
  const ideal = [0.5, 0.7, 1.0, 1.4][Math.max(0, Math.min(3, skill))]!;
  let v = 1 - Math.min(1, Math.abs(depth - ideal) / ideal);
  if (skill <= 1 && depth < 0.4) v -= 0.5; // slush
  return v;
}

/** Deterministic activity preference from guest id and type. */
export function prefFor(id: number, type: number): number {
  const h = (Math.imul(id, 2654435761) >>> 0) % 100;
  const ct = coreOf(type);
  const [hike, bike] = ct === GuestType.Adventure ? [5, 15] : ct === GuestType.Family ? [30, 20] : [15, 15];
  return h < hike ? Pref.Hike : h < hike + bike ? Pref.Bike : Pref.Ski;
}

/** Price sensitivity by guest type [solo, couple, family, vip, budget, adventure] (elasticity stub). */
export const PRICE_SENSITIVITY = [1, 1, 1.2, 0.3, 2, 1] as const;

const dist2 = (b: WorldBuilding, x: number, y: number): number => (b.x + b.w / 2 - x) ** 2 + (b.y + b.h / 2 - y) ** 2;

/**
 * Utility-based goal selection. `refresh` snapshots the resort every few ticks (buildings by role, open lifts with the ski/bike
 * routes that exist RIGHT NOW given per-tile snow conditions and the skill-limited difficulty, snow-free trails); `choose`
 * scores the candidates for one guest.
 */
export class Decider {
  food: WorldBuilding[] = [];
  bars: WorldBuilding[] = [];
  huts: WorldBuilding[] = [];
  rest: WorldBuilding[] = [];
  shop: WorldBuilding[] = [];
  activity: WorldBuilding[] = [];
  other: WorldBuilding[] = [];
  lessons: WorldBuilding[] = [];
  lifts: LiftInfo[] = [];
  hikeTiles: number[] = [];
  mtbTiles: number[] = [];
  skiOpenTiles = 0;
  private descent = new Map<string, boolean>();
  private descentEpoch = -1;
  private scanEpoch = -1;
  /** Max uncached descent queries per refresh (time-slicing). */
  descentBudget = 10;
  waitTicks: (liftId: number, dir: 0 | 1) => number = () => 0;
  /** Ops hook (Task 25): resort-wide piste-quality liking (-1..1) for a skill; weights ski run choice. */
  pisteQualityScore: (skill: number) => number = () => 0;
  /** Safety hook (Task 26): multiplier on the chance a skier goes off-piste (warning signs, bad weather, avalanche risk). */
  offPisteScale: () => number = () => 1;
  /** Safety hook (Task 26): score penalty for choosing a hike tile (warning signs near wildlife areas). */
  hikePenalty: (tile: number) => number = () => 0;
  /** Wildlife hook: 0..1 how strongly guests avoid a tile (bear threat field). Trails, huts and attractions inside it lose appeal. */
  avoidTile: (tile: number) => number = () => 0;
  /** Exploration hook (sim/guests/Exploration.ts): penalty >= 0 for choosing this lift again (the guest remembers its last rides). */
  novelty: (slot: number, liftId: number) => number = () => 0;
  /** Family hook (Task 22): highest skill a guest may act on (parents without a kids area stay on easy runs). */
  skillCap: (slot: number) => number = () => 3;
  /** Attraction runtime (Task 23): open/closed filtering, prices, queues, gear. Without it every active building is a candidate. */
  port?: DecisionPort;

  /** Appeal-based trail goals (sim/guests/TrailGoals.ts); `useGoals` off = the old uniform random trail tile (A/B in tests/analysis). */
  readonly goals: TrailGoals;
  useGoals = true;
  /** Hour day guests start heading home (set by GuestSim each tick) and whether a storm is on. */
  leaveHour = 17; stormy = false;
  /** Day of year + hour the evening model is evaluated at (set by GuestSim each tick). */
  day = 0; eveningStart = 16;
  /** Trek hook (GuestSim): may this guest start a multi-day trek (not trekked yet, not already planned)? */
  canTrek: (guestId: number) => boolean = () => false;
  /** Share (0-100) of solo/couple/adventure guests that are trekkers when a hut with free beds is reachable. */
  trekShare = 15;

  constructor(private nav: () => NavGraph | null) { this.goals = new TrailGoals(nav); }

  private avoidBuilding(b: WorldBuilding): number {
    const n = this.nav()?.size;
    return n ? this.avoidTile(Math.floor(b.y + b.h / 2) * n + Math.floor(b.x + b.w / 2)) : 0;
  }

  /** Drop every cached verdict (save load). */
  reset(): void { this.goals.reset(); this.descent.clear(); this.descentEpoch = -1; this.scanEpoch = -1; this.lifts = []; this.hikeTiles = []; this.mtbTiles = []; this.skiOpenTiles = 0; }

  refresh(buildings: Iterable<WorldBuilding>): void {
    this.food = []; this.bars = []; this.huts = []; this.rest = []; this.shop = []; this.activity = []; this.other = []; this.lessons = [];
    for (const b of buildings) {
      if (!b.active) continue;
      if (this.port && !this.port.accepts(b.id)) continue;
      if (LESSON.has(b.type)) this.lessons.push(b);
      if (b.type === 'mountainHut') this.huts.push(b); // trek goals do not depend on serving hours
      const serving = this.port?.serving?.(b.id) ?? true; // venues are only candidates while serving (08:00 - 23:00)
      if (FOOD.has(b.type) && serving) this.food.push(b);
      if (BAR.has(b.type) && serving) this.bars.push(b);
      if (REST.has(b.type)) this.rest.push(b);
      if (SHOP.has(b.type)) this.shop.push(b);
      if (ACTIVITY.has(b.type)) this.activity.push(b);
      if (VISIT_CATEGORIES.has(BUILDINGS[b.type]?.category ?? '') && !FOOD.has(b.type) && !BAR.has(b.type) && !REST.has(b.type) && !SHOP.has(b.type) && !ACTIVITY.has(b.type)) this.other.push(b);
    }
    const nav = this.nav();
    this.goals.queryBudget = 24;
    this.lifts = [];
    if (!nav) return;
    if (this.descentEpoch !== nav.epoch) { this.descent.clear(); this.descentEpoch = nav.epoch; }
    if (this.scanEpoch !== nav.epoch) this.scanTrails(nav);
    let budget = this.descentBudget;
    nav.pf.grantBuilds(24);
    const w = nav.world;
    for (const l of w.lifts()) {
      if (!l.open) continue;
      const am = l.activeMode ?? (l.kind === 'tbar' ? 'ski' : 'mixed');
      if (!am) continue;
      const top = nav.stationAnchor(l, 1), bottom = nav.stationAnchor(l, 0);
      const query = (mode: number): boolean => {
        const key = `${l.id}:${mode}`;
        let v = this.descent.get(key);
        if (v !== undefined) return v;
        const hit = nav.pf.cached(mode, top, bottom);
        if (hit === undefined) {
          if (budget <= 0) return false;
          budget--;
        }
        const res = hit !== undefined ? hit : nav.pf.find(mode, top, bottom);
        if (res === undefined) return false; // deferred (build budget): unknown, retried at the next refresh
        v = res !== null;
        this.descent.set(key, v);
        return v;
      };
      const skiCarry = am === 'ski' || am === 'mixed';
      const bikeCarry = (am === 'foot' || am === 'mixed') && LIFTS[l.kind].carriesBikes;
      const sd: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      if (skiCarry) for (let d = 0; d < 4; d++) sd[d] = query(NavMode.Ski0 + d);
      this.lifts.push({
        lift: l, skiDescent: sd, bikeDescent: bikeCarry ? query(NavMode.Bike) : false,
        topDepth: w.snow[top] ?? 0, bottomX: l.bottom.x, bottomY: l.bottom.y,
      });
    }
  }

  private scanTrails(nav: NavGraph): void {
    this.scanEpoch = nav.epoch;
    const w = nav.world, n2 = nav.size * nav.size;
    const hike: number[] = [], mtb: number[] = [];
    let ski = 0;
    for (let t = 0; t < n2; t++) {
      const l = w.layers[t]!;
      if (l === 0) continue;
      if ((l & Layer.Ski) !== 0 && w.skiOpen[t] === 1) ski++;
      if ((l & Layer.Hike) !== 0 && w.hikeOk[t] === 1) hike.push(t);
      if ((l & Layer.Mtb) !== 0 && w.hikeOk[t] === 1) mtb.push(t);
    }
    const sample = (a: number[]): number[] => { if (a.length <= 48) return a; const step = a.length / 48; return Array.from({ length: 48 }, (_, i) => a[Math.floor(i * step)]!); };
    this.hikeTiles = sample(hike); this.mtbTiles = sample(mtb); this.skiOpenTiles = ski;
    this.goals.build(nav, hike, mtb, this.huts.map((b) => ({ id: b.id, x: Math.floor(b.x + b.w / 2), y: Math.floor(b.y + b.h / 2) })));
  }

  /** Nearest of the given buildings to (x,y), choosing randomly among the two closest. */
  private nearest(list: WorldBuilding[], x: number, y: number, rng: { next(): number }): WorldBuilding | undefined {
    if (!list.length) return undefined;
    const sorted = [...list].sort((a, b) => dist2(a, x, y) - dist2(b, x, y) || a.id - b.id);
    return sorted[rng.next() < 0.7 || sorted.length === 1 ? 0 : 1];
  }

  /** Lifts a guest of this skill could use for a ski run right now. */
  skiLiftsFor(skill: number): LiftInfo[] {
    const d = maxDifficultyFor(skill);
    return this.lifts.filter((l) => l.skiDescent[d]);
  }

  /** Pick a lift for a ski run: snow preference by skill, short queues, near the guest. */
  pickSkiLift(skill: number, x: number, y: number, rng: { next(): number }, slot = -1): LiftInfo | undefined {
    const c = this.skiLiftsFor(skill);
    let best: LiftInfo | undefined, bs = -Infinity;
    for (const l of c) {
      const s = 0.8 * snowPreference(skill, l.topDepth) - 0.02 * this.waitTicks(l.lift.id, 0) - 0.004 * Math.hypot(l.bottomX - x, l.bottomY - y) - (slot >= 0 ? this.novelty(slot, l.lift.id) : 0) + 0.3 * rng.next();
      if (s > bs) { bs = s; best = l; }
    }
    return best;
  }

  private pickGoal(s: GuestStore, i: number, rng: { next(): number; chance(p: number): boolean }, hour: number, x: number, y: number, pref: number, mode: 'hike' | 'bike') {
    if (!this.useGoals) return null;
    return this.goals.pick({
      hour, leaveHour: this.leaveHour, pref, type: s.type[i]!, skill: s.skill[i]!, fatigue: s.fatigue[i]!, x, y, storm: this.stormy, mode,
      avoid: (t) => this.avoidTile(t), penalty: (t) => this.hikePenalty(t), lifts: this.lifts, wait: (id) => this.waitTicks(id, 0),
    }, rng);
  }

  /**
   * Evening mode (overnight guests and the après-ski share of day guests, after `eveningStart`): dinner / drinks / heated terrace / ice rink,
   * then back to the lodging near bedtime (overnight) or home (après guests). Hourly venue demand weights the scores.
   */
  private chooseEvening(s: GuestStore, i: number, rng: { next(): number }, hour: number): Intent {
    const x = s.x[i]!, y = s.y[i]!, type = s.type[i]!, overnight = !!s.overnight[i], port = this.port;
    const maxVisits = overnight ? EVENING.maxVisitsOvernight : EVENING.maxVisitsApres;
    const noise = (): number => rng.next() * 0.25;
    const cands: Intent[] = [];
    const consider = (it: Intent): void => { cands.push(it); };
    if (s.eve[i]! < maxVisits) {
      for (const b of [...this.food, ...this.bars]) {
        const price = port ? port.unitPrice(b.id) : 10;
        if (price > s.budget[i]! || this.avoidBuilding(b) > 0.5) continue;
        const d = venueDemand(venueKindOf(b.type), this.day, hour);
        if (d <= 0.05) continue;
        const taste = port ? 0.6 * (port.appeal(b.id, type) - 0.5) : 0;
        consider({ kind: 'eat', building: b, score: 0.7 + 1.1 * d + taste + eveningTypeBias(type) + (s.hunger[i]! > 0.35 ? 0.5 * s.hunger[i]! : 0) - 0.02 * Math.sqrt(dist2(b, x, y)) - 0.3 * s.eve[i]! + noise() });
      }
      if (port) for (const b of this.activity) {
        if (b.type !== 'iceRink' || !port.canUse(b.id, i) || port.unitPrice(b.id) > s.budget[i]!) continue;
        consider({ kind: 'activity', building: b, score: 0.6 + 0.8 * port.appeal(b.id, type) + eveningTypeBias(type) - 0.02 * Math.sqrt(dist2(b, x, y)) - 0.3 * s.eve[i]! + noise() });
      }
    }
    if (overnight) {
      const restList = port ? this.rest.filter((b) => port.canUse(b.id, i)) : this.rest;
      if (restList.length && hour >= sleepHour(this.day) - 0.75) consider({ kind: 'rest', building: this.nearest(restList, x, y, rng)!, score: 3 });
      consider({ kind: 'rest', score: 0.5 }); // nothing to do: linger (idle) near the venues
    } else consider({ kind: 'home', score: 0.2 + (hour >= apresEnd(s.id[i]!, this.day) ? 5 : 0) });
    return cands.reduce((a, c) => (c.score > a.score ? c : a));
  }

  choose(s: GuestStore, i: number, rng: { next(): number; chance(p: number): boolean; pick<T>(a: readonly T[]): T }, hour: number): Intent {
    const skill = Math.min(s.skill[i]!, this.skillCap(i)), pref = prefFor(s.id[i]!, s.type[i]!), hunger = s.hunger[i]!, fatigue = s.fatigue[i]!;
    const x = s.x[i]!, y = s.y[i]!;
    s.pref[i] = pref;
    const out: Intent[] = [];
    const noise = (): number => rng.next() * 0.25;
    if (hour >= this.eveningStart && (s.overnight[i] || isApres(s.id[i]!, s.type[i]!, this.day))) return this.chooseEvening(s, i, rng, hour);

    if (this.food.length) {
      const lunch = hour >= 11.5 && hour <= 13.5 && hunger > 0.2;
      const group = s.group[i]!;
      const b = lunch && group ? [...this.food].sort((a, c) => a.id - c.id)[group % this.food.length]! : this.nearest(this.food, x, y, rng)!;
      const taste = this.port ? 0.5 * (this.port.appeal(b.id, s.type[i]!) - 0.5) : 0;
      const dem = EVENING.demandWeight * Math.max(0, venueDemand(venueKindOf(b.type), this.day, hour) - 1); // peaks (lunch, dinner) pull; quiet hours are neutral
      const outdoorsy = (pref === Pref.Hike || pref === Pref.Bike) && this.hikeTiles.length + this.mtbTiles.length > 0;
      out.push({ kind: 'eat', building: b, score: (hunger > 0.4 ? 2 * hunger : 0.1) + (lunch ? 1.5 : 0) + (outdoorsy && hunger > NEEDS.hungryExcursion ? 1.5 : 0) + taste + dem + noise() });
    }
    const port = this.port;
    const restList = port ? this.rest.filter((b) => port.canUse(b.id, i)) : this.rest;
    if (restList.length && fatigue > 0.5) out.push({ kind: 'rest', building: this.nearest(restList, x, y, rng)!, score: 1.8 * fatigue + noise() });

    // gear: guests without their own skis/bike visit a rental first; without any open rental they only do gear-free things
    const rental = port ? this.nearest(this.shop.filter((b) => b.type === 'rental'), x, y, rng) : undefined;
    const needSki = !!port && port.needsGear(s.id[i]!, 'ski');
    const needBike = !!port && port.needsGear(s.id[i]!, 'bike');
    const skiLifts = needSki ? [] : this.skiLiftsFor(skill);
    if (rental && s.budget[i]! > 30 && ((needSki && pref === Pref.Ski && this.skiLiftsFor(skill).length) || (needBike && pref === Pref.Bike && this.mtbTiles.length))) {
      out.push({ kind: 'shop', building: rental, score: 2.6 + noise() });
    }
    if (skiLifts.length) {
      const lift = this.pickSkiLift(skill, x, y, rng, i)!;
      out.push({
        kind: 'ski', lift, score: (pref === Pref.Ski ? 1.1 : 0.3) - 0.7 * fatigue + 0.25 * snowPreference(skill, lift.topDepth) + 0.2 * this.pisteQualityScore(skill) + noise(),
        offPiste: (skill >= 3 || (skill >= 2 && coreOf(s.type[i]!) === GuestType.Adventure)) && lift.topDepth > 0.9 && rng.chance(0.25 * this.offPisteScale()),
      });
    }
    if (this.hikeTiles.length && this.port?.bedsFree && this.useGoals && s.budget[i]! > 60 && hour < this.leaveHour - 3.2 && (coreOf(s.type[i]!) === GuestType.Solo || coreOf(s.type[i]!) === GuestType.Couple || coreOf(s.type[i]!) === GuestType.Adventure)
      && (Math.imul(s.id[i]! + 17, 2246822519) >>> 0) % 100 < this.trekShare && this.canTrek(s.id[i]!)) {
      let hut: WorldBuilding | undefined, best = -Infinity;
      for (const b of this.huts) {
        if (b.type !== 'mountainHut' || (this.port.bedsFree(b.id) ?? 0) <= 0) continue;
        const t = this.goals.hutTiles.get(b.id);
        if (t === undefined || this.avoidTile(t) > 0.3) continue;
        const sc = this.goals.rel(this.nav()!, t) + rng.next() * 0.3;
        if (sc > best) { best = sc; hut = b; }
      }
      if (hut) out.push({ kind: 'hike', tile: this.goals.hutTiles.get(hut.id)!, trek: hut.id, score: 2.5 });
    }
    if (this.hikeTiles.length) {
      let ht = this.hikeTiles[Math.floor(rng.next() * this.hikeTiles.length)]!;
      const alt = this.hikeTiles[Math.floor(rng.next() * this.hikeTiles.length)]!;
      if (this.avoidTile(alt) < this.avoidTile(ht)) ht = alt; // guests who know about a bear pick the safer trail end
      const gp = this.pickGoal(s, i, rng, hour, x, y, pref, 'hike');
      if (gp) { ht = gp.tile; }
      if (!this.useGoals || gp) out.push({ kind: 'hike', tile: ht, via: gp?.via, oneWay: gp?.oneWay, score: this.hikePenalty(ht) * -1 - 1.1 * this.avoidTile(ht) + (pref === Pref.Hike ? (this.useGoals ? 2.0 : 1.2) : skiLifts.length ? 0.08 : 0.6) - 0.6 * fatigue + noise() });
    }
    if (this.mtbTiles.length && !needBike) {
      let bt = this.mtbTiles[Math.floor(rng.next() * this.mtbTiles.length)]!;
      const balt = this.mtbTiles[Math.floor(rng.next() * this.mtbTiles.length)]!;
      if (this.avoidTile(balt) < this.avoidTile(bt)) bt = balt;
      const gb = this.pickGoal(s, i, rng, hour, x, y, pref, 'bike');
      if (gb) bt = gb.tile;
      if (!this.useGoals || gb) out.push({ kind: 'bike', tile: bt, via: gb?.via, oneWay: gb?.oneWay, score: -1.1 * this.avoidTile(bt) + (pref === Pref.Bike ? 1.1 : 0.05) - 0.6 * fatigue + noise() });
    }
    if (this.shop.length && s.budget[i]! > 40) out.push({ kind: 'shop', building: this.nearest(this.shop, x, y, rng)!, score: 0.2 + noise() });
    if (port) {
      const sens = PRICE_SENSITIVITY[s.type[i]!] ?? 1;
      for (const b of this.activity) {
        if (!port.canUse(b.id, i)) continue;
        const price = port.unitPrice(b.id);
        if (price > s.budget[i]!) continue;
        out.push({ kind: 'activity', building: b, score: -0.8 * this.avoidBuilding(b) + 0.1 + 0.9 * port.appeal(b.id, s.type[i]!) - sens * price / (s.budget[i]! + 20) - 0.04 * port.queueLength(b.id) - 0.3 * fatigue + (skiLifts.length ? 0 : 0.35) + noise() });
      }
      if (this.other.length) out.push({ kind: 'activity', building: rng.pick(this.other), score: 0.25 + (skiLifts.length ? 0 : 0.35) + noise() });
    } else {
      const wander = [...this.activity, ...this.other];
      if (wander.length) out.push({ kind: 'activity', building: rng.pick(wander), score: 0.25 + (skiLifts.length ? 0 : 0.35) + noise() });
    }
    // lessons: stub until Task 22 (ski school) - no candidate is generated.
    out.push({ kind: 'home', score: 0.03 + noise() * 0.1 });
    let best = out[0]!;
    for (const c of out) if (c.score > best.score) best = c;
    return best;
  }
}
