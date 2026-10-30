import { CAL } from './balance';
/** Default price table for attractions & commercial buildings (Task 32 adds menus to edit these per building). */
export type LedgerCategory = 'lifts' | 'passes' | 'lodging' | 'shops' | 'restaurants' | 'bars' | 'recreation' | 'rental' | 'lessons' | 'grant' | 'other';
export const LEDGER_CATEGORIES: readonly LedgerCategory[] = ['lifts', 'passes', 'lodging', 'shops', 'restaurants', 'bars', 'recreation', 'rental', 'lessons', 'grant', 'other'];
/** Expense ledger categories (loan principal repayment is NOT an expense; only its interest is). */
export type ExpenseCategory = 'construction' | 'upkeep' | 'staff' | 'energy' | 'snowmaking' | 'interest' | 'marketing' | 'insurance' | 'rescue' | 'maintenance' | 'other';
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = ['construction', 'upkeep', 'staff', 'energy', 'snowmaking', 'interest', 'marketing', 'insurance', 'rescue', 'maintenance', 'other'];

/** perUse: flat per visit; perHour: price x service hours (10 ticks = 1 in-game hour); perNight: per guest per night. */
export type BillingMode = 'perUse' | 'perHour' | 'perNight';

export interface PriceEntry { price: number; max: number; billing: BillingMode; category: LedgerCategory }

export const PRICE_TABLE: Record<string, PriceEntry> = {
  baseLodge: { price: 14, max: 40, billing: 'perUse', category: 'restaurants' },
  lodge: { price: 12, max: 40, billing: 'perUse', category: 'restaurants' },
  cafe: { price: 6, max: 25, billing: 'perUse', category: 'restaurants' },
  mountainHut: { price: 9, max: 30, billing: 'perUse', category: 'restaurants' },
  heatedTerrace: { price: 8, max: 30, billing: 'perUse', category: 'restaurants' },
  /** Drinks round + snack at the Après-Ski Bar (own 'bars' ledger line). */
  apresBar: { price: 10, max: 35, billing: 'perUse', category: 'bars' },
  shop: { price: 15, max: 60, billing: 'perUse', category: 'shops' },
  rental: { price: 20, max: 80, billing: 'perUse', category: 'rental' },
  chalet: { price: 0, max: 0, billing: 'perUse', category: 'lodging' },
  apartment: { price: 0, max: 0, billing: 'perUse', category: 'lodging' },
  /** Campground: nightly pitch fee only (NIGHTLY_RATE); free to walk into. */
  campground: { price: 0, max: 0, billing: 'perUse', category: 'lodging' },
  /** Petting zoo (docs/petting-zoo.md): small entry ticket, a family summer attraction. */
  pettingZoo: { price: 8, max: 25, billing: 'perUse', category: 'recreation' },
  iceRink: { price: 6, max: 25, billing: 'perHour', category: 'recreation' },
  stuntPark: { price: 10, max: 40, billing: 'perUse', category: 'recreation' },
  adventurePark: { price: 18, max: 60, billing: 'perUse', category: 'recreation' },
  playground: { price: 3, max: 15, billing: 'perUse', category: 'recreation' },
  alpineFarm: { price: 7, max: 25, billing: 'perUse', category: 'shops' },
  beach: { price: 4, max: 20, billing: 'perUse', category: 'recreation' },
  boatRental: { price: 12, max: 40, billing: 'perHour', category: 'rental' },
  magicCarpet: { price: 2, max: 10, billing: 'perUse', category: 'recreation' },
  kidsGround: { price: 5, max: 20, billing: 'perUse', category: 'recreation' },
  mtbTrail: { price: 3, max: 15, billing: 'perUse', category: 'recreation' },
  /** Tackle & bait hut (docs/anglers.md): the day ticket / licence; rods (FISH.rodRent) and bait (FISH.bait) are fixed extras. */
  tackleHut: { price: 12, max: 30, billing: 'perUse', category: 'recreation' },
  fishingPier: { price: 0, max: 0, billing: 'perUse', category: 'recreation' },
  /** Free to use (docs/comfort.md): the entry exists so the attraction runtime has a ledger category; price 0 / max 0 = no price slider. */
  quadBase: { price: 40, max: 60, billing: 'perUse', category: 'recreation' },
  crag: { price: 30, max: 60, billing: 'perUse', category: 'recreation' },
  toilets: { price: 0, max: 0, billing: 'perUse', category: 'other' },
  hiking: { price: 0, max: 10, billing: 'perUse', category: 'recreation' },
};

/** Lodging v2 price tiers (D-P8): nightly rate multiplier against the standard rate. */
export type LodgingTier = 'budget' | 'standard' | 'luxury';
export const LODGING_TIER_MULT: Record<LodgingTier, number> = { budget: 0.6, standard: 1, luxury: 2.5 };
/** Nightly rate row for a tiered lodging type: `base` is the standard-tier rate, the cap scales with the tier too. */
export const tieredNightly = (base: { price: number; max: number }, tier: LodgingTier): { price: number; max: number } =>
  ({ price: Math.round(base.price * LODGING_TIER_MULT[tier]), max: Math.round(base.max * LODGING_TIER_MULT[tier]) });

/** Nightly rate per guest, by lodging type. */
export const NIGHTLY_RATE: Record<string, { price: number; max: number }> = {
  baseLodge: { price: 50, max: 150 },
  chalet: { price: 40, max: 150 },
  apartment: { price: 30, max: 120 },
  /** Campground (Lodging v2, budget tier): standard rate 40 x 0.6 = $24 a night, cap $90. */
  campground: tieredNightly({ price: 40, max: 150 }, 'budget'),
  /** Mountain Hut bed + half-board for trekkers. */
  mountainHut: { price: 45, max: 120 },
};

/** Share (0..100) of guests that arrive with their own ski/board and bike gear. */
export const GEAR_OWNERS = { ski: 82, bike: 60 } as const;
/** Extra wage per day for each staff member above/below the catalog requirement. */
export const STAFF_WAGE_PER_DAY = 8;

/** Lift pass prices (Task 24). Read through `Pricing.get('dayPass' | 'seasonPass')` so Task 32 menus can override. */
export const PASS_PRICES = {
  dayPass: { price: 45, max: 120 },
  /** Season pass: upfront sale, roughly 7 day passes (14 before the 180-day calendar: the season holds half the days). */
  seasonPass: { price: 600 * CAL, max: 1500 * CAL },
  /** Foot-passenger lift ticket for hikers/bikers riding a summer lift (one per day, cheaper than the ski day pass). */
  hikerPass: { price: 15, max: 60 },
} as const;
/** Season-pass holder tuning (stub; Task 35 tunes). */
export const PASS_TUNING = { holderMaxSharePct: 40, holderSpendFactor: 0.7, holderHalfSaturation: 200, returnVisitsPerPass: 0.35 } as const;
/** Staff / insurance cost tuning. */
export const INSURANCE_PER_DAY_PER_1000_VALUE = 1;

export interface LoanOfferDef { id: 'starter' | 'small' | 'medium' | 'large' | 'restructure' | 'support'; name: string; baseAmount: number; baseRatePct: number; termMonths: number }
/** Bank offers. Amounts scale with resort value/rating, rates (annual %) move with credit rating. */
export const LOAN_OFFERS: readonly LoanOfferDef[] = [
  { id: 'starter', name: 'Starter loan', baseAmount: 50000, baseRatePct: 5, termMonths: 24 },
  { id: 'small', name: 'Small loan', baseAmount: 25000, baseRatePct: 6, termMonths: 12 },
  { id: 'medium', name: 'Medium loan', baseAmount: 100000, baseRatePct: 8, termMonths: 36 },
  { id: 'large', name: 'Large loan', baseAmount: 400000, baseRatePct: 11, termMonths: 60 },
];
/**
 * One-time Tourism Board "Off-season support loan" (docs/balance.md "Gentler summer"): offered automatically at the first moment cash goes
 * negative in summer or autumn (when winter-focused resorts have no snow income); interest-free, 12 months (= one game year), at most
 * maxAmount. It ignores the debt cap; the offer lapses when winter starts; it is only ever offered once per game.
 */
export const SUPPORT_LOAN = { name: 'Off-season support loan', maxAmount: 40000, minAmount: 15000, buffer: 15000, ratePct: 0, termMonths: 12, seasons: ['summer', 'autumn'] as readonly string[] } as const;
export const LOAN_RULES = { minRatePct: 5, maxRatePct: 12, fixedDebtCap: 150000, revenueMultiple: 3, hardCap: 2000000, maxLoans: 5, bankruptcyGraceDays: Math.round(30 * CAL) } as const;
/**
 * Debt model: cash may go negative (the player decides when to give up).
 * autoBankruptcyDays: continuous days below -autoBankruptcyFloor before the bank forecloses automatically (0 = never).
 * overdraftRateMonthly: interest on a negative balance, charged at month end. ratingPenaltyMax: max rating multiplier loss while deep in debt.
 */
export const DEBT = { autoBankruptcyDays: Math.round(720 * CAL), autoBankruptcyFloor: 150000, overdraftRateMonthly: 0.015 * CAL, ratingPenaltyMax: 0.1, ratingPenaltyDays: Math.round(90 * CAL), warnEveryDays: Math.round(30 * CAL), restructureRatePct: 12, restructureTermMonths: 36 } as const;
