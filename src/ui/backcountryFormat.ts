import { dangerText } from '@/sim/ops/Avalanche';
import { TILE_METRES } from '@/config/balance';
import type { BackcountryRoute } from '@/sim/ops/Backcountry';

/** European-style danger colours, level 1..5 (index 0 unused): green, yellow, orange, red, dark red. The level is always ALSO written as text. */
export const DANGER_COLORS = ['#000000', '#5fbf3f', '#f2d233', '#f28c28', '#d8362f', '#a3141f'] as const;
/** Legible-on-dark text colours for the same levels. */
export const DANGER_TEXT_COLORS = ['#ffffff', '#9be07f', '#f2d233', '#f6a04a', '#ff6a5f', '#ff8f9a'] as const;
export const DANGER_COLOR_HEX = [0x000000, 0x5fbf3f, 0xf2d233, 0xf28c28, 0xd8362f, 0xa3141f] as const;
/** Text of the confirm dialog before a route is opened at danger >= 4. */
export const OVERRIDE_CONFIRM = 'Open at danger 4? Burials possible; patrol required.';

export interface RouteInfo {
  id: number; name: string;
  danger: number; dangerText: string; color: string;
  open: boolean; closedReason?: string;
  override: boolean; globalOverride: boolean;
  tiles: number; lengthM: number;
  /** 0..100 */
  coveredPct: number;
  warnings: string[];
}

/** Pure model of the route inspector (select a backcountry tile). */
export function routeInfo(r: BackcountryRoute, globalOverride: boolean, threshold = 4): RouteInfo {
  const warnings: string[] = [];
  const coveredPct = Math.round(r.covered * 100);
  if (r.open && r.covered < 0.5) warnings.push('Outside Ski Patrol cover: build a Ski Patrol Hub nearby');
  if (r.open && r.danger >= threshold) warnings.push(`Open at danger ${r.danger}: guests can be caught in a slide`);
  return {
    id: r.id, name: r.name, danger: r.danger, dangerText: dangerText(r.danger), color: DANGER_TEXT_COLORS[r.danger] ?? DANGER_TEXT_COLORS[1],
    open: r.open, closedReason: r.closedReason, override: r.override, globalOverride,
    tiles: r.tiles.length, lengthM: Math.round(r.tiles.length * TILE_METRES), coveredPct, warnings,
  };
}
