/** Lift operations tuning: schedules, running costs, wear, inspections, breakdowns, stranded guests. Hours are game hours; 1 tick = GAME_MINUTES_PER_TICK. */
/** Global multiplier on lift running energy (docs/balance.md: energy was ~4 % of lift revenue, a real resort pays 8-15 %). */
export const ENERGY_COST_MULT = 2;
export const LIFT_OPS = {
  defaultFrom: 8.5, defaultTo: 17,
  /** Share of full upkeep paid while closed (base maintenance). */
  closedUpkeepShare: 0.15,
  /** Share of the running energy a lift draws while it is empty (no riders on the line, nobody queueing): summer lifts idle on demand. */
  idleEnergyShare: 0.35,
  /** Operating hours/day regarded as "full schedule" for upkeep. */
  nominalHours: 8,
  /** Wear (condition points) per operating hour at wearRate 1. */
  wearPerHour: 0.08,
  wearWeather: { storm: 2, heavySnow: 1.4, snow: 1.2, icing: 1.3 } as const,
  icingTemp: -8,
  /** Daily routine maintenance: condition restored (without / with a Lift Maintenance Workshop) and $ per point. */
  routineRestore: { none: 0.35, workshop: 0.8 },
  routineCostPerPoint: 4,
  /** Breakdown probability per operating hour at condition 100 (before multipliers). */
  breakdownPerHour: 0.0003,
  breakdownWeather: { storm: 3, heavySnow: 1.8, snow: 1.3, icing: 1.6 } as const,
  /** Breakdown chance multiplier while the last inspection is recent. */
  inspectionRisk: { none: 1, basic: 0.6, thorough: 0.35 } as const,
  /** Inspection interval (days), duration (hours), condition boost, base cost ($ per 100 m of lift + flat). */
  inspection: {
    basic: { everyDays: 20, hours: 3, boost: 4, cost: 60 },
    thorough: { everyDays: 10, hours: 6, boost: 10, cost: 160 },
  } as const,
  /** Without a workshop a contractor does the work: slower and dearer. */
  contractor: { timeFactor: 1.8, costFactor: 2.5, callOutHours: 4 },
  workshopTimeFactor: 0.5,
  /** Repair: base hours + hours per condition point missing; base cost + cost per missing point. */
  repair: { baseHours: 3, hoursPerPoint: 0.1, baseCost: 200, costPerPoint: 8, rushCostFactor: 1.5 },
  /** Stranded riders: they lose happiness each tick; rescue fallback (ticks) when no responder resolves in time. */
  stranded: { happinessPerTick: 0.006, selfEvacTicks: 24, selfEvacTicksNoWorkshop: 36, severeAfterTicks: 30, severeTemp: -10, severeChance: 0.2, worsenMajor: 6, worsenCritical: 14 },
} as const;
