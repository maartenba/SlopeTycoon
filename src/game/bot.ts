/**
 * Scripted "player policy" for the headless balance pass (Task 35, docs/balance.md). Sim-only: uses the same placement / pricing /
 * marketing / loan APIs the UI uses. It is deliberately a *reasonable but not clever* player:
 *  1. builds the starter chain (`buildStarterResort`, the same chain the tutorial teaches), paying for it from its own money
 *     (optionally after taking the Starter loan);
 *  2. once a month: repays loans when cash is comfortable, takes the Starter loan when cash is low, runs a marketing campaign that fits
 *     the season, and expands (lodging, restaurants, shop, rental, kids / winter / summer attractions) while keeping a cash reserve;
 *  3. in summer closes the winter lifts (schedule profile) so no energy is wasted;
 * and never touches prices unless `prices` is set (the exploit tests use that).
 */
import { BUILDINGS } from '../config/buildings';
import { LIFTS } from '../config/lifts';
import { placeBuilding } from '../sim/PlaceBuilding';
import { Layer, NetKind, interpolateStroke, sweepBrush, type NetKindId, type Rect } from '../world/Networks';
import { autoFlattenDefault } from '../sim/PlacementRules';
import { buildStarterResort, type StarterOptions, type StarterReport } from './starterResort';
import { monthIndex, seasonOf } from '../sim/Clock';
import { DAYS_PER_MONTH } from '../config/balance';
import type { Sim } from './createSim';
import { policyFor, type BotPolicy, type Wish } from './botPolicies';

export interface BotOptions {
  /** Take the Starter loan before building (tutorial-style opening). */
  starterLoan?: boolean;
  /** Build the starter chain (default true). */
  starter?: boolean;
  starterOpts?: StarterOptions;
  /** Cash kept in reserve before the bot expands (default 25 000). */
  reserve?: number;
  /** Expand over time (default true). */
  expand?: boolean;
  /** Run marketing campaigns (default true). */
  marketing?: boolean;
  /** Career unlocks (M5.3): true = the bot buys only what is unlocked at the current resort level (its wish list skips locked items and grows when levels unlock them); false (default) = it ignores the gate like the starter chain does. */
  respectUnlocks?: boolean;
  /** Scenario policy (family priorities, snowmaking first, summer attractions first, ...). Default: the policy of `sim.config.scenario`, if any. */
  policy?: BotPolicy | null;
  /** Apply a price strategy once (exploit tests). */
  prices?: (sim: Sim) => void;
}

export interface MonthRow {
  year: number; month: number; guests: number; happiness: number; rating: number;
  income: Record<string, number>; expense: Record<string, number>; incomeTotal: number; expenseTotal: number; net: number;
  cash: number; debt: number; incidents: number;
}

type Pt = { x: number; y: number };
const ringOf = (r: Rect): Pt[] => {
  const out: Pt[] = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
  for (let y = r.y; y < r.y + r.h; y++) out.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
  return out;
};

/** Expansion wish list in priority order: [type, max count by size 64/128/256, minimum monthly index when it is considered]. */
export const WISHES: readonly Wish[] = [
  ['rental', [1, 1, 2]], ['chalet', [2, 3, 4]], ['lodge', [1, 2, 3]], ['playground', [1, 1, 1]], ['adventurePark', [1, 1, 2]], ['shop', [1, 2, 3]], ['parking', [1, 2, 2]], ['cafe', [1, 2, 3]],
  ['apartment', [0, 1, 2]], ['liftWorkshop', [1, 1, 1]], ['beach', [0, 1, 1]],
];

export class Bot {
  report: StarterReport | null = null;
  readonly rows: MonthRow[] = [];
  incidents = 0;
  private lastMonthKey = -1;
  private lastSummer = false;
  private placedIncidents = 0;
  private arrivals = 0;
  private readonly lodge: Pt | null = null;
  readonly policy: BotPolicy | null;

  constructor(readonly sim: Sim, readonly opt: BotOptions = {}) {
    this.policy = opt.policy !== undefined ? opt.policy : sim.config.scenario ? policyFor(sim.config.scenario) : null;
    sim.bus.on('incident:created', () => { this.incidents++; this.placedIncidents++; });
    sim.bus.on('guest:arrived', () => { this.arrivals++; });
    if (opt.starter !== false && !sim.config.starterResort) this.setup();
    this.lodge = ((): Pt | null => { const l = sim.buildings.all().find((b) => b.type === 'baseLodge'); return l ? { x: l.x + l.w / 2, y: l.y + l.h / 2 } : null; })();
    if (opt.prices) opt.prices(sim);
  }

  /** Take the loan (if asked), build the starter resort and pay for it from the bot's own cash. */
  private setup(): void {
    const sim = this.sim;
    if (this.opt.starterLoan) this.takeLoan('starter');
    const cash0 = sim.game.money;
    const top = 5_000_000;
    sim.game.money = top;
    const trails = this.policy?.trails;
    this.report = buildStarterResort(sim, {
      ...this.policy?.starter, ...this.opt.starterOpts, funds: top,
      ...(trails ? { extra: (kit) => {
        // summer policy: a hiking and a biking trail along every lift line (same strokes the pistes use)
        for (const full of kit.pisteStroke) { const s = sweepBrush(interpolateStroke(full), 1, sim.size); sim.networks.paint(Layer.Hike, s); sim.networks.paint(Layer.Mtb, s); }
        kit.settle();
      } } : {}),
    });
    const spent = top - sim.game.money;
    sim.game.money = cash0 - spent; // may go negative: the player then lives off the overdraft (like a real player who over-builds)
    // every receipt of the build-out was booked as construction spending already; keep the ledger honest (no refunds)
  }

  takeLoan(id: 'starter' | 'small' | 'medium' | 'large'): boolean {
    const sim = this.sim;
    const d = sim.game.date;
    return sim.loans.take(id, sim.creditCtx(), { year: d.year, month: monthIndex(d) }).ok;
  }

  private edges(): Pt | null { return this.lodge; }

  private ensure(kind: NetKindId, r: Rect, from: Pt[]): boolean {
    const n = this.sim.networks;
    if (n.serves(kind === NetKind.Road ? 'road' : 'path', r)) return true;
    const goal = new Set(ringOf(r).map((t) => n.idxOf(t.x, t.y)));
    for (const s of from) {
      if (!n.inBounds(s.x, s.y)) continue;
      const route = n.route(kind, s, s, 0, (x, y) => goal.has(n.idxOf(x, y)));
      if (route.length) { for (const t of route) n.build(kind, t.x, t.y); if (n.serves(kind === NetKind.Road ? 'road' : 'path', r)) return true; }
    }
    return false;
  }

  /** Place `type` on the first valid tile around the lodge (outward spiral) and connect it. */
  private build(type: string): boolean {
    const sim = this.sim, c = this.edges(), def = BUILDINGS[type];
    if (!c || !def) return false;
    const { env, props, networks, buildings } = sim;
    const lodge = buildings.all().find((b) => b.type === 'baseLodge');
    if (!lodge) return false;
    for (let r = 4; r <= Math.min(34, sim.size * 0.3); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(c.x) - (def.w >> 1) + dx, y = Math.round(c.y) - (def.h >> 1) + dy;
        const out = this.opt.respectUnlocks ? placeBuilding(env, props, type, x, y, 0, autoFlattenDefault(type), false) : sim.progression.withBypass(() => placeBuilding(env, props, type, x, y, 0, autoFlattenDefault(type), false));
        if (out.ok && out.building) {
          const b = out.building;
          sim.refreshCoverage(b, out.changed.length > 0);
          if (def.access === 'road') this.ensure(NetKind.Road, b, [networks.roadEntry ?? { x: -1, y: -1 }]);
          else if (def.access === 'path' || def.access === 'pisteEdge') this.ensure(NetKind.Path, b, ringOf(lodge));
          buildings.reevaluate(); sim.refreshCoverage(undefined, true);
          return true;
        }
      }
    }
    return false;
  }

  private hasSummerAttraction(): boolean { return this.sim.buildings.all().some((b) => b.active && ['adventurePark', 'beach', 'boatRental', 'alpineFarm'].includes(b.type)); }
  private count(type: string): number { return this.sim.buildings.all().filter((b) => b.type === type).length; }

  /** Call once per in-game day (the harness does). */
  daily(): void {
    const sim = this.sim, d = sim.game.date;
    const summer = seasonOf(d) === 'summer';
    if (summer !== this.lastSummer) {
      this.lastSummer = summer;
      // lifts that are not bike lifts rest in summer (no snow => no skiers; schedule profile so energy is not wasted)
      if (summer) sim.liftOps.keepOnly('summer', new Set(sim.lifts.all().filter((l) => LIFTS[l.kind]?.carriesBikes).map((l) => l.id)));
      else sim.liftOps.enableAll('summer');
    }
    const key = d.year * 12 + monthIndex(d);
    if (key === this.lastMonthKey || (d.day % DAYS_PER_MONTH) !== 0) return;
    this.lastMonthKey = key;
    this.monthly(summer);
  }

  private monthly(summer: boolean): void {
    const sim = this.sim, cash = () => sim.game.money, reserve = this.opt.reserve ?? 25_000;
    // loans: starter loan when cash is low and nothing was ever borrowed; repay early when comfortable
    if (cash() < reserve * 0.5 && sim.loans.active().length === 0) this.takeLoan('starter');
    for (const l of [...sim.loans.active()]) if (cash() > l.balance / 100 + reserve * 3) sim.loans.repay(l.id);
    if (this.opt.marketing !== false && cash() > reserve + 15_000) {
      const order = summer ? (this.hasSummerAttraction() ? ['summer'] : []) : this.policy?.marketing ?? ['budget', 'families', 'brand'];
      for (const id of order) if (!sim.marketing.blocker(id) && cash() > reserve + 12_000) { sim.marketing.start(id); break; }
    }
    if (this.opt.expand === false) return;
    const si = sim.size >= 256 ? 2 : sim.size >= 128 ? 1 : 0;
    for (const [type, max] of this.policy?.wishes ?? WISHES) {
      if (this.count(type) >= max[si]!) continue;
      if (this.opt.respectUnlocks && !sim.progression.isUnlocked('building', type)) continue; // locked at this resort level: skip, the next level may open it
      const cost = BUILDINGS[type]!.cost;
      if (cash() < cost * 1.3 + reserve) break;
      if (!this.build(type)) continue;
      break; // one building per month: a steady, human pace
    }
  }

  /** Close the month's books into `rows` (call from the harness on `finance:monthClosed`). */
  snapshotMonth(): void {
    const r = this.sim.economy.lastReport();
    if (!r) return;
    this.rows.push({
      year: r.year, month: r.month, guests: this.arrivals, happiness: r.happiness, rating: this.sim.rating.stars,
      income: { ...r.income }, expense: { ...r.expense }, incomeTotal: r.incomeTotal, expenseTotal: r.expenseTotal, net: r.net,
      cash: r.cashEnd, debt: r.debt, incidents: this.placedIncidents,
    });
    this.placedIncidents = 0; this.arrivals = 0;
  }
}

/** Run a bot-driven sim for `days` in-game days (240 ticks each). */
export function runBot(sim: Sim, bot: Bot, days: number, onDay?: (day: number) => void): void {
  sim.bus.on('finance:monthClosed', () => bot.snapshotMonth());
  for (let day = 0; day < days; day++) {
    bot.daily();
    sim.tick(240);
    onDay?.(day);
  }
}
