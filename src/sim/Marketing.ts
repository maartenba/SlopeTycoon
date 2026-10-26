import { CAMPAIGNS, GUEST_TYPE_KEYS, MARKETING, PREREQ_GRACE_DAYS, type CampaignDef, type FacilityId, type GuestTypeKey, type Prereq, type PrereqId, type SeasonKey } from '../config/marketing';
import { sentence } from '../ui/text';
import { DAYS_PER_YEAR } from '../config/balance';
import type { GameBus } from '../core/events';
import type { Economy } from './Economy';
import type { UnlockGate } from '../config/unlocks';

export interface MarketingContext {
  season(): SeasonKey;
  /** Resort rating stars 0..5. */
  stars(): number;
  has(f: FacilityId): boolean;
  /** Hard prerequisite check (createSim computes them from buildings, lifts, trails, season, rating). Absent = everything is met (unit tests). */
  met?(id: PrereqId): boolean;
  /** Day pass price / fair value. */
  dayPassRatio(): number;
  /** Average revenue per arriving guest (for ROI previews). */
  spendPerGuest?(): number;
}
export interface MarketingDeps {
  economy: Pick<Economy, 'charge'>;
  bus?: Pick<GameBus, 'emit'>;
  date(): { year: number; day: number };
  ctx: MarketingContext;
  /** Career unlock gate (config/unlocks.ts); absent = nothing is locked. */
  gate?: UnlockGate;
}

export interface Effectiveness { value: number; factors: Array<{ label: string; factor: number }>; warnings: string[] }
export interface Preview { effectiveness: Effectiveness; extraGuests: [number, number] | null; extraRevenue: [number, number] | null; costPerGuest: number | null; targetBoostPct: number }
interface ActiveRun { id: string; start: number; end: number; cost: number; eff: number; baseline: number; shareBefore: number; arrivals: number; target: number; /** Consecutive days a prerequisite was missing (paused while > 0). */ lapsed?: number; /** Missing prerequisite labels while paused. */ lapsedWhy?: string[] }
interface TailRun { id: string; end: number; eff: number }
export interface CampaignRecord { id: string; name: string; start: number; days: number; cost: number; eff: number; arrivals: number; baselinePerDay: number | null; uplift: number | null; upliftPct: number | null; shareBefore: number | null; shareDuring: number | null; /** Set when the campaign was cancelled (reason text). */ cancelled?: string }
interface DayLog { day: number; total: number; byType: number[]; influenced: boolean }

export interface MarketingEffect { weights: Record<GuestTypeKey, number>; boost: number }
const neutral = (): MarketingEffect => ({ weights: { solo: 1, couple: 1, family: 1, vip: 1, budget: 1, adventure: 1 }, boost: 1 });

const absDay = (d: { year: number; day: number }): number => d.year * DAYS_PER_YEAR + d.day;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const campaignById = (id: string): CampaignDef | undefined => CAMPAIGNS.find((c) => c.id === id);

/** Prerequisites of `def` that are not met right now (hard rules; see config/marketing.ts). */
export const missingPrereqs = (def: CampaignDef, ctx: MarketingContext): Prereq[] => def.prereqs.filter((p) => !(ctx.met?.(p.id) ?? true));
export interface PrereqCheck { id: PrereqId; label: string; ok: boolean; build?: string }
export interface StartCheck { ok: boolean; /** Human-readable reasons ('Ski School HQ', ...), sentence-cased. */ missing: string[]; checks: PrereqCheck[] }

/** Pure: how well would `def` work right now (season x quality x facilities x price alignment). */
export function campaignEffectiveness(def: CampaignDef, ctx: MarketingContext): Effectiveness {
  const factors: Effectiveness['factors'] = [], warnings: string[] = [];
  let v = 1;
  const mul = (label: string, f: number): void => { if (f !== 1) factors.push({ label, factor: Math.round(f * 100) / 100 }); v *= f; };
  const season = ctx.season();
  if (!def.seasons.includes(season)) { mul('Wrong season', def.offSeason); warnings.push(`Works best in ${def.seasons.join('/')}`); }
  const stars = ctx.stars();
  mul('Resort quality', clamp(MARKETING.qualityBase + MARKETING.qualityPerStar * stars, MARKETING.qualityBase, MARKETING.qualityMax));
  if (def.minStars && stars < def.minStars) { mul('Low rating', 0.5 + (0.5 * stars) / def.minStars); warnings.push(`Needs a ${def.minStars}★ resort`); }
  const lacking = missingPrereqs(def, ctx);
  if (lacking.length) { v = 0; warnings.push(`Requires: ${lacking.map((p) => p.label).join(', ')}`); }
  if (def.bonus && ctx.has(def.bonus.id)) mul('Facility bonus', def.bonus.factor);
  if (def.priceAlign) {
    const r = ctx.dayPassRatio();
    const f = def.priceAlign === 'cheap' ? clamp(1 - (r - 0.9) / 1.2, 0.35, 1) : clamp(1 - (1.1 - r), 0.35, 1);
    if (f < 0.95) warnings.push(def.priceAlign === 'cheap' ? 'Day pass is too expensive for this audience' : 'Day pass is too cheap for this audience');
    mul('Price fit', f);
  }
  return { value: Math.round(clamp(v, 0, 1.5) * 1000) / 1000, factors, warnings };
}

/** Marketing campaigns: upfront cost, N days of effect, decaying tail, measured uplift. Serialisable, deterministic (no RNG). */
export class Marketing {
  private active: ActiveRun[] = [];
  private tails: TailRun[] = [];
  private history: CampaignRecord[] = [];
  private cooldown = new Map<string, number>();
  private log: DayLog[] = [];
  private curDay = -1;
  private cache: MarketingEffect | null = null;

  constructor(private d: MarketingDeps) {}

  list(): readonly CampaignDef[] { return CAMPAIGNS; }
  running(): readonly ActiveRun[] { return this.active; }
  records(): readonly CampaignRecord[] { return this.history; }
  today(): number { return absDay(this.d.date()); }
  cooldownLeft(id: string): number { return Math.max(0, (this.cooldown.get(id) ?? 0) - this.today()); }
  effectiveness(def: CampaignDef): Effectiveness { return campaignEffectiveness(def, this.d.ctx); }

  /** Average daily arrivals over the baseline window, ignoring campaign-influenced days when possible. null = no data yet. */
  baselinePerDay(): number | null {
    const days = this.log.filter((l) => l.day < this.today()).slice(-MARKETING.baselineDays);
    if (!days.length) return null;
    const clean = days.filter((l) => !l.influenced);
    const use = clean.length >= 3 ? clean : days;
    return use.reduce((a, l) => a + l.total, 0) / use.length;
  }
  private shareOf(def: CampaignDef): number | null {
    const days = this.log.filter((l) => l.day < this.today() && !l.influenced).slice(-MARKETING.baselineDays);
    const tot = days.reduce((a, l) => a + l.total, 0);
    if (tot <= 0) return null;
    const keys = Object.keys(def.targets);
    const t = days.reduce((a, l) => a + keys.reduce((s, k) => s + (l.byType[GUEST_TYPE_KEYS.indexOf(k as GuestTypeKey)] ?? 0), 0), 0);
    return t / tot;
  }

  preview(def: CampaignDef): Preview {
    const eff = this.effectiveness(def), base = this.baselinePerDay();
    const spend = this.d.ctx.spendPerGuest?.() ?? 80;
    const maxT = Math.max(0, ...Object.values(def.targets));
    let extra: [number, number] | null = null, rev: [number, number] | null = null, cpg: number | null = null;
    if (base !== null && base > 0) {
      const tailDays = MARKETING.tailDays / 2;
      const centre = base * (def.durationDays + tailDays) * def.volumeBoost * eff.value;
      extra = [Math.round(centre * (1 - MARKETING.previewSpread)), Math.round(centre * (1 + MARKETING.previewSpread))];
      rev = [Math.round(extra[0] * spend), Math.round(extra[1] * spend)];
      cpg = centre > 0 ? Math.round((def.cost / centre) * 100) / 100 : null;
    }
    return { effectiveness: eff, extraGuests: extra, extraRevenue: rev, costPerGuest: cpg, targetBoostPct: Math.round(maxT * eff.value * 100) };
  }

  /** Can `id` be started given the current prerequisites? (cost, cooldown and slots are `blocker`'s job.) */
  canStart(id: string): StartCheck {
    const def = campaignById(id);
    if (!def) return { ok: false, missing: ['Unknown campaign'], checks: [] };
    const checks = def.prereqs.map((p) => ({ id: p.id, label: sentence(p.label), ok: this.d.ctx.met?.(p.id) ?? true, build: p.build }));
    return { ok: checks.every((c) => c.ok), missing: checks.filter((c) => !c.ok).map((c) => c.label), checks };
  }

  /** Career lock reason ('Unlocks at level 5: ...') or null. */
  lockedReason(id: string): string | null { return this.d.gate?.locked('campaign', id) ?? null; }

  /** Why `id` can't start now (null = can). */
  blocker(id: string): string | null {
    const def = campaignById(id);
    if (!def) return 'Unknown campaign';
    const lock = this.lockedReason(id);
    if (lock) return lock;
    const pre = this.canStart(id);
    if (!pre.ok) return `Requires: ${pre.missing.join(', ')}`;
    if (this.active.some((a) => a.id === id)) return 'Already running';
    if (this.active.length >= MARKETING.maxConcurrent) return `At most ${MARKETING.maxConcurrent} campaigns at once`;
    const cd = this.cooldownLeft(id);
    if (cd > 0) return `Cooling down (${cd} d)`;
    return null;
  }

  /** Start a campaign (pays upfront under the 'marketing' expense category). Returns an error text or null. */
  start(id: string): string | null {
    const def = campaignById(id), why = this.blocker(id);
    if (why) return why;
    if (!def) return 'Unknown campaign';
    if (!this.d.economy.charge(def.cost, 'marketing')) return 'Not enough cash';
    this.rollover();
    const eff = this.effectiveness(def).value, today = this.today();
    this.active.push({ id, start: today, end: today + def.durationDays, cost: def.cost, eff, baseline: this.baselinePerDay() ?? 0, shareBefore: this.shareOf(def) ?? 0, arrivals: 0, target: 0 });
    this.cache = null;
    this.d.bus?.emit('marketing:started', { id, name: def.name, cost: def.cost, days: def.durationDays, effectiveness: eff });
    return null;
  }

  private cancel(a: ActiveRun, reason: string): void {
    this.active.splice(this.active.indexOf(a), 1);
    const def = campaignById(a.id)!, days = Math.max(1, this.today() - a.start);
    this.history.unshift({ id: a.id, name: def.name, start: a.start, days, cost: a.cost, eff: a.eff, arrivals: a.arrivals, baselinePerDay: null, uplift: null, upliftPct: null, shareBefore: null, shareDuring: null, cancelled: reason });
    if (this.history.length > MARKETING.historyMax) this.history.pop();
    this.cooldown.set(a.id, this.today() + def.cooldownDays);
    this.cache = null;
    this.d.bus?.emit('marketing:cancelled', { id: a.id, name: def.name, reason });
  }

  /** Count one arriving guest (type index in GUEST_TYPE_KEYS order). Call from the guest:arrived hook. */
  recordArrival(type: number): void {
    this.rollover();
    const l = this.log[this.log.length - 1]!;
    l.total++; l.byType[type] = (l.byType[type] ?? 0) + 1;
    for (const a of this.active) {
      a.arrivals++;
      if (Object.keys(campaignById(a.id)?.targets ?? {}).some((k) => GUEST_TYPE_KEYS.indexOf(k as GuestTypeKey) === type)) a.target++;
    }
  }

  /** Call every tick (cheap): rolls the day when the calendar changed. */
  update(): void { this.rollover(); }

  private rollover(): void {
    const today = this.today();
    if (today === this.curDay) return;
    const gap = this.curDay < 0 ? 1 : today - this.curDay;
    if (gap < 0 || gap > 1) this.log = [];
    this.curDay = today;
    this.log.push({ day: today, total: 0, byType: [0, 0, 0, 0, 0, 0], influenced: this.active.length > 0 || this.tails.length > 0 });
    if (this.log.length > MARKETING.baselineDays + 16) this.log.shift();
    // running campaigns lose their effect while a prerequisite is missing and are cancelled after PREREQ_GRACE_DAYS
    for (const a of [...this.active]) {
      const check = this.canStart(a.id);
      if (check.ok) { a.lapsed = 0; a.lapsedWhy = undefined; continue; }
      a.lapsed = (a.lapsed ?? 0) + 1; a.lapsedWhy = check.missing;
      if (a.lapsed > PREREQ_GRACE_DAYS) this.cancel(a, `Requires: ${check.missing.join(', ')}`);
    }
    // finish campaigns
    for (const a of [...this.active]) {
      if (today < a.end) continue;
      this.active.splice(this.active.indexOf(a), 1);
      const def = campaignById(a.id)!;
      const days = Math.max(1, a.end - a.start);
      const known = a.baseline > 0;
      const uplift = known ? Math.round(a.arrivals - a.baseline * days) : null;
      const rec: CampaignRecord = {
        id: a.id, name: def.name, start: a.start, days, cost: a.cost, eff: a.eff, arrivals: a.arrivals,
        baselinePerDay: known ? Math.round(a.baseline * 10) / 10 : null, uplift, upliftPct: known ? Math.round((100 * uplift!) / (a.baseline * days)) : null,
        shareBefore: a.shareBefore > 0 ? Math.round(a.shareBefore * 1000) / 1000 : null, shareDuring: a.arrivals > 0 ? Math.round((a.target / a.arrivals) * 1000) / 1000 : null,
      };
      this.history.unshift(rec);
      if (this.history.length > MARKETING.historyMax) this.history.pop();
      this.tails.push({ id: a.id, end: a.end, eff: a.eff });
      this.cooldown.set(a.id, a.end + def.cooldownDays);
      this.d.bus?.emit('marketing:ended', { id: a.id, name: def.name, arrivals: a.arrivals, uplift, upliftPct: rec.upliftPct });
    }
    this.tails = this.tails.filter((t) => today < t.end + MARKETING.tailDays);
    this.cache = null;
  }

  /** Current effect on the spawner: per-type weight multipliers + volume multiplier, with diminishing returns when stacked. */
  effect(): MarketingEffect {
    this.rollover();
    if (this.cache) return this.cache;
    const today = this.today();
    const items: Array<{ def: CampaignDef; s: number }> = [];
    for (const a of this.active) if (!a.lapsed) items.push({ def: campaignById(a.id)!, s: a.eff });
    for (const t of this.tails) { const f = 1 - (today - t.end) / MARKETING.tailDays; if (f > 0) items.push({ def: campaignById(t.id)!, s: t.eff * f }); }
    items.sort((x, y) => y.s - x.s || (x.def.id < y.def.id ? -1 : 1));
    const out = neutral();
    items.forEach((it, i) => {
      const s = it.s * Math.pow(MARKETING.stackFactor, i);
      out.boost += it.def.volumeBoost * s;
      for (const [k, b] of Object.entries(it.def.targets)) out.weights[k as GuestTypeKey] += (b ?? 0) * s;
    });
    return (this.cache = out);
  }

  serialize(): unknown {
    return { active: this.active, tails: this.tails, history: this.history, cooldown: [...this.cooldown.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), log: this.log, cur: this.curDay };
  }
  load(d: unknown): void {
    const o = d as { active: ActiveRun[]; tails: TailRun[]; history: CampaignRecord[]; cooldown: Array<[string, number]>; log: DayLog[]; cur: number } | undefined;
    if (!o) return;
    this.active = o.active; this.tails = o.tails; this.history = o.history; this.cooldown = new Map(o.cooldown); this.log = o.log; this.curDay = o.cur; this.cache = null;
  }
}
