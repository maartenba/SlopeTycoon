import type { CampaignDef } from '../config/marketing';
import { MARKETING } from '../config/marketing';
import type { CampaignRecord, Marketing, Preview, PrereqCheck } from '../sim/Marketing';
import { formatMoney } from './format';

export interface CampaignCardView { def: CampaignDef; preview: Preview; blocker: string | null; cooldownLeft: number; affordable: boolean; /** Hard prerequisites with ✓/✗. */ prereqs: PrereqCheck[]; prereqsOk: boolean; /** Career lock reason (disables the card), null = unlocked. */ locked: string | null }
export interface RunningView { def: CampaignDef; pct: number; daysLeft: number; effPct: number; arrivals: number; /** Extra status line (Come by Train: rail share + station load). */ extra?: string; /** Today's live multiplier (day class / festival window), 1 = none. */ live: number; /** Missing prerequisites while paused (empty = running normally). */ paused: string[]; pausedDays: number }
export interface MarketingView { cards: CampaignCardView[]; running: RunningView[]; history: CampaignRecord[]; maxConcurrent: number }

export function buildMarketingView(m: Marketing, funds: number): MarketingView {
  const today = m.today();
  return {
    maxConcurrent: MARKETING.maxConcurrent,
    cards: m.list().map((def) => ({ def, preview: m.preview(def), blocker: m.blocker(def.id), cooldownLeft: m.cooldownLeft(def.id), affordable: funds >= def.cost, prereqs: m.canStart(def.id).checks, prereqsOk: m.canStart(def.id).ok, locked: m.lockedReason(def.id) })),
    running: m.running().map((a) => {
      const def = m.list().find((c) => c.id === a.id)!, total = Math.max(1, a.end - a.start);
      const live = m.liveFactor(def);
      let extra: string | undefined;
      if (def.railBias) { const r = m.railStatus(); extra = `By train: ${r.share === null ? '—' : `${Math.round(r.share * 100)}%`} of arrivals (station ${r.load}/${r.capacity})`; }
      return { def, extra, live, pct: Math.max(0, Math.min(100, Math.round((100 * (today - a.start)) / total))), daysLeft: Math.max(0, a.end - today), effPct: a.lapsed ? 0 : Math.round(a.eff * live * 100), arrivals: a.arrivals, paused: a.lapsed ? a.lapsedWhy ?? [] : [], pausedDays: a.lapsed ?? 0 };
    }),
    history: [...m.records()],
  };
}

export const effLabel = (v: number): string => `${Math.round(v * 100)}%`;
export const rangeText = (r: [number, number] | null, money = false): string => (r === null ? '—' : money ? `${formatMoney(r[0])} – ${formatMoney(r[1])}` : `${r[0]} – ${r[1]}`);
export const costPerGuestText = (v: number | null): string => (v === null ? '—' : `${formatMoney(v)} / guest`);
export const upliftText = (r: CampaignRecord): string => (r.cancelled ? `cancelled (${r.cancelled})` : r.uplift === null ? 'uplift n/a (no baseline)' : `${r.uplift >= 0 ? '+' : ''}${r.uplift} guests (${(r.upliftPct ?? 0) >= 0 ? '+' : ''}${r.upliftPct}%) vs baseline`);
export const shareText = (r: CampaignRecord): string => (r.shareBefore === null || r.shareDuring === null ? '' : ` · target share ${Math.round(r.shareBefore * 100)}% → ${Math.round(r.shareDuring * 100)}%`);
