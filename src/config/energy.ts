/**
 * Energy grid + green buildings (item F, docs/energy.md). Data + tuning only; the maths lives in `sim/Energy.ts`.
 *
 * Unit: **energy dollars** = what the same energy would cost from the grid (the lift / snowmaking bill is already booked in dollars). The UI shows
 * kWh = dollars / `ENERGY.gridPricePerKwh`, kW = dollars per hour / the same price.
 */

export type GeneratorKind = 'solar' | 'wind' | 'hydro' | 'biomass';

export interface GeneratorDef {
  kind: GeneratorKind;
  /** Rated output, energy dollars per hour (solar / wind: at full sun / full wind; hydro: at full flow, all 24 h; biomass: while it burns). */
  rated: number;
}

export const GENERATORS: Record<string, GeneratorDef> = {
  solarArray: { kind: 'solar', rated: 4.2 },
  solarPlant: { kind: 'solar', rated: 17 },
  windTurbine: { kind: 'wind', rated: 2.4 },
  smallHydro: { kind: 'hydro', rated: 1.5 },
  biomassHeating: { kind: 'biomass', rated: 0.4 },
};

/** Ids of every green building (generators + the nursery and the recycling centre). */
export const GREEN_BUILDINGS = ['solarArray', 'solarPlant', 'windTurbine', 'smallHydro', 'biomassHeating', 'treeNursery', 'recyclingCentre', 'ecoCentre'] as const;

export const ENERGY = {
  /** Dollars per kWh of grid power: only the unit shown to the player (1 kWh = this many energy dollars). */
  gridPricePerKwh: 0.2,
  /** The generators never cover more than this share of the day's demand (lift energy + snowmaking): energy is never free, and a flood of panels cannot zero the bill. */
  maxOffsetShare: 0.6,
  /** Surplus is not sold (the valley grid is small and the tariff is not worth the metering): it is wasted and shown as such. */
  surplusSoldShare: 0,
  solar: {
    /** Output factor of the sun's height: winter 0.72 (low sun), summer 1.0 (by `summerness`). */
    winterTilt: 0.72,
    /** Thin air: +this much at the highest terrain relative to the lowest. */
    altitudeBonus: 0.12,
    /** Weather factor on the day's cloud cover (kind -> factor; precipitation scales with intensity). */
    clear: 1, cloudy: 0.55, precip: 0.3, heavy: 0.2, storm: 0.15, fog: 0.8,
    /** A panel under snow produces this share; falling snow today is worse (it also sticks). */
    snowCovered: 0.35, snowing: 0.12, snowDepthMin: 0.04,
  },
  wind: {
    /** Wind speed index = base + exposure x altitude + gain x the weather's wind (0..0.35 normally, 1.0 in a storm). */
    base: 0, altitude: 0.3, gain: 1.0,
    /** Below cut-in nothing turns; full output from `rated`; above cut-out (storm) the turbine is feathered and shut. */
    cutIn: 0.25, rated: 0.7, cutOut: 1.0,
    /** Skyline cost: each turbine takes this off the 0..1 scenery score (+2 rating points at most), capped. */
    sceneryEach: 0.03, sceneryCap: 0.12,
  },
  hydro: {
    /** Flow factor by season (snow melt in spring, trickle in winter) and wet-weather bonus. */
    flow: { winter: 0.35, spring: 1, summer: 0.72, autumn: 0.5 } as const,
    wet: 0.2,
  },
  biomass: {
    /** Timber units: each felled tree adds `perTree`, forestry residue adds `residuePerDay`; each burned unit is worth `unitValue` energy dollars, at most `maxBurnPerDay` a day. */
    perTree: 1, residuePerDay: 1, unitValue: 7, maxBurnPerDay: 3, stockCap: 40,
  },
  nursery: {
    /** Saplings credited per day while the nursery is active; counted as planted trees ONLY while the resort has a net deficit (felled - planted). */
    saplingsPerDay: 0.35,
    /** Replanting (Plant tool) costs this share of the normal price while a nursery is active. */
    plantCostShare: 0.6,
  },
  recycling: {
    /** Flat sustainability score bonus (points of 0..100, capped so the facet never exceeds 100); more than one centre does not stack. */
    bonusPoints: 4,
  },
  /** Advisor: suggest green power when the energy part of the facet is below this and nothing renewable stands (keep: looser). */
  advisor: { energyBelow: 0.5, keepBelow: 0.6, minGuests: 25 },
} as const;
