import { ENERGY } from '@/config/energy';
import { ECO_POLICIES } from '@/config/eco';
import type { Eco } from '@/sim/meta/Eco';
import type { Energy, GeneratorInfo, GridDay } from '@/sim/Energy';

/** One inspector line for the green buildings. */
export interface EnergyLine { text: string; tone?: 'good' | 'bad' | '' }
/** Inspector payload of a generator / nursery / recycling centre (`StInspector` just prints the lines). */
export interface EnergyOps { kind: 'energy'; lines: EnergyLine[]; /** A button under the lines (Eco Centre: opens the Eco programme). */ action?: { id: string; label: string } }

const kwhOf = (dollars: number): number => dollars / ENERGY.gridPricePerKwh;
export const fmtKwh = (dollars: number): string => `${Math.round(kwhOf(dollars)).toLocaleString('en-US')} kWh`;
export const fmtKw = (dollarsPerHour: number): string => `${kwhOf(dollarsPerHour).toFixed(1)} kW`;
const money = (d: number): string => `$${Math.round(d).toLocaleString('en-US')}`;

/** Resort-wide line: yesterday's demand vs generation (also the Stats screen's source). */
export function gridSummary(g: GridDay): string {
  if (g.demand <= 0 && g.gross <= 0) return 'Resort grid: no data yet (the first day settles at midnight)';
  const share = g.demand > 0 ? Math.round((100 * g.applied) / g.demand) : 0;
  return `Resort grid yesterday: demand ${fmtKwh(g.demand)}, generated ${fmtKwh(g.gross)}, ${share}% of the bill offset${g.wasted > 0.5 ? `, ${fmtKwh(g.wasted)} unused (surplus is not sold)` : ''}`;
}

/** Inspector lines for a generator (solar, wind, hydro, biomass). */
export function generatorLines(i: GeneratorInfo, g: GridDay, stock = 0): EnergyLine[] {
  const out: EnergyLine[] = [];
  if (!i.active) return [{ text: 'Not connected: no output until it has road or footpath access', tone: 'bad' }];
  out.push({ text: i.kind === 'biomass' ? `Burning: ${fmtKw(i.ratePerHour)} average · timber store ${stock.toFixed(1)}` : `Output now: ${fmtKw(i.ratePerHour)} (${Math.round(100 * i.fraction)}% of rated) · ${i.note}`, tone: i.fraction > 0 ? 'good' : '' });
  out.push({ text: `Today so far: ${fmtKwh(i.today)} · yesterday: ${fmtKwh(i.yesterday)}` });
  out.push({ text: i.yesterday > 0 ? `Took ${money(i.appliedYesterday)} off the energy bill yesterday (${(100 * i.shareOfDemand).toFixed(1)}% of the resort's demand)` : 'Took nothing off the energy bill yesterday' });
  out.push({ text: gridSummary(g) });
  if (g.gross > 0 && g.demand > 0 && g.applied < g.gross - 0.5) out.push({ text: `Offset is capped at ${Math.round(100 * ENERGY.maxOffsetShare)}% of demand: more generators would be wasted today`, tone: 'bad' });
  return out;
}

/** Inspector lines for a tree nursery / recycling centre. */
export function greenLines(type: string, e: Energy, net: { felled: number; planted: number }): EnergyLine[] {
  if (type === 'treeNursery') {
    const credit = Math.floor(e.nurseryCredit), deficit = Math.max(0, net.felled - net.planted - credit);
    return [
      { text: `Saplings raised and counted as planted: ${credit}`, tone: credit > 0 ? 'good' : '' },
      { text: deficit > 0 ? `Forest still to make up: ${deficit} trees (about ${(ENERGY.nursery.saplingsPerDay).toFixed(2)} saplings a day)` : 'No net forest loss to make up' },
      { text: `Replanting with the Plant tool costs ${Math.round(100 * ENERGY.nursery.plantCostShare)}% while a nursery works` },
    ];
  }
  if (type === 'recyclingCentre') return [{ text: `Sustainability bonus: +${ENERGY.recycling.bonusPoints} points (one centre; more do not stack)`, tone: 'good' }];
  return [];
}

/** Inspector lines of the Eco Centre (the programme itself opens from the button under them). */
export function ecoLines(eco: Eco, score: number | null): EnergyLine[] {
  if (!eco.enabled) return [{ text: 'Not connected: the policies pause until it has road or footpath access', tone: 'bad' }];
  const n = eco.activeCount();
  const out: EnergyLine[] = [
    { text: n > 0 ? `${n} of ${ECO_POLICIES.length} policies running · +${eco.points().toFixed(1)} sustainability points · ${money(eco.upkeepPerDay())}/day` : 'No policy running yet: open the programme to pick some (each has a start fee and a daily cost)' },
    { text: eco.certified ? 'Carbon-neutral certificate held (+5% arrivals)' : 'Not certified yet (needs 3 policies and renewable power)', tone: eco.certified ? 'good' : '' },
  ];
  if (score !== null) out.push({ text: `Sustainability score: ${Math.round(score)} / 100` });
  return out;
}
