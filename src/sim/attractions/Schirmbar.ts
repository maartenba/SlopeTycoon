import { SCHIRMBAR, SCHIRMBAR_REASON } from '../../config/schirmbar';
import type { SeasonId, WeatherKind } from '../../core/events';

export interface SchirmbarInput {
  season: SeasonId;
  weather: { kind: WeatherKind; wind: number; fog: number };
  /** The player's Closed switch. */
  playerClosed: boolean;
}
export interface SchirmbarVerdict { open: boolean; reason?: string }

/**
 * The ONE open / closed rule of the Schirmbar (docs/schirmbar.md). Order of reasons: the player's switch, the season, then the weather
 * (storm, heavy snow, rain, high wind, fog). Clear, cloudy and light snow are good enough. Pure: no state, no RNG.
 */
export function schirmbarStatus(i: SchirmbarInput): SchirmbarVerdict {
  if (i.playerClosed) return { open: false, reason: SCHIRMBAR_REASON.player };
  if (i.season !== 'winter') return { open: false, reason: SCHIRMBAR_REASON.season };
  const w = i.weather;
  if (w.kind === 'storm') return { open: false, reason: SCHIRMBAR_REASON.storm };
  if (w.kind === 'heavySnow') return { open: false, reason: SCHIRMBAR_REASON.heavySnow };
  if (w.kind === 'rain') return { open: false, reason: SCHIRMBAR_REASON.rain };
  if (w.wind > SCHIRMBAR.maxWind) return { open: false, reason: SCHIRMBAR_REASON.wind };
  if (w.fog >= SCHIRMBAR.maxFog) return { open: false, reason: SCHIRMBAR_REASON.fog };
  return { open: true };
}

/** Does a skier on pass number `runs` (guest `id`) take the stop? Stateless hash, 1 pass in `SCHIRMBAR.oneIn`. */
export function schirmbarStop(id: number, runs: number): boolean {
  const hh = Math.imul(id ^ 0x51c3a97d, 0x85ebca6b) ^ Math.imul(runs + 13, 0xc2b2ae35);
  return ((hh ^ (hh >>> 15)) >>> 0) % SCHIRMBAR.oneIn === 0;
}
