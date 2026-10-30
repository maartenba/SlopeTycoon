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
import { ECO, ECO_POLICY_BY_ID } from '../config/eco';
import { BOT_UPGRADE_ORDER, STAFF_UPGRADES } from '../config/staffUpgrades';
import { policyFor, type BotPolicy, type Wish } from './botPolicies';
import { applyPlanting, planPlanting } from '../sim/nature/Planting';
import { liftPlantBlocker } from '../sim/Lift';
import { SUSTAIN } from '../config/rivals';

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
  /** Train the six staff upgrades in the fixed order `BOT_UPGRADE_ORDER` (one at a time, when cash allows). Default false. */
  staffUpgrades?: boolean;
  /** Green play (Task 23, default true): builds on open ground rather than inside forest habitat, replants the trees the build-out felled, and trains the rangers when buildings and pistes overlap the habitat. */
  green?: boolean;
  /** Green power (item F, default false so the golden runs stay put): builds ONE solar array when cash allows and the energy part is the weakest sustainability part. */
  greenEnergy?: boolean;
  /** Eco programme (docs/eco.md, default false so the golden runs stay put): builds the Eco Centre (+ two solar arrays) when rich ('build' = buildings only, no policies: the A/B control), then funds every policy and the certificate as cash allows. */
  eco?: boolean | 'build';
  /** Summer lift handling: 'rest' (default; the bot closes the winter lifts) or 'keep' (a typical human leaves every lift on the default schedule: energy for nobody). */
  summerLifts?: 'rest' | 'keep';
  /** Summer plan (Phase 6 M6.3 STOP check, default false so the golden runs stay put): hiking + MTB trails along every lift line (the chairs are the bike lifts) in the opening, then campground, petting zoo and viewpoint are added at the END of the wish list (additive: no winter building is displaced) (one building a month, respecting unlocks when asked). */
  summer?: boolean;
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

/** Wishes of the `summer` option (campground, petting zoo, viewpoint). */
export const SUMMER_WISHES: readonly Wish[] = [['campground', [1, 1, 2]], ['pettingZoo', [1, 1, 2]], ['viewpoint', [1, 1, 2]]];

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
    const trails = this.policy?.trails || this.opt.summer;
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
    const fd = sim.terrainInfo.forestDensity, N = sim.size;
    const inHabitat = (x: number, y: number): boolean => { for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) if (xx >= 0 && yy >= 0 && xx < N && yy < N && fd[yy * N + xx]! >= SUSTAIN.habitat.forestMin) return true; return false; };
    for (let pass = this.opt.green === false ? 1 : 0; pass < 2; pass++) for (let r = 4; r <= Math.min(34, sim.size * 0.3); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(c.x) - (def.w >> 1) + dx, y = Math.round(c.y) - (def.h >> 1) + dy;
        if (pass === 0 && inHabitat(x, y)) continue; // green: open ground first, habitat only when nothing else fits
        const out = this.opt.respectUnlocks ? placeBuilding(env, props, type, x, y, 0, autoFlattenDefault(type), false) : sim.progression.withBypass(() => placeBuilding(env, props, type, x, y, 0, autoFlattenDefault(type), false));
        if (out.ok && out.building) {
          const b = out.building;
          sim.refreshCoverage(b, out.changed.length > 0);
          // shop / chalet / apartment accept a footpath, but the bot keeps serving them by road (balance + goldens unchanged)
          if (def.access === 'road' || type === 'shop' || type === 'chalet' || type === 'apartment') this.ensure(NetKind.Road, b, [networks.roadEntry ?? { x: -1, y: -1 }]);
          else if (def.access === 'path' || def.access === 'pisteEdge' || (this.opt.summer && type === 'viewpoint')) this.ensure(NetKind.Path, b, ringOf(lodge));
          buildings.reevaluate(); sim.refreshCoverage(undefined, true);
          return true;
        }
      }
    }
    return false;
  }

  /** One solar array when rich and the energy part is the weakest of the facet (and nothing renewable stands yet). */
  private buildSolar(reserve: number): void {
    const sim = this.sim, p = sim.sustain.last();
    if (!p || sim.energy.hasRenewable() || p.raw.energyPerGuest < 0) return;
    if (p.energy > Math.min(p.trees, p.habitat) + 0.05) return; // energy is not the weakest part
    if (sim.game.money < BUILDINGS.solarArray!.cost * 1.3 + reserve + 15_000) return;
    this.build('solarArray');
  }

  /** Eco programme: a solar array first (renewables for the certificate), then the Eco Centre, then every policy, then the audit. One step a month. */
  private ecoStep(reserve: number): void {
    const sim = this.sim, cash = sim.game.money;
    const centre = sim.buildings.all().find((b) => b.type === 'ecoCentre');
    if (!centre) {
      if (this.opt.respectUnlocks && !sim.progression.isUnlocked('building', 'ecoCentre')) return;
      if (this.count('solarArray') < 2 && cash > BUILDINGS.solarArray!.cost * 1.3 + reserve + 10_000) { this.build('solarArray'); return; }
      if (cash > BUILDINGS.ecoCentre!.cost * 1.3 + reserve + 10_000) this.build('ecoCentre');
      return;
    }
    if (!centre.active || this.opt.eco === 'build') return; // 'build': the buildings only (the control of the balance A/B)
    for (const v of sim.eco.views()) if (v.state === 'off' && cash > ECO_POLICY_BY_ID[v.id]!.fee * 2 + reserve + 5_000) { sim.eco.start(v.id); return; }
    if (!sim.eco.certView().on && sim.eco.activeCount() >= 3 && cash > ECO.cert.fee * 2 + reserve) sim.eco.startCert();
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
      if (this.opt.summerLifts === 'keep') { /* human: lifts stay on the schedule */ } else if (summer) sim.liftOps.keepOnly('summer', new Set(sim.lifts.all().filter((l) => LIFTS[l.kind]?.carriesBikes).map((l) => l.id)));
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
    if (this.opt.staffUpgrades) this.trainStaff();
    if (this.opt.green !== false) { this.replant(); this.trainRangers(); }
    if (this.opt.greenEnergy) this.buildSolar(reserve);
    if (this.opt.eco) this.ecoStep(reserve);
    // comfort need: the starter chain has one free toilet; a busier resort gets one more per ~100 guests (max 3), cheap and free to use
    if (sim.guestSim.comfortNeed && cash() > reserve + 3_000 && this.count('toilets') < Math.min(3, 1 + Math.floor(sim.guestSim.store.count / 100))) this.build('toilets');
    if (this.opt.expand === false) return;
    const si = sim.size >= 256 ? 2 : sim.size >= 128 ? 1 : 0;
    const wishes = this.opt.summer ? [...(this.policy?.wishes ?? WISHES), ...SUMMER_WISHES] : this.policy?.wishes ?? WISHES;
    for (const [type, max] of wishes) {
      if (this.count(type) >= max[si]!) continue;
      if (this.opt.respectUnlocks && !sim.progression.isUnlocked('building', type)) continue; // locked at this resort level: skip, the next level may open it
      const cost = BUILDINGS[type]!.cost;
      if (cash() < cost * 1.3 + reserve) break;
      if (!this.build(type)) continue;
      break; // one building per month: a steady, human pace
    }
  }

  /** Replant what was felled: a few conifer stamps a month around the lodge until planted >= felled (cheap: $12 a tree). */
  private replant(): void {
    const sim = this.sim, c = this.edges(), reserve = this.opt.reserve ?? 25_000;
    if (!c || sim.props.treesPlanted >= sim.props.treesFelled || sim.game.money < reserve + 3_000) return;
    const env = { grid: sim.grid, props: sim.props, seed: sim.seed, blocked: (i: number) => sim.grid.occupancy.flags[i] !== 0 || (sim.networks.layers[i] ?? 0) !== 0 || (sim.networks.kind[i] ?? 0) !== 0, liftBlocks: liftPlantBlocker(sim.lifts, sim.grid) };
    const now = sim.game.date.year * 180 + sim.game.date.day;
    let stamps = 0;
    for (let r = 8; r <= 30 && stamps < 8 && sim.props.treesPlanted < sim.props.treesFelled; r += 3) {
      for (let k = 0; k < 8 && stamps < 8 && sim.props.treesPlanted < sim.props.treesFelled; k++) {
        const a = (k / 8) * Math.PI * 2 + r, x = Math.round(c.x + Math.cos(a) * r), y = Math.round(c.y + Math.sin(a) * r);
        if (x < 2 || y < 2 || x >= sim.size - 2 || y >= sim.size - 2) continue;
        const plan = planPlanting(env, x, y, 3, 'conifer', 0.7, now);
        if (plan.trees.length < 4) continue;
        const cost = Math.round(plan.cost * sim.economy.constructionMultiplier() * sim.energy.plantCostMult());
        if (!sim.economy.charge(cost)) return;
        const chunks = applyPlanting(sim.props, plan, now);
        sim.nature.growth.track(chunks); sim.nature.cover.dirty = true; stamps++;
      }
    }
  }

  /** Rangers (the habitat protection input of the sustainability facet): only when the buildings and pistes really overlap forest habitat. */
  private trainRangers(): void {
    const sim = this.sim, reserve = this.opt.reserve ?? 25_000;
    if (this.opt.staffUpgrades || sim.staffUpgrades.has('rangers') || sim.staffUpgrades.training) return;
    if ((sim.sustain.last()?.raw.habitatOverlap ?? 0) <= SUSTAIN.habitat.free) return;
    if (sim.game.money < STAFF_UPGRADES.find((u) => u.id === 'rangers')!.cost * 1.5 + reserve) return;
    if (this.opt.respectUnlocks) sim.staffUpgrades.start('rangers'); else sim.progression.withBypass(() => sim.staffUpgrades.start('rangers'));
  }

  /** Fixed purchase order, one course at a time; only when the cost plus the reserve is in the till (an upgrade never starves the resort). */
  private trainStaff(): void {
    const sim = this.sim, reserve = this.opt.reserve ?? 25_000;
    if (sim.staffUpgrades.training) return;
    const next = BOT_UPGRADE_ORDER.find((id) => !sim.staffUpgrades.has(id));
    if (!next) return;
    const cost = STAFF_UPGRADES.find((u) => u.id === next)!.cost;
    if (sim.game.money < cost * 1.5 + reserve) return;
    if (this.opt.respectUnlocks) sim.staffUpgrades.start(next);
    else sim.progression.withBypass(() => sim.staffUpgrades.start(next));
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
