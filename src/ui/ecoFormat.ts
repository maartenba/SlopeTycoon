import { ECO, ECO_POLICIES, type EcoPolicyDef } from '@/config/eco';
import { SUSTAIN } from '@/config/rivals';
import { TRAIN_SUSTAIN } from '@/config/marketing';
import type { EcoCertView, EcoPolicyView } from '@/sim/meta/Eco';
import type { SustainParts } from '@/sim/meta/Sustainability';

/** One line of the sustainability breakdown: points now, the most it can give, and what would raise it. */
export interface EcoPart { id: string; label: string; points: number; max: number; tip: string }
export interface EcoPolicyRow { def: EcoPolicyDef; view: EcoPolicyView }
export interface EcoModel {
  /** An Eco Centre works (policies can be switched). */
  enabled: boolean;
  score: number | null;
  parts: EcoPart[];
  policies: EcoPolicyRow[];
  cert: EcoCertView;
  /** Eco term of the facet now / at most; running cost per day now / with everything on. */
  ecoPoints: number; ecoMax: number; perDay: number; perDayAll: number;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;
export const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** Breakdown of the facet by part (weights x 100 = the points each part can give; bonuses on top; the total is capped at 100). */
export function ecoParts(p: SustainParts | null, ecoPoints: number): EcoPart[] {
  const w = SUSTAIN.weights, k = (x: number): number => r1(100 * x);
  const r = p?.raw;
  return [
    { id: 'energy', label: 'Energy per guest', points: p ? r1(k(w.energy) * p.energy) : 0, max: k(w.energy), tip: 'Dollars of lift and snowmaking energy per guest. Raise it with solar, wind or hydro power, closing idle lifts, fewer cannons, smart snowmaking.' },
    { id: 'trees', label: 'Trees', points: p ? r1(k(w.trees) * p.trees) : 0, max: k(w.trees), tip: 'Forest felled minus trees planted. Replant with the Plant tool, build a Tree Nursery or run the habitat policy.' },
    { id: 'habitat', label: 'Wildlife habitat', points: p ? r1(k(w.habitat) * p.habitat) : 0, max: k(w.habitat), tip: 'Portion of forest habitat covered by pistes, paths and buildings. Build on open ground; trained rangers halve the overlap.' },
    { id: 'bonus', label: 'Recycling & rail', points: r1((r?.bonus ?? 0) + (r?.train ?? 0)), max: 4 + TRAIN_SUSTAIN.maxPoints, tip: 'A Recycling & Compost Centre (+4) and the share of guests arriving by train (up to +3).' },
    { id: 'eco', label: 'Eco programme', points: r1(ecoPoints), max: ECO.maxPoints, tip: 'Policies funded at the Eco Centre plus the carbon-neutral certificate. The total score never exceeds 100.' },
  ];
}

export function ecoModel(i: { enabled: boolean; parts: SustainParts | null; policies: EcoPolicyView[]; cert: EcoCertView; ecoPoints: number; perDay: number }): EcoModel {
  return {
    enabled: i.enabled, score: i.parts ? i.parts.score : null, parts: ecoParts(i.parts, i.ecoPoints),
    policies: ECO_POLICIES.map((def) => ({ def, view: i.policies.find((v) => v.id === def.id)! })),
    cert: i.cert, ecoPoints: i.ecoPoints, ecoMax: ECO.maxPoints,
    perDay: i.perDay, perDayAll: ECO_POLICIES.reduce((a, d) => a + d.perDay, 0) + ECO.cert.perDay,
  };
}

export const policyCostLine = (d: EcoPolicyDef): string => `Start ${fmtMoney(d.fee)} · ${fmtMoney(d.perDay)}/day · +${d.points} points`;
