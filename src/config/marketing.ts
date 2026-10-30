import { CAL, ICE_FISHING } from './balance';
/** Marketing campaign catalog + pricing/elasticity tuning (Task 32). All constants are documented in docs/marketing-pricing.md. */
export type GuestTypeKey = 'solo' | 'couple' | 'family' | 'vip' | 'budget' | 'adventure';
export const GUEST_TYPE_KEYS: readonly GuestTypeKey[] = ['solo', 'couple', 'family', 'vip', 'budget', 'adventure'];
export type SeasonKey = 'winter' | 'spring' | 'summer' | 'autumn';
export type ScheduleProfile = 'winter' | 'shoulder' | 'summer';
export type DayClass = 'peak' | 'regular' | 'off';
export const DAY_CLASSES: readonly DayClass[] = ['peak', 'regular', 'off'];
export const SCHEDULE_PROFILES: readonly ScheduleProfile[] = ['winter', 'shoulder', 'summer'];

/** Facilities used for soft bonuses (computed by createSim from the placed buildings + rating). */
export type FacilityId = 'kids' | 'altiport' | 'luxury' | 'summer' | 'shuttle' | 'parkLift' | 'pettingZoo';
/**
 * HARD campaign prerequisites (checked by `Marketing.canStart` and again daily while a campaign runs).
 * skiSchool: active Ski School HQ · kidsArea: active Kids Ground, Playground or Magic Carpet · openLift: a lift open for business · piste: an open ski piste ·
 * parking: active Parking · dining: active restaurant / café / hut / terrace / bar · vipAccess: Altiport or luxury lodging (VIP_LODGING_MIN chalets+apartments) ·
 * rating: resort rating >= minStars · summerSeason: it is summer · summerAttraction: Adventure Park or an MTB trail · summerAccess: bike-capable lift or hiking trail · rental: active Rental.
 */
export type PrereqId = 'skiSchool' | 'kidsArea' | 'openLift' | 'piste' | 'parking' | 'dining' | 'vipAccess' | 'rating' | 'summerSeason' | 'summerAttraction' | 'summerAccess' | 'rental'
  | 'railStation' | 'stationPath' | 'stuntPark' | 'bookedFestival'
  | 'campground' | 'kidsOrZoo' | 'tackleHut' | 'water';
/**
 * Campaigns v2 (Task 50): railStation: active Train Station on a rail line that is served (Arrivals `rail.available`) · stationPath: that station is active, i.e. within
 * walking reach of the lodge/village or served by a Shuttle Depot (the Dependencies rule) · stuntPark: active Stunt Park · bookedFestival: a booked festival running or
 * starting within `FESTIVAL_CAMPAIGN.prereqDays` days (Events calendar).
 */
/**
 * Summer campaigns (Task 51): campground: an active Campground (it only takes guests in summer, the campaign is summer-only too) · kidsOrZoo: an active kids area (Kids Ground, Playground,
 * Magic Carpet) OR an active Petting Zoo (no Ski School) · tackleHut: an active Tackle & bait hut · water: a water that hut can reach holds fish stock >= `ANGLER_CAMPAIGN.minStock`.
 */
/** `label` is the sentence shown in the Requires list ('Ski School HQ'); `build` = building type the player can place to fix it; `show` = what the Show me button does when it is unmet
 *  ('build' opens the Buildings drawer on `build`, 'station' pans to the Train Station, 'events' scrolls to the Events calendar). */
export interface Prereq { id: PrereqId; label: string; build?: string; show?: 'build' | 'station' | 'events'; /** Only needed to START the campaign; not re-checked while it runs (the festival may end before the campaign does). */ startOnly?: boolean }
/** Chalets + apartments needed for the luxury branch of the VIP prerequisite (the Base Lodge does not count: every resort has one). */
export const VIP_LODGING_MIN = 2;
/** A running campaign whose prerequisites vanished is paused (effectiveness 0) and cancelled after this many days. */
export const PREREQ_GRACE_DAYS = 3;

export interface CampaignDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  /** Segment label for the UI. */
  segment: string;
  /** Upfront cost (booked to the 'marketing' expense category). */
  cost: number;
  durationDays: number;
  /** Arrival-share boost per targeted guest type: weight x (1 + boost x effectiveness). */
  targets: Partial<Record<GuestTypeKey, number>>;
  /** Overall arrival volume boost at effectiveness 1 (+X). */
  volumeBoost: number;
  /** Seasons the campaign works in; elsewhere effectiveness is multiplied by `offSeason`. */
  seasons: readonly SeasonKey[];
  offSeason: number;
  /** Hard prerequisites: all must hold to start (and to keep it running). */
  prereqs: readonly Prereq[];
  /** 'cheap' campaigns need a day pass at/below fair value; 'premium' campaigns need a pass at/above it. */
  priceAlign?: 'cheap' | 'premium';
  /** Extra effectiveness factor when a facility exists (e.g. altiport for VIPs). */
  bonus?: { id: FacilityId; factor: number };
  /** Minimum resort rating (stars) for full effect; below it effectiveness is scaled down. */
  minStars?: number;
  /** Days before the same campaign can be restarted. */
  cooldownDays: number;
  /** Campaigns v2: effect multiplier by day class (peak = weekends / holidays / powder, regular = Friday, off = Mon-Thu). Absent = 1 every day. Applied live, per day. */
  dayClassMult?: Partial<Record<DayClass, number>>;
  /** Campaigns v2: 'festival' = full effect only while a booked festival runs (or starts within `FESTIVAL_CAMPAIGN.leadDays`), `FESTIVAL_CAMPAIGN.outside` otherwise; combined arrivals stay <= ELASTICITY.maxVolume. */
  window?: 'festival';
  /** Campaigns v2: share (0..1, x effectiveness) of the arrivals that would drive that are put on the train instead (while the station has headroom). */
  railBias?: number;
  /** Summer campaigns: boost per EXTRA guest type id (config/guestTypes.ts), on top of `targets` (which are core segments): Angler's Paradise lifts anglers only. */
  extraTargets?: Readonly<Record<string, number>>;
  /** Summer campaigns: effectiveness is scaled by the mean fish stock of the huts' waters (Marketing context `fishStock`). */
  fishFactor?: boolean;
  /** Extra effectiveness factor in a season that is in `seasons` (Angler's Paradise: ice fishing in winter works at half strength). */
  seasonMult?: Partial<Record<SeasonKey, number>>;
}

/** Angler's Paradise: the hut needs a water with at least `minStock` fish; effectiveness x clamp(stock / `fullStock`, `floor`, 1); below `warnStock` the card warns "Overfished". */
export const ANGLER_CAMPAIGN = { minStock: 0.4, fullStock: 0.8, floor: 0.3, warnStock: 0.3 } as const;

/** Come by Train (`railBias`): fraction of road arrivals moved to rail at effectiveness 1, saturating at the station capacity (150 concurrent guests, buildings.ts). */
export const TRAIN_CAMPAIGN = { modeShift: 0.25, /** hard cap of the summed bias */ maxBias: 0.5 } as const;
/** Festival Season: the window around a booked festival where the campaign works in full. */
export const FESTIVAL_CAMPAIGN = { /** days before a start that already count as 'in the window' */ leadDays: 3, /** effect multiplier outside the window */ outside: 0.2, /** prerequisite: a booking within this many days */ prereqDays: 7 } as const;
/** Sustainability sub-input (Sustainability.ts): share of the last `days` days' arrivals by rail that earns the maximum, and the facet points that is worth (capped). */
export const TRAIN_SUSTAIN = { days: 14, full: 0.3, maxPoints: 3 } as const;

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'families', name: 'Families', icon: '👨‍👩‍👧', blurb: 'Family packages and kids-ski-free offers.', segment: 'Families',
    cost: 6000, durationDays: 14, targets: { family: 1.4 }, volumeBoost: 0.12, seasons: ['winter', 'summer'], offSeason: 0.5,
    prereqs: [{ id: 'skiSchool', label: 'Ski School HQ', build: 'skiSchoolHQ' }, { id: 'kidsArea', label: 'A kids area (Kids Ground, Playground or Magic Carpet)', build: 'kidsGround' }], cooldownDays: 14,
  },
  {
    id: 'budget', name: 'Budget Skiers', icon: '🎒', blurb: 'Student and bargain deals. Needs cheap passes.', segment: 'Budget skiers',
    cost: 3500, durationDays: 10, targets: { budget: 1.6, solo: 0.3 }, volumeBoost: 0.15, seasons: ['winter', 'spring', 'autumn'], offSeason: 0.5,
    prereqs: [{ id: 'openLift', label: 'An open lift' }, { id: 'piste', label: 'An open piste' }, { id: 'parking', label: 'Parking', build: 'parking' }], priceAlign: 'cheap', cooldownDays: 10,
  },
  {
    id: 'vip', name: 'VIP High-Rollers', icon: '🥂', blurb: 'Luxury travel press. Needs luxury lodging or an altiport and premium prices.', segment: 'VIP',
    cost: 12000, durationDays: 21, targets: { vip: 2.2 }, volumeBoost: 0.04, seasons: ['winter', 'autumn'], offSeason: 0.4,
    prereqs: [{ id: 'vipAccess', label: `Altiport or luxury lodging (${VIP_LODGING_MIN}+ chalets/apartments)`, build: 'altiport' }, { id: 'rating', label: 'Resort rating of 3★ or more' }, { id: 'dining', label: 'A restaurant, café or terrace', build: 'lodge' }], priceAlign: 'premium', bonus: { id: 'altiport', factor: 1.3 }, minStars: 3, cooldownDays: 30,
  },
  {
    id: 'summer', name: 'Summer Adventure Seekers', icon: '🚵', blurb: 'Bike, hike and adventure promos for summer.', segment: 'Adventure seekers',
    cost: 7000, durationDays: 21, targets: { adventure: 1.4, family: 0.4 }, volumeBoost: 0.1, seasons: ['summer'], offSeason: 0.2,
    prereqs: [{ id: 'summerSeason', label: 'Summer season' }, { id: 'summerAttraction', label: 'Adventure Park or an MTB trail', build: 'adventurePark' }, { id: 'summerAccess', label: 'A bike-capable lift or a hiking trail' }, { id: 'rental', label: 'Rental', build: 'rental' }], cooldownDays: 21,
  },
  {
    id: 'brand', name: 'Brand awareness', icon: '📣', blurb: 'A little more of everyone.', segment: 'All guests',
    cost: 2500, durationDays: 10, targets: {}, volumeBoost: 0.12, seasons: ['winter', 'spring', 'summer', 'autumn'], offSeason: 1,
    prereqs: [{ id: 'openLift', label: 'An open lift' }, { id: 'dining', label: 'A restaurant, café or terrace', build: 'lodge' }], cooldownDays: 7,
  },
  // ---- Campaigns v2, early batch (Task 50): existing buildings only. Numbers are starting points (docs/marketing-pricing.md). ----
  {
    id: 'train', name: 'Come by Train', icon: '🚆', blurb: 'Green-travel offers: cheaper trips by rail, fewer cars in the car park.', segment: 'Budget, solo and couples',
    cost: 4000, durationDays: 21, targets: { budget: 0.8, solo: 0.4, couple: 0.3 }, volumeBoost: 0.06, seasons: ['winter', 'spring', 'summer', 'autumn'], offSeason: 1,
    prereqs: [{ id: 'railStation', label: 'A Train Station on a rail line that trains can reach', build: 'trainStation', show: 'build' }, { id: 'stationPath', label: 'The station within walking reach of the lodge (or a Shuttle Depot)', show: 'station' }],
    bonus: { id: 'shuttle', factor: 1.15 }, railBias: TRAIN_CAMPAIGN.modeShift, cooldownDays: 14,
  },
  {
    id: 'parkJam', name: 'Snowboard Park Jam', icon: '🏂', blurb: 'A jam session in the Stunt Park for the freestyle crowd.', segment: 'Adventure seekers',
    cost: 5000, durationDays: 10, targets: { adventure: 1.2, solo: 0.4 }, volumeBoost: 0.08, seasons: ['winter', 'spring'], offSeason: 0.2,
    prereqs: [{ id: 'stuntPark', label: 'A Stunt Park', build: 'stuntPark', show: 'build' }, { id: 'openLift', label: 'An open lift' }, { id: 'rental', label: 'Rental', build: 'rental', show: 'build' }],
    bonus: { id: 'parkLift', factor: 1.2 }, cooldownDays: 21,
  },
  {
    id: 'hikeBike', name: 'Hike & Bike Weekends', icon: '🥾', blurb: 'Weekend trail offers for couples and walkers. A gentler sibling of the summer campaign.', segment: 'Couples and solo hikers',
    cost: 4500, durationDays: 14, targets: { couple: 0.9, solo: 0.6, family: 0.3 }, volumeBoost: 0.1, seasons: ['summer', 'autumn'], offSeason: 0.3,
    prereqs: [{ id: 'summerSeason', label: 'Summer season' }, { id: 'summerAccess', label: 'A bike-capable lift or a hiking trail' }, { id: 'dining', label: 'A restaurant, café, hut or terrace', build: 'lodge', show: 'build' }],
    dayClassMult: { peak: 1.4, regular: 0.8, off: 0.6 }, cooldownDays: 14,
  },
  {
    id: 'festival', name: 'Festival Season', icon: '🎪', blurb: 'Ride the buzz of a booked festival. Works around the festival dates only.', segment: 'Everyone',
    cost: 3000, durationDays: 10, targets: { family: 0.3, couple: 0.3 }, volumeBoost: 0.15, seasons: ['winter', 'spring', 'summer', 'autumn'], offSeason: 1,
    prereqs: [{ id: 'bookedFestival', label: `A booked festival running or starting within ${FESTIVAL_CAMPAIGN.prereqDays} days`, show: 'events', startOnly: true }], window: 'festival', cooldownDays: 30,
  },
  // ---- Summer campaigns (Task 51): ride on the Campground / Petting zoo / Tackle hut + Angler type. Numbers are starting points. ----
  {
    id: 'summerCamp', name: 'Family Summer Camp', icon: '⛺', blurb: 'Tents, a campfire and a petting zoo: a summer holiday for families.', segment: 'Families',
    cost: 6000, durationDays: 14, targets: { family: 1.6 }, volumeBoost: 0.08, seasons: ['summer'], offSeason: 0.2,
    prereqs: [{ id: 'summerSeason', label: 'Summer season' }, { id: 'campground', label: 'A Campground', build: 'campground', show: 'build' }, { id: 'kidsOrZoo', label: 'A kids area (Kids Ground, Playground, Magic Carpet) or a Petting Zoo', build: 'pettingZoo', show: 'build' }],
    priceAlign: 'cheap', bonus: { id: 'pettingZoo', factor: 1.2 }, cooldownDays: 21,
  },
  {
    id: 'angler', name: "Angler's Paradise", icon: '🎣', blurb: 'Lakeside Escape: quiet water, a tackle hut and a hot meal for anglers and couples. Needs a water with fish.', segment: 'Anglers and couples',
    cost: 3500, durationDays: 14, targets: { couple: 0.4, solo: 0.2 }, extraTargets: { angler: 1.8 }, volumeBoost: 0.05, seasons: ICE_FISHING ? ['summer', 'autumn', 'winter'] : ['summer', 'autumn'], offSeason: 0.3, seasonMult: { winter: 0.5 },
    prereqs: [{ id: 'tackleHut', label: 'A Tackle & Bait Hut', build: 'tackleHut', show: 'build' }, { id: 'water', label: `A lake, pond or river with fish (stock ${Math.round(ANGLER_CAMPAIGN.minStock * 100)}% or more) in reach of the hut` }],
    fishFactor: true, cooldownDays: 14,
  },
];

export const MARKETING = {
  maxConcurrent: 2,
  /** Diminishing returns: the i-th strongest running/tailing campaign counts stackFactor^i. */
  stackFactor: 0.6,
  /** Effect decays linearly to 0 over this many days after the campaign ends. */
  tailDays: 4,
  /** Moving-average window (days) for the baseline arrivals used to measure uplift. */
  baselineDays: 14,
  /** Rating quality factor: clamp(base + perStar x stars). */
  qualityBase: 0.6, qualityPerStar: 0.1, qualityMax: 1.1,
  /** Projected extra guests/revenue range (+/- of the central estimate). */
  previewSpread: 0.35,
  /** Kept history entries. */
  historyMax: 12,
} as const;

/** Per-type price sensitivity k: demand multiplier = exp(-k (ratio - 1)). */
export const SENSITIVITY: Record<GuestTypeKey, number> = { solo: 1.3, couple: 1.0, family: 1.2, vip: 0.4, budget: 2.2, adventure: 0.9 };
/** Share of their budget a guest type is willing to put into one ticket (replaces the old affordShare stub). */
export const AFFORD_SHARE: Record<GuestTypeKey, number> = { solo: 0.9, couple: 0.9, family: 0.85, vip: 1, budget: 0.55, adventure: 0.85 };
export const ELASTICITY = {
  /** Cheap prices cannot attract more than this multiple of normal volume (crowding cap). */
  maxVolume: 1.6,
  minVolume: 0.02,
  /** VIPs below this price ratio perceive the offer as cheap: volume scales down to vipCheapFloor. */
  vipCheapRatio: 0.6, vipCheapFloor: 0.5,
  /** Value-for-money: v = 1 / (1 + ratio^2) (0.5 at fair price). Free tickets cap at freeValueCap. */
  freeValueCap: 0.4,
  /** Fair price = default x (fairBase + fairPerStar x stars). */
  fairBase: 0.9, fairPerStar: 0.04,
} as const;

/** Day classes. Defaults of the schedule are neutral (1.0) so existing balance is unchanged until the player edits it. */
export const DEFAULT_SCHEDULE: Record<ScheduleProfile, Record<DayClass, number>> = {
  winter: { peak: 1, regular: 1, off: 1 }, shoulder: { peak: 1, regular: 1, off: 1 }, summer: { peak: 1, regular: 1, off: 1 },
};
/** Seasonal schedule bounds (multiplier). */
export const SCHEDULE_RANGE = { min: 0.5, max: 2 } as const;
/** Demand by day class (weekends/holidays/powder days are busier). */
export const DAY_CLASS_DEMAND: Record<DayClass, number> = { peak: 1.15, regular: 1, off: 0.88 };
/** Perceived fair price by day class (a peak day is worth a bit more). */
export const DAY_CLASS_FAIR: Record<DayClass, number> = { peak: 1.1, regular: 1, off: 0.92 };
/** Holiday ranges as [startDay, lengthDays] in the original 360-day year, scaled to the 180-day year (CAL). */
export const HOLIDAYS: ReadonlyArray<readonly [number, number]> = ([[350, 10], [0, 5], [285, 7], [150, 30]] as const).map(([s, n]) => [Math.round(s * CAL), Math.max(1, Math.round(n * CAL))] as const);
export const POWDER = { minIntensity: 0.5, surcharge: 1.2 } as const;
/** Price-shock: a day-to-day jump bigger than this fraction triggers a shock that decays by shockDecay per day. */
export const SHOCK = { threshold: 0.35, decay: 0.7, valuePenalty: 0.3, volumePenalty: 0.2 } as const;

export interface PriceKeyInfo { key: string; label: string; group: 'lifts' | 'attractions' | 'lodging' | 'food' | 'markup' }
export const PRICE_KEY_INFO: readonly PriceKeyInfo[] = [
  { key: 'dayPass', label: 'Day pass', group: 'lifts' },
  { key: 'seasonPass', label: 'Season pass', group: 'lifts' },
  { key: 'iceRink', label: 'Ice rink (per hour)', group: 'attractions' },
  { key: 'stuntPark', label: 'Stunt park', group: 'attractions' },
  { key: 'adventurePark', label: 'Adventure park', group: 'attractions' },
  { key: 'playground', label: 'Playground', group: 'attractions' },
  { key: 'kidsGround', label: 'Kids ground', group: 'attractions' },
  { key: 'magicCarpet', label: 'Magic carpet', group: 'attractions' },
  { key: 'beach', label: 'Beach', group: 'attractions' },
  { key: 'boatRental', label: 'Boat rental (per hour)', group: 'attractions' },
  { key: 'mtbTrail', label: 'MTB trail pass', group: 'attractions' },
  { key: 'rental', label: 'Gear rental', group: 'attractions' },
  { key: 'night:baseLodge', label: 'Base lodge room / night', group: 'lodging' },
  { key: 'night:chalet', label: 'Chalet / night', group: 'lodging' },
  { key: 'night:apartment', label: 'Apartment / night', group: 'lodging' },
  { key: 'baseLodge', label: 'Base lodge meal', group: 'food' },
  { key: 'lodge', label: 'Lodge restaurant meal', group: 'food' },
  { key: 'cafe', label: 'Cafe', group: 'food' },
  { key: 'mountainHut', label: 'Mountain hut', group: 'food' },
  { key: 'heatedTerrace', label: 'Heated terrace', group: 'food' },
  { key: 'apresBar', label: 'Après-Ski Bar (drinks)', group: 'food' },
  { key: 'shop', label: 'Shop item', group: 'food' },
  { key: 'alpineFarm', label: 'Alpine farm', group: 'food' },
  { key: 'markup:restaurants', label: 'Restaurant menu markup %', group: 'markup' },
  { key: 'markup:shops', label: 'Shop markup %', group: 'markup' },
];
export const MARKUP = { default: 100, min: 60, max: 160, restaurants: { cheap: 75, standard: 100, premium: 135 } } as const;
