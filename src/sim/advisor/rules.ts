/**
 * Advisor rules (M5.1 Task 4). Each rule reads the live `Sim` (read-only) and returns one `Advice` or null. Thresholds come in pairs
 * (enter / keep): when the advice is already `shown` the looser `keep` threshold applies, so values hovering around a limit do not flicker.
 * A rule that proposes a building site goes through `RuleCtx.site`, which uses the real placement rules (`validatePlacement`, see
 * docs/placement-rules.md); when no valid site exists the advice only names the building type. Nothing is ever built automatically.
 */
import type { Sim } from '../../game/createSim';
import type { PlacedBuilding } from '../Buildings';
import type { SeasonId } from '../../core/events';
import { BUILDINGS } from '../../config/buildings';
import { Layer } from '../../world/Networks';
import { isAccessReason } from '../PlacementRules';
import { liftOpenForBusiness } from '../ops/LiftOps';
import { GuestType } from '../guests/Guest';
import { seasonProgress } from '../Clock';
import { Q } from '../ops/PisteQuality';
import { anchors, findAlongPiste, findSite, type Site } from '../../tutorial/suggest';
import { POSITIVE_HINTS } from '../Rating';
import type { PanelRef } from '../goals/Goals';
import { TEXT, FRIENDLY } from './strings';

export interface Pt { x: number; y: number }
export type Severity = 'info' | 'warn' | 'urgent';
export interface AdviceTarget extends Pt { kind?: 'lift' | 'building' | 'piste' | 'goal' | 'animal'; id?: number }
export interface AdviceAction { type: 'build'; building: string; site?: { x: number; y: number; rot: number } }
export interface Advice {
  id: string; severity: Severity; title: string; why: string;
  /** A short friendly line (positive notes only). */
  friendly?: string;
  target?: AdviceTarget; action?: AdviceAction;
  /** Where 'Show me' goes when the advice is not about a map spot (a drawer / panel to open and an item to highlight). */
  panel?: PanelRef;
}

export interface PisteFacts { tiles: number; icy: number; noGroom: Pt[]; noAid: Pt[] }

export interface RuleCtx {
  sim: Sim;
  /** True when this advice is currently live (use the looser `keep` thresholds). */
  shown: boolean;
  season: SeasonId;
  /** Lazily computed (daily rules only: scans the grid). */
  pistes(): PisteFacts;
  /** Cached, validated building site; null when nothing valid exists. */
  site(key: string, type: string, find: () => Site | null): Site | null;
}

export interface Rule { id: string; /** Re-evaluated every in-game hour (cheap) instead of daily. */ cheap?: boolean; /** Dropped at once when it stops firing (state-based 'missing building' rules: no hysteresis). */ instant?: boolean; /** Player impact weight 1..3 (ranking). */ impact: 1 | 2 | 3; eval(c: RuleCtx): Advice | null }

const rule = (id: string, impact: 1 | 2 | 3, ev: Rule['eval'], cheap = false, instant = true): Rule => ({ id, impact, eval: ev, cheap, instant });
const has = (sim: Sim, ...types: string[]): boolean => sim.buildings.all().some((b) => b.active && types.includes(b.type));
const pct = (n: number): number => Math.round(n * 100);
const liftTarget = (l: { id: number; bottom: Pt }): AdviceTarget => ({ x: l.bottom.x, y: l.bottom.y, kind: 'lift', id: l.id });
/** Site near `anchor` for a building type (road-fed buildings must have a routable road). */
const near = (c: RuleCtx, key: string, type: string, anchor: Pt, rmax = 16): Site | null =>
  c.site(key, type, () => findSite(c.sim, type, anchor, { rmax, avoidPiste: BUILDINGS[type]?.pisteRule === 'forbid', route: BUILDINGS[type]?.access === 'road' ? 'road' : undefined }));

/** First inactive building of one of `types` (placed, but not working). Advice is about the STATE of the resort, never about a suggested tile. */
const idleOf = (sim: Sim, ...types: string[]): PlacedBuilding | undefined => sim.buildings.all().filter((b) => !b.active && types.includes(b.type)).sort((a, z) => a.id - z.id)[0];
/** Nearest road tile (else the road entry) to a point, for 'draw a road from here' advice. */
const nearestRoad = (sim: Sim, from: Pt): Pt | null => {
  const n = sim.size, k = sim.networks.kind;
  let best: Pt | null = null, bd = Infinity;
  for (let i = 0; i < n * n; i++) {
    if (k[i] !== 2) continue;
    const x = i % n, y = (i / n) | 0, d = Math.hypot(x - from.x, y - from.y);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  const e = sim.networks.roadEntry;
  if (e && (!best || Math.hypot(e.x - from.x, e.y - from.y) < bd)) best = { x: e.x, y: e.y };
  return best;
};
/** The building exists but is not working: say what is wrong, point at the real building. Null when it works or is missing. */
const notWorking = (c: RuleCtx, id: string, severity: Severity, type: string, ...alsoTypes: string[]): Advice | null => {
  const b = idleOf(c.sim, type, ...alsoTypes);
  if (!b) return null;
  const at = { x: b.x + b.w / 2 - 0.5, y: b.y + b.h / 2 - 0.5 };
  const reason = b.reason ?? 'It is missing a requirement.';
  // Only a missing connection gets 'draw a ...' advice, and the kind of link comes from the building's own access rule (reason text).
  const needsLink = isAccessReason(reason) && /road|footpath/i.test(reason);
  const kind = /footpath/i.test(reason) ? 'footpath' as const : 'road' as const;
  const end = needsLink ? nearestRoad(c.sim, at) : null;
  const link = end ? { kind, near: c.sim.names.describeLocation(end.x, end.y).near } : null;
  return { id, severity, ...TEXT.notWorking(c.sim.names.buildingName(b.id), reason, link), target: { ...at, kind: 'building', id: b.id } };
};
const build = (type: string, s: Site | null): AdviceAction => ({ type: 'build', building: type, ...(s ? { site: { x: s.x, y: s.y, rot: s.rot } } : {}) });
const siteTarget = (s: Site | null, fallback?: Pt): AdviceTarget | undefined => (s ? { x: s.x + s.rect.w / 2 - 0.5, y: s.y + s.rect.h / 2 - 0.5 } : fallback);
const nearest = (pts: Pt[], to: Pt): Pt => pts.reduce((a, p) => (Math.hypot(p.x - to.x, p.y - to.y) < Math.hypot(a.x - to.x, a.y - to.y) ? p : a), pts[0]!);
const centroid = (pts: Pt[]): Pt => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const familyCount = (sim: Sim): number => { const st = sim.guestSim.store; let n = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === GuestType.Family) n++; return n; };
/** Daily upkeep estimate (dollars): buildings' upkeep x difficulty plus a flat figure per lift. */
export const estimatedUpkeep = (sim: Sim): number => sim.buildings.all().reduce((a, b) => a + (BUILDINGS[b.type]?.upkeep ?? 0), 0) * sim.difficulty.upkeep + sim.lifts.all().length * 120;

/** Does another rule fire right now? (de-duplication: one root cause, one piece of advice). */
const firing = (c: RuleCtx, id: string): boolean => RULES.find((r) => r.id === id)?.eval(c) != null;

export const RULES: readonly Rule[] = [
  // ---- queues ----
  rule('queue.long', 3, (c) => {
    const q = c.sim.guestSim.queues;
    let worst: { id: number; w: number; bottom: Pt } | null = null;
    for (const l of c.sim.lifts.all()) {
      if (!l.open) continue; // a closed lift (night, inspection, conditions, breakdown) is not a queue problem
      const w = q.waitTicks(l.id, 0);
      if (w > (c.shown ? 12 : 20) && (!worst || w > worst.w)) worst = { id: l.id, w, bottom: l.bottom };
    }
    if (!worst) return null;
    const mins = Math.max(1, Math.round(worst.w * 6 / 60));
    return { id: 'queue.long', severity: worst.w > 30 ? 'urgent' : 'warn', ...TEXT.queue(c.sim.names.liftName(worst.id), mins), target: liftTarget(worst) };
  }, true, true),
  rule('lift.idle', 1, (c) => {
    const open = c.sim.lifts.all().filter((l) => l.open);
    if (open.length < 2 || c.sim.guestSim.store.count < 20) return null;
    // 'barely used' only makes sense while other lifts ARE used (at night everything is quiet)
    if (!open.some((l) => (l.riders?.perHour ?? 0) >= 8)) return null;
    const q = c.sim.guestSim.queues;
    const idle = open.find((l) => (l.ops?.ageDays ?? 0) >= 3 && (l.riders?.perHour ?? 0) < (c.shown ? 8 : 4) && q.waitTicks(l.id, 0) === 0);
    return idle ? { id: 'lift.idle', severity: 'info', ...TEXT.idleLift(c.sim.names.liftName(idle.id)), target: liftTarget(idle) } : null;
  }),
  // ---- piste quality ----
  rule('grooming.none', 2, (c) => {
    const p = c.pistes();
    if (p.tiles < 30 || has(c.sim, 'groomerGarage', 'snowcatOutpost')) return null;
    const w = notWorking(c, 'grooming.none', 'warn', 'groomerGarage', 'snowcatOutpost');
    if (w) return w;
    const s = near(c, 'grooming.none', 'groomerGarage', anchors(c.sim).lodge);
    return { id: 'grooming.none', severity: 'warn', ...TEXT.groomingNone(), action: build('groomerGarage', s), target: siteTarget(s) };
  }, false, true),
  rule('grooming.gap', 2, (c) => {
    const p = c.pistes();
    if (p.tiles < 30 || !has(c.sim, 'groomerGarage', 'snowcatOutpost')) return null;
    const share = p.noGroom.length / p.tiles;
    if (share < (c.shown ? 0.2 : 0.3)) return null;
    const mid = nearest(p.noGroom, centroid(p.noGroom));
    const s = c.site('grooming.gap', 'snowcatOutpost', () => findSite(c.sim, 'snowcatOutpost', mid, { rmax: 12, avoidPiste: true }));
    return { id: 'grooming.gap', severity: 'warn', ...TEXT.groomingGap(pct(share)), action: build('snowcatOutpost', s), target: { x: mid.x, y: mid.y } };
  }),
  rule('piste.icy', 2, (c) => {
    const p = c.pistes();
    if (p.tiles < 30 || !has(c.sim, 'groomerGarage', 'snowcatOutpost')) return null; // no grooming at all: grooming.none is the root cause
    const share = p.icy / p.tiles;
    if (share < (c.shown ? 0.12 : 0.2)) return null;
    return { id: 'piste.icy', severity: 'warn', ...TEXT.icy(pct(share)), panel: { drawer: 'ops' } };
  }),
  // ---- safety ----
  rule('patrol.none', 3, (c) => {
    if (c.sim.guestSim.store.count < 10 || !c.sim.lifts.all().some(liftOpenForBusiness) || has(c.sim, 'patrolHub')) return null;
    const w = notWorking(c, 'patrol.none', 'urgent', 'patrolHub');
    if (w) return w;
    const s = c.site('patrol.none', 'patrolHub', () => findAlongPiste(c.sim, 'patrolHub', 8, undefined, 'road') ?? findSite(c.sim, 'patrolHub', anchors(c.sim).lodge, { rmax: 16, route: 'road' }));
    return { id: 'patrol.none', severity: 'urgent', ...TEXT.patrolNone(), action: build('patrolHub', s), target: siteTarget(s) };
  }, false, true),
  rule('aid.gap', 2, (c) => {
    const p = c.pistes();
    if (p.tiles < 30 || c.sim.guestSim.store.count < 10 || !has(c.sim, 'patrolHub', 'firstAid')) return null;
    const share = p.noAid.length / p.tiles;
    if (share < (c.shown ? 0.3 : 0.4)) return null;
    const mid = nearest(p.noAid, centroid(p.noAid));
    const s = c.site('aid.gap', 'firstAid', () => findSite(c.sim, 'firstAid', mid, { rmax: 10 }));
    return { id: 'aid.gap', severity: 'warn', ...TEXT.aidGap(pct(share)), action: build('firstAid', s), target: { x: mid.x, y: mid.y } };
  }),
  rule('bear.threat', 2, (c) => {
    const w = c.sim.ops.safety?.wildlife;
    if (!w || c.season === 'winter' || c.sim.guestSim.store.count < 5 || has(c.sim, 'rangerStation')) return null;
    const bear = w.animals.find((a) => a.kind === 'bear' && !a.asleep);
    if (!bear) return null;
    const nw = notWorking(c, 'bear.threat', 'warn', 'rangerStation');
    if (nw) return nw;
    const s = near(c, 'bear.threat', 'rangerStation', anchors(c.sim).lodge, 20);
    return { id: 'bear.threat', severity: 'warn', ...TEXT.bear(), action: build('rangerStation', s), target: { x: Math.round(bear.x), y: Math.round(bear.y), kind: 'animal' } };
  }),
  rule('storm.signs', 1, (c) => (c.sim.weather.current.kind === 'storm' && c.sim.guestSim.store.count >= 10 && !has(c.sim, 'warningSign') ? (() => {
    const s = near(c, 'storm.signs', 'warningSign', anchors(c.sim).lodge);
    return { id: 'storm.signs', severity: 'info', ...TEXT.storm(), action: build('warningSign', s), target: siteTarget(s) } as Advice;
  })() : null), true, true),
  // ---- services / arrival ----
  rule('school.none', 2, (c) => {
    if (has(c.sim, 'skiSchoolHQ')) return null;
    const n = familyCount(c.sim);
    if (n < (c.shown ? 4 : 6)) return null;
    const w = notWorking(c, 'school.none', 'info', 'skiSchoolHQ');
    if (w) return w;
    const s = near(c, 'school.none', 'skiSchoolHQ', anchors(c.sim).lodge);
    return { id: 'school.none', severity: 'info', ...TEXT.school(n), action: build('skiSchoolHQ', s), target: siteTarget(s) };
  }, false, true),
  rule('arrival.parking', 2, (c) => {
    if (!c.sim.buildings.all().some((b) => b.type === 'baseLodge') || has(c.sim, 'parking', 'trainStation', 'shuttleDepot', 'altiport')) return null;
    // A parking lot the player placed ANYWHERE counts; one that is not connected gets specific advice about the real lot (never the suggested tile).
    const w = notWorking(c, 'arrival.parking', 'warn', 'parking', 'trainStation', 'shuttleDepot', 'altiport');
    if (w) return w;
    const s = near(c, 'arrival.parking', 'parking', anchors(c.sim).road);
    return { id: 'arrival.parking', severity: 'warn', ...TEXT.parking(), action: build('parking', s), target: siteTarget(s) };
  }, false, true),
  // ---- money ----
  rule('cash.debt', 3, (c) => (c.sim.finance.inDebt && c.sim.game.money < 0 ? { id: 'cash.debt', severity: 'urgent', ...TEXT.debt(`$${Math.abs(Math.round(c.sim.game.money)).toLocaleString('en-US')}`, c.sim.loans.supportOpen), panel: { drawer: 'finance' } } as Advice : null), true, true),
  rule('cash.runway', 2, (c) => {
    const money = c.sim.game.money, up = estimatedUpkeep(c.sim);
    if (money < 0 || up <= 0) return null; // (the finance status only flips at midnight: cash itself is the live truth)
    const days = money / up;
    if (days >= (c.shown ? 8 : 5)) return null;
    return { id: 'cash.runway', severity: 'warn', ...TEXT.runway(Math.max(0, Math.floor(days))), panel: { drawer: 'finance' } };
  }, true, true),
  rule('price.fair', 2, (c) => {
    if (c.sim.guestSim.store.count < 10) return null;
    const r = c.sim.pricing.ratioOf('dayPass');
    if (r > (c.shown ? 1.3 : 1.4)) return { id: 'price.fair', severity: 'warn', ...TEXT.priceHigh(pct(r - 1)), panel: { drawer: 'pricing' } };
    if (r < (c.shown ? 0.7 : 0.6)) return { id: 'price.fair', severity: 'info', ...TEXT.priceLow(pct(1 - r)), panel: { drawer: 'pricing' } };
    return null;
  }, true, true),
  rule('marketing.ready', 1, (c) => {
    const m = c.sim.marketing;
    if (m.records().length > 0 || m.running().length > 0 || c.sim.rating.stars < 2 || c.sim.game.money < 20000) return null;
    const def = m.list().find((d) => m.blocker(d.id) === null);
    return def ? { id: 'marketing.ready', severity: 'info', ...TEXT.marketing(def.name), panel: { drawer: 'marketing', item: def.id } } : null;
  }),
  // ---- season lookahead ----
  rule('season.winter', 2, (c) => {
    const sp = seasonProgress(c.sim.game.date);
    if (sp.next !== 'winter' || sp.daysLeft > 30 || c.pistes().tiles < 30) return null;
    // A cannon that exists but does not work is a 'building.inactive' matter, not a missing cannon.
    if (c.sim.buildings.all().some((b) => b.type === 'snowCannon')) return null;
    const reservoir = c.sim.buildings.all().some((b) => b.type === 'reservoir');
    // A cannon needs a reservoir in pipe range OR a lake nearby: when a valid cannon site exists the water is there already.
    const cannon = c.site('season.winter', 'snowCannon', () => findAlongPiste(c.sim, 'snowCannon', 3));
    if (cannon || reservoir) return { id: 'season.winter', severity: 'warn', ...TEXT.winterComing(sp.daysLeft, true), action: build('snowCannon', cannon), target: siteTarget(cannon) };
    const s = c.site('season.winter.reservoir', 'reservoir', () => findAlongPiste(c.sim, 'reservoir', 18) ?? findSite(c.sim, 'reservoir', anchors(c.sim).lodge, { rmax: 20 }));
    return { id: 'season.winter', severity: 'warn', ...TEXT.winterComing(sp.daysLeft, false), action: build('reservoir', s), target: siteTarget(s) };
  }),
  rule('snow.gaps', 2, (c) => {
    const sp = seasonProgress(c.sim.game.date);
    if (sp.season !== 'winter' && !(sp.next === 'winter' && sp.daysLeft <= 30)) return null;
    const res = c.sim.buildings.all().filter((b) => b.active && b.type === 'reservoir');
    if (!res.length) return null; // season.winter asks for the reservoir first
    const pipe = BUILDINGS.reservoir?.serviceRadius ?? 24, N = c.sim.size, cov = c.sim.coverage.map('snowmaking'), q = c.sim.ops.quality;
    const gaps: Pt[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (cov[i] || !q.isPiste(i)) continue;
      if (res.some((r) => Math.hypot(r.x + r.w / 2 - x - 0.5, r.y + r.h / 2 - y - 0.5) <= pipe)) gaps.push({ x, y });
    }
    if (gaps.length < (c.shown ? 12 : 24)) return null;
    const at = nearest(gaps, centroid(gaps));
    const site = c.site('snow.gaps', 'snowCannon', () => findSite(c.sim, 'snowCannon', at, { rmax: 5 }));
    return { id: 'snow.gaps', severity: 'info', ...TEXT.snowGaps(gaps.length), action: build('snowCannon', site), target: siteTarget(site, at) };
  }),
  rule('season.summer', 2, (c) => {
    const sp = seasonProgress(c.sim.game.date);
    if (sp.next !== 'summer' || sp.daysLeft > 30) return null;
    const a = c.sim.networks.layers;
    for (let i = 0; i < a.length; i++) if (a[i]! & (Layer.Hike | Layer.Mtb)) return null;
    return { id: 'season.summer', severity: 'info', ...TEXT.summerComing(sp.daysLeft), panel: { drawer: 'pistes', item: 'mtb' } };
  }),
  rule('cash.summerBuffer', 2, (c) => {
    const sp = seasonProgress(c.sim.game.date);
    if (sp.season !== 'spring' || sp.daysLeft > 20) return null;
    const up = estimatedUpkeep(c.sim), money = c.sim.game.money;
    if (up <= 0 || money < 0) return null; // already in debt: cash.debt speaks
    const need = Math.ceil((30 * up) / 1000) * 1000;
    if (money >= need * (c.shown ? 0.9 : 1)) return null;
    const fmt = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
    return { id: 'cash.summerBuffer', severity: 'info', ...TEXT.summerBuffer(sp.daysLeft, fmt(need), fmt(money), Math.floor(money / up)), panel: { drawer: 'finance' } };
  }),
  // ---- structure / maintenance ----
  rule('piste.disconnected', 2, (c) => {
    const comp = c.sim.networks.pisteComponents().filter((p) => p.disconnected && p.count >= 4).sort((a, b) => b.count - a.count || a.tiles[0]! - b.tiles[0]!)[0];
    if (!comp) return null;
    const size = c.sim.size, x = comp.tiles[0]! % size, y = (comp.tiles[0]! / size) | 0;
    return { id: 'piste.disconnected', severity: 'warn', ...TEXT.pisteDisconnected(c.sim.pisteReportAt(x, y)?.name ?? 'A piste'), target: { x, y, kind: 'piste' } };
  }),
  rule('building.inactive', 2, (c) => {
    /** Missing-building rule that already names a building of this type (it points at the real building). */
    const OWNER: Record<string, string> = { groomerGarage: 'grooming.none', snowcatOutpost: 'grooming.none', patrolHub: 'patrol.none', skiSchoolHQ: 'school.none', parking: 'arrival.parking', trainStation: 'arrival.parking', shuttleDepot: 'arrival.parking', altiport: 'arrival.parking', rangerStation: 'bear.threat' };
    const cache = new Map<string, boolean>();
    const owned = (type: string): boolean => { const id = OWNER[type]; if (!id) return false; if (!cache.has(id)) cache.set(id, firing(c, id)); return cache.get(id)!; };
    // A building that waits for a missing prerequisite (first aid without a hub) is the same root cause as the prerequisite's own advice.
    const covered = (x: { type: string }): boolean => owned(x.type) || (BUILDINGS[x.type]?.requires ?? []).some((r) => !has(c.sim, r) && owned(r));
    const b = c.sim.buildings.all().filter((x) => !x.active && !covered(x)).sort((a, z) => a.id - z.id)[0];
    if (!b) return null;
    return { id: 'building.inactive', severity: 'warn', ...TEXT.buildingInactive(c.sim.names.buildingName(b.id), b.reason ?? 'It is missing a requirement. Select it to see which.'), target: { x: b.x + b.w / 2 - 0.5, y: b.y + b.h / 2 - 0.5, kind: 'building', id: b.id } };
  }),
  rule('lift.worn', 2, (c) => {
    const l = c.sim.lifts.all().filter((x) => (x.ops?.condition ?? 100) < (c.shown ? 55 : 45)).sort((a, b) => (a.ops!.condition - b.ops!.condition) || a.id - b.id)[0];
    if (!l) return null;
    const workshop = c.sim.buildings.all().some((b) => b.type === 'liftWorkshop'); // an idle one is building.inactive's business
    const s = workshop ? null : near(c, 'lift.worn', 'liftWorkshop', anchors(c.sim).lodge);
    return { id: 'lift.worn', severity: 'warn', ...TEXT.liftWorn(c.sim.names.liftName(l.id), Math.round(l.ops!.condition), workshop), target: liftTarget(l), ...(workshop ? {} : { action: build('liftWorkshop', s) }) };
  }),
  // ---- rating + goals ----
  rule('rating.lowest', 2, (c) => {
    const ROOT: Record<string, string[]> = { safety: ['patrol.none', 'bear.threat'], value: ['price.fair'] };
    const comps = c.sim.rating.breakdown().components.filter((x) => x.id !== 'queues' && x.id !== 'pisteQuality' && x.score < (c.shown ? 62 : 55) && x.hint && !POSITIVE_HINTS.has(x.hint)
      && !(ROOT[x.id] ?? []).some((r) => firing(c, r)));
    if (!comps.length) return null;
    const w = comps.sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight || (a.id < b.id ? -1 : 1))[0]!;
    return { id: 'rating.lowest', severity: 'info', ...TEXT.rating(w.label, w.hint, w.score), panel: { drawer: 'rating' } };
  }),
  rule('goal.next', 1, (c) => {
    if (c.sim.goals.paused) return null;
    const g = c.sim.goals.view().active[0];
    if (!g) return null;
    // The goal asks for the very building another advice already names: one root cause, one piece of advice.
    const SAME: Record<string, string> = { patrol: 'patrol.none', skiSchool: 'school.none', groomed: 'grooming.none', ranger: 'bear.threat' };
    if (SAME[g.id] && firing(c, SAME[g.id]!)) return null;
    const p = c.sim.goals.focusOf(g.id), gp = c.sim.goals.panelOf(g.id);
    const close = g.progress >= 0.75;
    return { id: 'goal.next', severity: 'info', ...(close ? TEXT.goalClose(g.title) : TEXT.goal(g.title, g.todo)), ...(close ? { friendly: FRIENDLY[2]! } : {}), ...(p ? { target: { x: p.x, y: p.y, kind: 'goal' as const } } : {}), ...(!p && gp ? { panel: gp } : {}) };
  }),
];

/** Tiles of open pistes, grouped by what they lack (computed once per evaluation). */
export function computePisteFacts(sim: Sim): PisteFacts {
  const out: PisteFacts = { tiles: 0, icy: 0, noGroom: [], noAid: [] };
  const n = sim.size, q = sim.ops.quality, cov = sim.coverage;
  for (let i = 0; i < n * n; i++) {
    if (!q.isPiste(i)) continue;
    out.tiles++;
    const x = i % n, y = (i / n) | 0;
    if (q.at(i) === Q.Icy) out.icy++;
    if (!cov.isCovered('grooming', x, y)) out.noGroom.push({ x, y });
    if (!cov.isCovered('patrol', x, y) && !cov.isCovered('firstAid', x, y)) out.noAid.push({ x, y });
  }
  return out;
}
