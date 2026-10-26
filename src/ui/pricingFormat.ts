import { DAY_CLASSES, PRICE_KEY_INFO, SCHEDULE_PROFILES, type DayClass, type PriceKeyInfo, type ScheduleProfile } from '../config/marketing';
import { mixVolume } from '../sim/Elasticity';
import { TYPE_MIX } from '../sim/guests/Spawner';
import type { Pricing } from '../sim/Pricing';

export type PriceGroup = PriceKeyInfo['group'];
export const PRICE_TABS: ReadonlyArray<{ id: 'lifts' | 'attractions' | 'lodging' | 'food' | 'seasonal'; label: string }> = [
  { id: 'lifts', label: 'Lifts & passes' }, { id: 'attractions', label: 'Attractions' }, { id: 'lodging', label: 'Lodging' }, { id: 'food', label: 'Food & shops' }, { id: 'seasonal', label: 'Seasonal schedule' },
];
export const PRESETS: ReadonlyArray<{ id: 'budget' | 'balanced' | 'premium'; label: string; factor: number }> = [
  { id: 'budget', label: 'Budget friendly', factor: 0.8 }, { id: 'balanced', label: 'Balanced', factor: 1 }, { id: 'premium', label: 'Premium', factor: 1.25 },
];

export interface PriceRow {
  key: string; label: string; price: number; effective: number; def: number; min: number; max: number; free: boolean; canBeFree: boolean; percent: boolean;
  ratio: number; verdict: 'cheap' | 'fair' | 'expensive'; gauge: number; demandPct: number; overridden: boolean;
}

/** Gauge position 0..100 for a price ratio (0.4 .. 1.8 maps to the bar). */
export const gaugePercent = (ratio: number): number => Math.round(Math.max(0, Math.min(1, (ratio - 0.4) / 1.4)) * 100);
/** Projected demand (%) for a ratio, against the winter guest mix. 100 = fair-price demand. */
export const demandPercent = (ratio: number): number => Math.round(mixVolume(TYPE_MIX.winter, ratio) * 100);
export const verdictLabel = (v: PriceRow['verdict']): string => (v === 'cheap' ? 'Cheap' : v === 'expensive' ? 'Expensive' : 'Fair');
export const formatPrice = (v: number, percent: boolean): string => (percent ? `${Math.round(v)}%` : `$${Number.isInteger(v) ? v : v.toFixed(2)}`);
export const multLabel = (m: number): string => `x${m.toFixed(2)}`;

export function priceRows(p: Pricing, tab: PriceGroup | 'food'): PriceRow[] {
  const groups: PriceGroup[] = tab === 'food' ? ['food', 'markup'] : [tab];
  return PRICE_KEY_INFO.filter((i) => groups.includes(i.group)).map((i) => {
    const ratio = p.ratioOf(i.key), percent = i.key.startsWith('markup:');
    return {
      key: i.key, label: i.label, price: p.get(i.key), effective: p.effective(i.key), def: p.defaultOf(i.key), min: p.minOf(i.key), max: p.maxOf(i.key),
      free: p.isFree(i.key), canBeFree: p.canBeFree(i.key), percent, ratio, verdict: p.verdictOf(i.key), gauge: gaugePercent(ratio), demandPct: demandPercent(ratio), overridden: p.isOverridden(i.key),
    };
  });
}

export interface ScheduleCell { profile: ScheduleProfile; cls: DayClass; mult: number }
export const PROFILE_LABEL: Record<ScheduleProfile, string> = { winter: 'Winter', shoulder: 'Spring / autumn', summer: 'Summer' };
export const CLASS_LABEL: Record<DayClass, string> = { peak: 'Peak (weekends, holidays, powder)', regular: 'Regular (Fri)', off: 'Off-peak (Mon-Thu)' };
export function scheduleCells(p: Pricing): ScheduleCell[] {
  const out: ScheduleCell[] = [];
  for (const profile of SCHEDULE_PROFILES) for (const cls of DAY_CLASSES) out.push({ profile, cls, mult: p.schedule[profile][cls] });
  return out;
}
/** Today's summary line, e.g. "Today: Peak day, x1.20". */
export function todayLine(p: Pricing): string {
  const cls = p.dayClass();
  return `Today: ${cls === 'peak' ? 'peak' : cls === 'off' ? 'off-peak' : 'regular'} day${p.powderToday() ? ' (powder!)' : ''}, ${multLabel(p.seasonalMultiplier())}`;
}
