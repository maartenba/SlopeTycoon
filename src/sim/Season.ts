import type { GameDate } from '../core/GameState';
import type { SeasonId } from '../core/events';
import {
  HEIGHT_UNIT, RESORT_BASE_ELEVATION_M, SUMMER_CONSTRUCTION_MULT, TEMP_PER_RELIEF, TILE_METRES, snowlineFraction,
} from '../config/balance';
import { VALLEY_BASE, terrainRelief } from '../world/TerrainGen';
import { seasonOf, yearFraction } from './Clock';

/** Vertical scale of a map: valley floor and total relief in world units (1 unit = TILE_METRES m). */
export interface WorldScale { baseWorld: number; reliefWorld: number }

export function worldScaleFor(size: number): WorldScale {
  return { baseWorld: VALLEY_BASE * HEIGHT_UNIT, reliefWorld: terrainRelief(size) * HEIGHT_UNIT };
}

/** Real-looking altitude in metres for a world-unit height. */
export const altitudeMetres = (worldY: number): number => Math.round(RESORT_BASE_ELEVATION_M + worldY * TILE_METRES);

/** Fractional day of year (0..360) from a date. */
export const dayFloat = (d: Pick<GameDate, 'day' | 'minute'>): number => d.day + d.minute / 1440;

/** Seasonal (weather-free) snowline in world units. `anomalyC` shifts it by a temperature anomaly (warm spell raises it). */
export function snowlineHeight(d: Pick<GameDate, 'day' | 'minute'>, scale: WorldScale, anomalyC = 0): number {
  return scale.baseWorld + scale.reliefWorld * (snowlineFraction(dayFloat(d)) + anomalyC / TEMP_PER_RELIEF);
}

/** Seasonal valley temperature (°C), before weather noise. 0 °C sits at the snowline. */
export const seasonalValleyTemp = (d: Pick<GameDate, 'day' | 'minute'>): number => TEMP_PER_RELIEF * snowlineFraction(dayFloat(d));

/** Temperature (°C) at altitude `worldY` for a valley temperature (lapse rate: TEMP_PER_RELIEF per full relief). */
export const temperatureAtAltitude = (valleyT: number, worldY: number, scale: WorldScale): number =>
  valleyT - (TEMP_PER_RELIEF * (worldY - scale.baseWorld)) / scale.reliefWorld;

export const isSummer = (d: Pick<GameDate, 'day'>): boolean => seasonOf(d) === 'summer';

/** Construction cost multiplier for a date (summer = 50 %). Wire as `economy.setSeasonHook(() => constructionMultiplierAt(game.date))`. */
export const constructionMultiplierAt = (d: Pick<GameDate, 'day'>): number => (isSummer(d) ? SUMMER_CONSTRUCTION_MULT : 1);

export const SEASON_LABELS: Record<SeasonId, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

/** Render-facing season values derived from the SIM (no three). */
export interface SeasonVisuals {
  /** Season weights position, see render/Season.ts (t in [0,1)). */
  t: number;
  /** World-y snowline (effective, with weather). */
  snowline: number;
  /** 0..1 water freeze from valley temperature. */
  freeze: number;
}

/** 0..1 freeze: fully thawed above +1 °C valley temperature, fully frozen at -5 °C. */
export function freezeFromTemp(valleyT: number): number {
  const u = Math.min(1, Math.max(0, (1 - valleyT) / 6));
  return u * u * (3 - 2 * u);
}

export { yearFraction };
