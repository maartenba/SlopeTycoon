import { LIFTS, LIFT_KIND_IDS, type LiftKind } from '../config/lifts';
import { TILE_METRES } from '../config/balance';
import { validateLift, type LiftCheck, type LiftEnv, type StationSite, type ValidateOpts } from './Lift';

export const LIFT_KINDS: LiftKind[] = [...LIFT_KIND_IDS];
export const SNAP_RADIUS = 3; // tiles

/** Kinds (cheapest first) whose rules the given line satisfies. Funds are ignored (it's a feasibility check). */
export function validKinds(env: LiftEnv, bottom: StationSite, top: StationSite, opts: ValidateOpts = {}): LiftKind[] {
  return LIFT_KINDS.filter((k) => validateLift(env, k, bottom, top, { ...opts, skipFunds: true }).ok)
    .sort((a, b) => LIFTS[a].costPerMetre - LIFTS[b].costPerMetre);
}

/** Valid kinds whose nominal throughput (riders/hour) is at least `minPerHour`, cheapest first (variant suggestions by required capacity). */
export function kindsForThroughput(env: LiftEnv, bottom: StationSite, top: StationSite, minPerHour: number, opts: ValidateOpts = {}): LiftKind[] {
  return validKinds(env, bottom, top, opts).filter((k) => (validateLift(env, k, bottom, top, { ...opts, skipFunds: true }).stats?.throughputPerHour ?? 0) >= minPerHour);
}

export interface SnapResult {
  bottom: StationSite;
  top: StationSite;
  check: LiftCheck;
  /** True when the sites differ from the requested ones. */
  moved: boolean;
  /** Distance moved in tiles (0 when unchanged). */
  distance: number;
}

/**
 * If the requested line is invalid, look for the closest valid line by nudging the top (default) and/or bottom station
 * within `radius` tiles. Rings are searched outwards; within the first ring that has a valid site the cheapest wins.
 * Returns null when nothing nearby works.
 */
export function snapLift(
  env: LiftEnv, kind: LiftKind, bottom: StationSite, top: StationSite,
  opts: ValidateOpts & { radius?: number; adjust?: 'top' | 'bottom' | 'both' } = {},
): SnapResult | null {
  const { radius = SNAP_RADIUS, adjust = 'top', ...vo } = opts;
  const own = validateLift(env, kind, bottom, top, vo);
  if (own.ok) return { bottom, top, check: own, moved: false, distance: 0 };
  const size = env.grid.size;
  const inb = (s: StationSite): boolean => s.x >= 1 && s.y >= 1 && s.x + 2 <= size - 1 && s.y + 2 <= size - 1;
  for (let r = 1; r <= radius; r++) {
    let best: SnapResult | null = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cands: Array<[StationSite, StationSite]> = [];
      if (adjust !== 'bottom') cands.push([bottom, { x: top.x + dx, y: top.y + dy }]);
      if (adjust !== 'top') cands.push([{ x: bottom.x + dx, y: bottom.y + dy }, top]);
      for (const [b, t] of cands) {
        if (!inb(b) || !inb(t)) continue;
        const c = validateLift(env, kind, b, t, vo);
        if (!c.ok) continue;
        const total = c.cost + c.flattenCost;
        if (!best || total < best.check.cost + best.check.flattenCost) best = { bottom: b, top: t, check: c, moved: true, distance: Math.hypot(dx, dy) };
      }
    }
    if (best) return best;
  }
  return null;
}

export interface RouteFacts { lengthM: number; dropM: number; avgGradient: number }

/** Length / drop / average gradient of a checked route (null when no geometry). */
export function routeFacts(c: LiftCheck): RouteFacts | null {
  if (!c.data || !c.stats) return null;
  const drop = c.data.top.ground - c.data.bottom.ground;
  return { lengthM: c.stats.lengthM, dropM: drop * TILE_METRES, avgGradient: c.stats.gradient };
}

const names = (ks: LiftKind[]): string => ks.map((k) => LIFTS[k].name).join(', ');

/** One-line 'Why not?' summary with advice. `valid` = kinds that work for the line as requested. */
export function whyNot(kind: LiftKind, c: LiftCheck, valid: LiftKind[]): string {
  const own = LIFTS[kind].name;
  const reason = c.reasons[0] ?? 'Not valid';
  const more = c.reasons.length > 1 ? ` (+${c.reasons.length - 1} more)` : '';
  const others = valid.filter((k) => k !== kind);
  const tip = others.length ? ` Try: ${names(others)}.` : ' No lift kind fits this exact line \u2014 try another spot.';
  return `${own}: ${reason}${more}.${tip}`;
}
