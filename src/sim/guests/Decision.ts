import { BUILDINGS } from '../../config/buildings';
import { LIFTS } from '../../config/lifts';
import { Layer } from '../../world/Networks';
import type { LiftData } from '../Lift';
import { extraDef } from '../../config/guestTypes';
import { coreOf, GuestType, type GuestStore } from './Guest';
import type { WorldBuilding } from './GuestWorld';
import { NavMode, type NavGraph } from './NavGraph';
import type { DecisionPort } from './AttractionPort';
import { maxDifficultyFor } from './Skill';
import { EVENING } from '../../config/balance';
import { apresEnd, eveningTypeBias, isApres, sleepHour, venueDemand, venueKindOf } from '../Evening';
import { TrailGoals } from './TrailGoals';
import { VIEWPOINT } from '../../config/viewpoints';
import type { ViewpointSite } from '../attractions/Viewpoint';
import { NEEDS } from './Needs';
import { Touring } from './Tourer';

/** Current activity of a guest (stored in GuestStore.act). */
export const Act = { None: 0, ToBuilding: 1, ToLift: 2, Queue: 3, Ride: 4, SkiDown: 5, ToTrail: 6, Excursion: 7 } as const;
/** Activity preference (GuestStore.pref). */
export const Pref = { Ski: 0, Hike: 1, Bike: 2 } as const;

export type IntentKind = 'eat' | 'rest' | 'ski' | 'lesson' | 'activity' | 'shop' | 'home' | 'hike' | 'bike' | 'relief';

export const FOOD = new Set(['baseLodge', 'lodge', 'cafe', 'mountainHut', 'heatedTerrace', 'smallHotel']);
/** Quick-service kiosks (Phase 6 Task 28, docs/coffee-stand.md): a cup and a bite on the way, never the real meal. Not in FOOD: they only compete as a nearby snack (see `SNACK`). */
export const SNACKS = new Set(['coffeeStand']);
/** Snack stop tuning: guests with hunger in [minHunger, maxHunger] weigh the nearest open kiosk with score `base + perHunger x hunger - distPenalty x tiles + nearBonus x (1 - tiles / radius)`: the pull FALLS with hunger (a snack-sized appetite stops for a coffee; a really hungry guest wants the real meal, which scores 2 x hunger) and with the detour. */
export const SNACK = { minHunger: 0.3, maxHunger: 0.7, base: 1.75, perHunger: -1, radius: 7, nearBonus: 0.3, distPenalty: 0.15, /** Hunger a cup and a bite take off (the Coffee Stand spec's `hungerBy`). */ by: 0.3, /** Mid-run break: a skier within `passRadius` tiles of an open stand, hunger in [passMin, passMax] (or tired: fatigue >= tired), takes it on about 1 in `oneIn` passes (stateless hash of guest id and runs: no RNG, no stored cap; a cup takes 0.3 off the hunger, so a guest is back in the window only hours later = 1-2 stops a day). */ passRadius: 2, passMin: 0.3, passMax: 0.7, tired: 0.6, oneIn: 3, /** Dollars a cup and a bite cost when a hiker stops at a kiosk with no other food in reach. */ spend: 4 } as const;
/** Evening venues beyond the daytime FOOD list: the Après-Ski Bar (a drinks stop, not a meal). */
export const BAR = new Set(['apresBar']);
/** Every venue the evening model schedules (dinner, drinks, terrace). */
export const EVENING_VENUES: readonly string[] = [...FOOD, ...BAR];
export const REST = new Set(['baseLodge', 'lodge', 'chalet', 'apartment', 'smallHotel', 'luxuryHotel']);
export const SHOP = new Set(['shop', 'rental']);
/** Real attractions (activity goals); everything else visitable counts as generic wandering. */
export const ACTIVITY = new Set(['iceRink', 'stuntPark', 'adventurePark', 'beach', 'boatRental', 'playground', 'kidsGround', 'magicCarpet', 'quadBase', 'crag', 'tackleHut', 'raftingBase', 'canyoningBase']);
export const LESSON = new Set(['skiSchoolHQ']);
/** Comfort need (docs/comfort.md): buildings a guest walks to on purpose when the urge is high. */
export const RELIEF = new Set(['toilets']);
const VISIT_CATEGORIES = new Set(['core', 'services', 'lodging', 'recreation', 'kids', 'water']);

export interface LiftInfo {
  lift: LiftData;
  /** Carries skiers up AND a ski route from its top back to its base exists for max difficulty d (index d = 0..3). */
  skiDescent: [boolean, boolean, boolean, boolean];
  bikeDescent: boolean;
  topDepth: number;
  bottomX: number; bottomY: number;
  /** Shape of the cheapest ski route top -> bottom per max difficulty (Snowboarder, Task 33): flat share 0..1 (long low-gradient stretches / catwalks) and mean width 0..1. */
  flat?: [number, number, number, number];
  wide?: [number, number, number, number];
}

/** Flat detection (Task 33): consecutive piste tiles of a route whose drop is below `drop` (world units per tile); a stretch of at least `minRun` tiles is a flat / catwalk. */
export const FLATS = { drop: 0.04, minRun: 4 } as const;

/** Flat share and mean width of a ski route (node list of the nav graph). Pure; cached per nav epoch by the Decider. */
export function routeShape(nav: NavGraph, nodes: ArrayLike<number>): { flat: number; wide: number } {
  const n = nav.size;
  let flat = 0, run = 0, pistes = 0, wide = 0;
  const close = (): void => { if (run >= FLATS.minRun) flat += run; run = 0; };
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1]!, b = nodes[k]!;
    if (Math.abs((a % n) - (b % n)) > 1 || Math.abs(((a / n) | 0) - ((b / n) | 0)) > 1 || !nav.isPiste(b)) { close(); continue; }
    pistes++;
    const bx = b % n, by = (b / n) | 0;
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = bx + dx, y = by + dy;
      if (x >= 0 && y >= 0 && x < n && y < n && nav.isPiste(y * n + x)) nb++;
    }
    wide += nb / 8;
    if (nav.tileAltitude(a) - nav.tileAltitude(b) < FLATS.drop) run++; else close();
  }
  close();
  return pistes ? { flat: flat / pistes, wide: wide / pistes } : { flat: 0, wide: 0 };
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
  const own = type >= 6 ? extraDef(type)?.pref : undefined;
  const [hike, bike] = own ?? (ct === GuestType.Adventure ? [5, 15] : ct === GuestType.Family ? [30, 20] : [15, 15]);
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
  /** Open coffee stands / kiosks (SNACKS). */
  snacks: WorldBuilding[] = [];
  bars: WorldBuilding[] = [];
  huts: WorldBuilding[] = [];
  /** Buildings with `def.viewpoint` (Phase 6 Task 6): hiker goals with a view score. */
  viewSites: ViewpointSite[] = [];
  /** Extra viewpoint sites that are not buildings (suspension bridges, Phase 6 Task 46); ids are negative. Wired by createSim. */
  bridgeViews: (() => ViewpointSite[]) | null = null;
  rest: WorldBuilding[] = [];
  shop: WorldBuilding[] = [];
  activity: WorldBuilding[] = [];
  other: WorldBuilding[] = [];
  lessons: WorldBuilding[] = [];
  /** Open toilet blocks (comfort need). */
  toilets: WorldBuilding[] = [];
  /** Comfort need on: guests above `NEEDS.urgeSeek` look for a toilet. Set by GuestSim (createSim default ON). */
  comfort = false;
  lifts: LiftInfo[] = [];
  hikeTiles: number[] = [];
  mtbTiles: number[] = [];
  skiOpenTiles = 0;
  private descent = new Map<string, boolean>();
  private shapes = new Map<string, { flat: number; wide: number }>();
  /** Ski tourers (Task 34): the backcountry routes, attached by createSim; goal tiles of the SAFE routes (danger < TOURER_MAX_DANGER) are refreshed every `refresh`. */
  readonly touring = new Touring();
  tourTiles: number[] = [];
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

  /** Viewpoint whose trail goal tile is `goal` (null = none): the view score of the building behind it. */
  viewAt(goal: number): { id: number; score: number; dwellH: number } | null {
    const id = this.goals.viewTiles.get(goal);
    const v = id === undefined ? undefined : this.goals.viewpoints.all.find((x) => x.id === id);
    return v ? { id: v.id, score: v.score * (v.spec.weight ?? 1), dwellH: v.spec.dwellH ?? VIEWPOINT.dwellH } : null;
  }
  /** Extra stop (hours) at a viewpoint goal: dwellH scaled by the view (a poor view is a short look). */
  viewDwell(goal: number): number { const v = this.viewAt(goal); return v ? v.dwellH * Math.min(1, 0.4 + v.score) : 0; }

  /** Drop every cached verdict (save load). */
  reset(): void { this.goals.reset(); this.descent.clear(); this.descentEpoch = -1; this.scanEpoch = -1; this.lifts = []; this.hikeTiles = []; this.mtbTiles = []; this.skiOpenTiles = 0; }

  refresh(buildings: Iterable<WorldBuilding>): void {
    this.food = []; this.snacks = []; this.bars = []; this.huts = []; this.viewSites = []; this.rest = []; this.shop = []; this.activity = []; this.other = []; this.lessons = []; this.toilets = [];
    for (const b of buildings) {
      if (!b.active) continue;
      if (this.port && !this.port.accepts(b.id)) continue;
      if (LESSON.has(b.type)) this.lessons.push(b);
      if (RELIEF.has(b.type)) { this.toilets.push(b); continue; } // never a wandering target
      if (b.type === 'mountainHut') this.huts.push(b); // trek goals do not depend on serving hours
      const vp = BUILDINGS[b.type]?.viewpoint; if (vp) this.viewSites.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, spec: vp }); // viewpoint buildings (config-driven)
      const serving = this.port?.serving?.(b.id) ?? true; // venues are only candidates while serving (08:00 - 23:00)
      if (FOOD.has(b.type) && serving) this.food.push(b);
      if (SNACKS.has(b.type)) this.snacks.push(b);
      if (BAR.has(b.type) && serving) this.bars.push(b);
      if (REST.has(b.type)) this.rest.push(b);
      if (SHOP.has(b.type)) this.shop.push(b);
      if (ACTIVITY.has(b.type)) this.activity.push(b);
      if (VISIT_CATEGORIES.has(BUILDINGS[b.type]?.category ?? '') && !FOOD.has(b.type) && !SNACKS.has(b.type) && !BAR.has(b.type) && !REST.has(b.type) && !SHOP.has(b.type) && !ACTIVITY.has(b.type)) this.other.push(b);
    }
    const nav = this.nav();
    this.goals.queryBudget = 24;
    this.lifts = [];
    this.tourTiles = nav && this.touring.attached ? this.touring.goalTiles((t) => nav.tileAltitude(t)) : [];
    if (!nav) return;
    if (this.descentEpoch !== nav.epoch) { this.descent.clear(); this.shapes.clear(); this.descentEpoch = nav.epoch; }
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
        if (res) this.shapes.set(key, routeShape(nav, res.nodes));
        return v;
      };
      const skiCarry = am === 'ski' || am === 'mixed';
      const bikeCarry = (am === 'foot' || am === 'mixed') && LIFTS[l.kind].carriesBikes;
      const sd: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      if (skiCarry) for (let d = 0; d < 4; d++) sd[d] = query(NavMode.Ski0 + d);
      const info: LiftInfo = {
        lift: l, skiDescent: sd, bikeDescent: bikeCarry ? query(NavMode.Bike) : false,
        topDepth: w.snow[top] ?? 0, bottomX: l.bottom.x, bottomY: l.bottom.y,
      };
      if (skiCarry) {
        const fl: [number, number, number, number] = [0, 0, 0, 0], wd: [number, number, number, number] = [0, 0, 0, 0];
        for (let d = 0; d < 4; d++) { const sh = this.shapes.get(`${l.id}:${NavMode.Ski0 + d}`); if (sh) { fl[d] = sh.flat; wd[d] = sh.wide; } }
        info.flat = fl; info.wide = wd;
      }
      this.lifts.push(info);
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
    const bv = this.bridgeViews?.() ?? [];
    this.goals.build(nav, hike, mtb, this.huts.map((b) => ({ id: b.id, x: Math.floor(b.x + b.w / 2), y: Math.floor(b.y + b.h / 2) })), bv.length ? [...this.viewSites, ...bv] : this.viewSites);
  }

  /**
   * Ski tourer at a lift top (Task 34, "one lift then up"): the summit / hut tile of a SAFE backcountry route to skin up to from where the guest stands, or null (no safe route, too late in the day, no way).
   * Only the goal list of safe routes (danger < TOURER_MAX_DANGER, open) is ever offered, so a route that closed or went to danger 4+ since the last refresh is never picked.
   */
  tourFrom(s: GuestStore, i: number, rng: { next(): number; chance(p: number): boolean }, hour: number): { tile: number } | null {
    if (!this.tourTiles.length || hour >= this.leaveHour - 2.5) return null;
    const gt = this.pickGoal(s, i, rng, hour, s.x[i]!, s.y[i]!, Pref.Hike, 'hike', this.tourTiles);
    return gt ? { tile: gt.tile } : null;
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
  pickSkiLift(skill: number, x: number, y: number, rng: { next(): number }, slot = -1, flats?: { flatPick: number; widePick: number }): LiftInfo | undefined {
    const c = this.skiLiftsFor(skill);
    let best: LiftInfo | undefined, bs = -Infinity;
    const dd = maxDifficultyFor(skill);
    for (const l of c) {
      // Snowboarders (Task 33): flats and catwalks cost, a wide piste pays (0 for every other type, bit for bit)
      const shape = flats ? -flats.flatPick * (l.flat?.[dd] ?? 0) + flats.widePick * (l.wide?.[dd] ?? 0) : 0;
      const s = 0.8 * snowPreference(skill, l.topDepth) - 0.02 * this.waitTicks(l.lift.id, 0) - 0.004 * Math.hypot(l.bottomX - x, l.bottomY - y) - (slot >= 0 ? this.novelty(slot, l.lift.id) : 0) + shape + 0.3 * rng.next();
      if (s > bs) { bs = s; best = l; }
    }
    return best;
  }

  private pickGoal(s: GuestStore, i: number, rng: { next(): number; chance(p: number): boolean }, hour: number, x: number, y: number, pref: number, mode: 'hike' | 'bike', only?: readonly number[]) {
    if (!this.useGoals) return null;
    return this.goals.pick({
      hour, leaveHour: this.leaveHour, pref, type: s.type[i]!, skill: s.skill[i]!, fatigue: s.fatigue[i]!, x, y, storm: this.stormy, mode, only,
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

  /** Open stand within `r` tiles of a point (mid-run coffee break, docs/coffee-stand.md); nearest, ties by id. No RNG. */
  snackWithin(x: number, y: number, r: number): WorldBuilding | undefined {
    let best: WorldBuilding | undefined, bd = r * r;
    for (const b of this.snacks) { const d = dist2(b, x, y); if (d <= bd && (!best || d < bd || b.id < best.id)) { bd = d; best = b; } }
    return best;
  }

  /** Coffee stand: a hungry-ish guest near an open kiosk weighs a quick stop (no RNG draw: guests without a kiosk keep their stream). */
  private snackFor(s: GuestStore, i: number, hunger: number, x: number, y: number): Intent | null {
    if (!this.snacks.length || hunger < SNACK.minHunger || hunger > SNACK.maxHunger) return null;
    let best: WorldBuilding | undefined, bd = Infinity;
    for (const b of this.snacks) { const d = dist2(b, x, y); if (d < bd || (d === bd && b.id < best!.id)) { bd = d; best = b; } }
    if (!best || (this.port && this.port.unitPrice(best.id) > s.budget[i]!)) return null;
    const dist = Math.sqrt(bd);
    return { kind: 'eat', building: best, score: SNACK.base + SNACK.perHunger * hunger - SNACK.distPenalty * dist + SNACK.nearBonus * Math.max(0, 1 - dist / SNACK.radius) };
  }

  /** Comfort need: walk to the nearest open toilet once the urge passes the seek mark (no RNG draw, so guests that do not seek keep their stream). */
  private relief(s: GuestStore, i: number): Intent | null {
    if (!this.comfort || !this.toilets.length || s.urge[i]! < NEEDS.urgeSeek) return null;
    const x = s.x[i]!, y = s.y[i]!;
    let best: WorldBuilding | undefined, bd = Infinity;
    for (const b of this.toilets) { const d = dist2(b, x, y); if (d < bd || (d === bd && b.id < best!.id)) { bd = d; best = b; } }
    return { kind: 'relief', building: best!, score: 1.4 + 2.5 * (s.urge[i]! - NEEDS.urgeSeek) - 0.02 * Math.sqrt(bd) };
  }

  choose(s: GuestStore, i: number, rng: { next(): number; chance(p: number): boolean; pick<T>(a: readonly T[]): T }, hour: number): Intent {
    const skill = Math.min(s.skill[i]!, this.skillCap(i)), pref = prefFor(s.id[i]!, s.type[i]!), hunger = s.hunger[i]!, fatigue = s.fatigue[i]!;
    const x = s.x[i]!, y = s.y[i]!;
    s.pref[i] = pref;
    const out: Intent[] = [];
    const noise = (): number => rng.next() * 0.25;
    const rel = this.relief(s, i);
    if (hour >= this.eveningStart && (s.overnight[i] || isApres(s.id[i]!, s.type[i]!, this.day))) { const ev = this.chooseEvening(s, i, rng, hour); return rel && rel.score > ev.score ? rel : ev; }
    if (rel) out.push(rel);

    if (this.food.length) {
      const lunch = hour >= 11.5 && hour <= 13.5 && hunger > 0.2;
      const group = s.group[i]!;
      const xd = s.type[i]! >= 6 ? extraDef(s.type[i]!) : undefined; // seniors: the terrace / the café first (extra types only; the core draw order is untouched)
      const pool = xd?.foodPrefer ? this.food.filter((f) => xd.foodPrefer!.includes(f.type)) : this.food;
      const menu = pool.length ? pool : this.food;
      const b = lunch && group ? [...menu].sort((a, c) => a.id - c.id)[group % menu.length]! : this.nearest(menu, x, y, rng)!;
      const taste = this.port ? 0.5 * (this.port.appeal(b.id, s.type[i]!) - 0.5) : 0;
      const dem = EVENING.demandWeight * Math.max(0, venueDemand(venueKindOf(b.type), this.day, hour) - 1); // peaks (lunch, dinner) pull; quiet hours are neutral
      const outdoorsy = (pref === Pref.Hike || pref === Pref.Bike) && this.hikeTiles.length + this.mtbTiles.length > 0;
      out.push({ kind: 'eat', building: b, score: (hunger > 0.4 ? 2 * hunger : 0.1) + (lunch ? 1.5 : 0) + (outdoorsy && hunger > NEEDS.hungryExcursion ? 1.5 : 0) + taste + dem + (xd?.eatBonus ?? 0) + noise() });
    }
    const snack = this.snackFor(s, i, hunger, x, y);
    if (snack) out.push(snack);
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
      const lift = this.pickSkiLift(skill, x, y, rng, i, s.type[i]! >= 6 ? extraDef(s.type[i]!)?.flats : undefined)!;
      out.push({
        kind: 'ski', lift, score: (pref === Pref.Ski ? 1.1 : 0.3) - 0.7 * fatigue + 0.25 * snowPreference(skill, lift.topDepth) + 0.2 * this.pisteQualityScore(skill) + noise(),
        offPiste: (skill >= 3 || (skill >= 2 && coreOf(s.type[i]!) === GuestType.Adventure)) && lift.topDepth > 0.9 && rng.chance(0.25 * this.offPisteScale()),
      });
    }
    // Ski tourer (Task 34): skin up to the summit / hut of an open backcountry route below danger 4 (one lift first when it helps). The tile list holds SAFE routes only.
    if (this.tourTiles.length && s.type[i]! >= 6 && extraDef(s.type[i]!)?.tourer && hour < this.leaveHour - 2.5) {
      const gt = this.pickGoal(s, i, rng, hour, x, y, Pref.Hike, 'hike', this.tourTiles);
      if (gt) out.push({ kind: 'hike', tile: gt.tile, via: gt.via, oneWay: false, score: 2.6 - 0.8 * fatigue + noise() });
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
