/** Pure (no three / DOM) guest appearance + gear derivation. Everything is a deterministic function of (guest id, type, season / state),
 *  so nothing extra is persisted: save games keep working and a guest always looks the same. */

/** sRGB hex palettes (the renderer converts them to linear uniform arrays). */
export const SKIN_TONES = [0xf6d9c4, 0xefc7a3, 0xe0ac82, 0xc98e61, 0xa8693f, 0x8a4f2c, 0x6a3a20, 0x4a2815] as const;
export const SKIN_NAMES = ['very light', 'light', 'light-medium', 'tan', 'medium-brown', 'brown', 'dark brown', 'deep brown'] as const;
const SKIN_W = [0.15, 0.17, 0.15, 0.14, 0.12, 0.1, 0.09, 0.08];
export const HAIR_COLORS = [0x1b1512, 0x3b2417, 0x6b4226, 0xa8472a, 0xd9b66a, 0x9a9a9a, 0xe8e6e0, 0x4aa3d8] as const;
export const HAIR_NAMES = ['black', 'dark brown', 'brown', 'red', 'blonde', 'grey', 'white', 'dyed blue'] as const;
export const CLOTH_COLORS = [0xd83a34, 0xf08a24, 0xf2c14e, 0x9acd32, 0x3fa34d, 0x1fa59a, 0x3fb7e8, 0x2f6fd0, 0x1f2f6b, 0x7a46c7, 0xd63fa0, 0xf58fb0, 0xf4f4f4, 0x22252a, 0x8a9099, 0x7a5232] as const;
export const CLOTH_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'light blue', 'blue', 'navy', 'purple', 'magenta', 'pink', 'white', 'black', 'grey', 'brown'] as const;
export const BOTTOM_COLORS = [0x22252a, 0x3a3f47, 0x1f2f6b, 0x3d5f95, 0xb8a67a, 0x5d6b3a, 0x5a3d26, 0x7d838c] as const;
export const BOTTOM_NAMES = ['black', 'charcoal', 'navy', 'denim', 'khaki', 'olive', 'brown', 'grey'] as const;
/** Cloth-palette index favoured per guest type (solo, couple, family, VIP, budget, adventure): keeps the legend colours recognisable. */
const TYPE_TOP = [7, 11, 4, 2, 14, 1] as const;

/** Per-district outfit harmony: a village seed favours 5 of the 16 cloth colours (about half of the non-type-coloured guests wear one). null = off (the default; tests / gallery unchanged). */
let DISTRICT_TOPS: readonly number[] | null = null;
export function setGuestDistrict(seed: number | null): void {
  if (seed === null) { DISTRICT_TOPS = null; return; }
  const idx = Array.from({ length: 16 }, (_, i) => i).sort((a, b) => mix32(seed * 7 + a, 99) - mix32(seed * 7 + b, 99));
  DISTRICT_TOPS = idx.slice(0, 5);
}
export const HairStyle = { Bald: 0, Short: 1, Long: 2, Ponytail: 3, Bun: 4, Beanie: 5, Helmet: 6, Cap: 7, SunHat: 8 } as const;
export const HAIR_STYLE_NAMES = ['bald', 'short hair', 'long hair', 'a ponytail', 'a bun', 'a beanie', 'a helmet and goggles', 'a cap', 'a wide-brim hat'] as const;
export const Age = { Child: 0, Teen: 1, Adult: 2, Senior: 3 } as const;
export const AGE_NAMES = ['child', 'teen', 'adult', 'senior'] as const;
export const AGE_SCALE = [0.65, 0.88, 1, 0.97] as const;
export const BUILD_NAMES = ['slim', 'average', 'stocky'] as const;
export const BUILD_SCALE = [0.88, 1, 1.15] as const;
/** Share of boarders among skiing guests. */
export const BOARDER_SHARE = 0.3;

export interface Appearance {
  female: boolean; age: number; build: number; skin: number; hair: number; hairStyle: number; top: number; bottom: number; hat: number; gearColor: number;
  pack: boolean; /** Overall figure scale (age x per-guest height variation). */ scale: number;
}

/** 32-bit integer mix (murmur3 finaliser) of id and salt -> uint32. */
export function mix32(id: number, salt: number): number {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(salt + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
/** Deterministic uniform [0,1) for (id, salt). */
export const rand01 = (id: number, salt: number): number => mix32(id, salt) / 4294967296;
function pick(r: number, w: readonly number[]): number {
  let s = 0; for (const x of w) s += x;
  let t = r * s;
  for (let i = 0; i < w.length; i++) { t -= w[i]!; if (t < 0) return i; }
  return w.length - 1;
}

/** Age class from id + type; `kid` (when the family system knows) overrides it. */
export function ageOf(id: number, type: number, kid?: boolean): number {
  if (kid === true) return Age.Child;
  const r = rand01(id, 11);
  if (type === 2) return kid === false ? (r < 0.12 ? Age.Teen : Age.Adult) : r < 0.36 ? Age.Child : r < 0.46 ? Age.Teen : Age.Adult;
  if (type === 5) return r < 0.12 ? Age.Teen : Age.Adult;
  return r < 0.08 ? Age.Teen : r < (type === 4 ? 0.2 : 0.17) ? Age.Senior : Age.Adult;
}

/** Winter heads: helmet/beanie/short/ponytail; summer: cap/sun hat/hair. Females favour long hair, males short/bald. */
function hairStyleFor(id: number, female: boolean, age: number, winter: boolean): number {
  const r = rand01(id, 5);
  if (winter) {
    if (r < 0.4) return HairStyle.Helmet;
    if (r < 0.75) return HairStyle.Beanie;
    const q = (r - 0.75) / 0.25;
    return female ? (q < 0.5 ? HairStyle.Long : HairStyle.Ponytail) : q < 0.8 ? HairStyle.Short : HairStyle.Bald;
  }
  if (r < 0.22) return age === Age.Child ? HairStyle.Cap : HairStyle.SunHat;
  if (r < 0.4) return HairStyle.Cap;
  const q = (r - 0.4) / 0.6;
  if (female) return q < 0.38 ? HairStyle.Long : q < 0.65 ? HairStyle.Ponytail : q < 0.85 ? HairStyle.Bun : HairStyle.Short;
  return q < 0.75 ? HairStyle.Short : q < 0.85 ? HairStyle.Bald : HairStyle.Cap;
}

/** The appearance of a guest: stable per id; only the head-wear depends on the season. */
export function appearanceOf(id: number, type: number, winter: boolean, kid?: boolean, out: Appearance = {} as Appearance): Appearance {
  const age = ageOf(id, type, kid);
  const female = rand01(id, 1) < 0.5;
  const skin = pick(rand01(id, 2), SKIN_W);
  let hair: number;
  const hr = rand01(id, 3);
  if (age === Age.Senior) hair = hr < 0.4 ? 5 : hr < 0.8 ? 6 : hr < 0.9 ? 2 : 1;
  else if (hr > 0.97) hair = 7;
  else if (skin >= 5) hair = hr < 0.75 ? 0 : 1;
  else if (skin >= 3) hair = hr < 0.55 ? 0 : hr < 0.85 ? 1 : hr < 0.95 ? 2 : 3;
  else hair = pick(hr / 0.97, [0.14, 0.2, 0.2, 0.14, 0.26, 0.03, 0.03]);
  const typeTop = TYPE_TOP[type] ?? 7;
  const top = rand01(id, 4) < 0.45 ? typeTop : DISTRICT_TOPS && rand01(id, 14) < 0.5 ? DISTRICT_TOPS[Math.floor(rand01(id, 15) * DISTRICT_TOPS.length)]! : Math.floor(rand01(id, 6) * 16);
  out.female = female; out.age = age; out.skin = skin; out.hair = hair;
  out.build = age === Age.Child ? 1 : pick(rand01(id, 7), [0.3, 0.5, 0.2]);
  out.hairStyle = hairStyleFor(id, female, age, winter);
  out.top = top;
  out.bottom = Math.floor(rand01(id, 8) * 8);
  out.hat = (top + 3 + Math.floor(rand01(id, 9) * 9)) % 16;
  out.gearColor = Math.floor(rand01(id, 10) * 16);
  out.pack = rand01(id, 12) < 0.28;
  out.scale = AGE_SCALE[age]! * (female && age >= Age.Teen ? 0.95 : 1) * (0.96 + 0.08 * rand01(id, 13));
  return out;
}

/** Human-readable summary for inspectors, e.g. "adult woman, medium-brown skin, black hair, a beanie, red jacket, navy trousers". */
export function describeAppearance(id: number, type: number, winter = false, kid?: boolean): string {
  const a = appearanceOf(id, type, winter, kid);
  const who = a.age === Age.Child ? (a.female ? 'girl' : 'boy') : `${AGE_NAMES[a.age]} ${a.female ? 'woman' : 'man'}`;
  const hasHat = a.hairStyle >= HairStyle.Beanie;
  const head = hasHat ? `${HAIR_NAMES[a.hair]} hair, ${CLOTH_NAMES[a.hat]} ${HAIR_STYLE_NAMES[a.hairStyle]!.replace(/^an? /, '')}` : a.hairStyle === HairStyle.Bald ? 'bald' : `${HAIR_NAMES[a.hair]} hair in ${a.hairStyle === HairStyle.Short ? 'a short cut' : HAIR_STYLE_NAMES[a.hairStyle]}`;
  return `${a.build === 0 ? 'slim ' : a.build === 2 ? 'stocky ' : ''}${who}, ${SKIN_NAMES[a.skin]} skin, ${head}, ${CLOTH_NAMES[a.top]} ${winter ? 'jacket' : 't-shirt'}, ${BOTTOM_NAMES[a.bottom]} ${winter ? 'trousers' : 'shorts'}`;
}

/* ---------------------------------------------------------------- gear */
export const Gear = { Walk: 0, Hike: 1, Ski: 2, Board: 3, Bike: 4, Sit: 5, Skate: 6, Lie: 7 } as const;
export const GEAR_COUNT = 8;
export const GEAR_NAMES = ['walk', 'hike', 'ski', 'board', 'bike', 'sit', 'skate', 'lie'] as const;
/** Outfit: 0 warm (jacket, trousers, gloves), 1 summer (t-shirt, shorts), 2 swimwear. */
export const Outfit = { Warm: 0, Summer: 1, Swim: 2 } as const;
/** What a guest in the 'Using' state is doing (resolved by the host from the target building). */
export const UsingKind = { Other: 0, Rink: 1, Beach: 2 } as const;

// State / NavMode constants mirrored from sim/guests (kept literal so this module stays dependency-free; a test pins them).
const ST_RIDING = 5, ST_USING = 6, ST_INJURED = 7, ST_QUEUEING = 4;
const NM_HIKE = 1, NM_BIKE = 2, NM_SKI0 = 3;

/** Boarders vs skiers: stable per guest (~30% boards). */
export const isBoarder = (id: number): boolean => rand01(id, 21) < BOARDER_SHARE;

/** Gear/pose batch for a guest from its sim state. Skis/boards only while the movement mode is a ski mode (on snow); lifts = seated; rink = skates; beach = lying. */
export function gearFor(state: number, moveMode: number, id: number, usingKind: number = UsingKind.Other): number {
  if (state === ST_INJURED) return Gear.Lie;
  if (state === ST_RIDING) return Gear.Sit;
  if (state === ST_USING) return usingKind === UsingKind.Rink ? Gear.Skate : usingKind === UsingKind.Beach ? Gear.Lie : Gear.Walk;
  if (moveMode >= NM_SKI0) return isBoarder(id) ? Gear.Board : Gear.Ski;
  if (moveMode === NM_BIKE) return Gear.Bike;
  if (moveMode === NM_HIKE) return Gear.Hike;
  void ST_QUEUEING;
  return Gear.Walk;
}

export function outfitFor(gear: number, winter: boolean, usingBeach: boolean): number {
  if (gear === Gear.Ski || gear === Gear.Board || gear === Gear.Skate) return Outfit.Warm;
  if (gear === Gear.Lie && !winter && usingBeach) return Outfit.Swim;
  return winter ? Outfit.Warm : Outfit.Summer;
}

/* ---------------------------------------------------------------- animation parameters (pure; mirrored by the shader defines) */
export interface PoseParams {
  /** Leg/arm swing amplitude (rad), roll sway (rad), vertical bob, wheel spin factor, phase frequency per (speed*tick), animate-when-still. */
  leg: number; arm: number; sway: number; bob: number; wheel: number; freq: number; still: number;
}
export const POSE: Record<number, PoseParams> = {
  [Gear.Walk]: { leg: 0.75, arm: 0.55, sway: 0, bob: 0.012, wheel: 0, freq: 20, still: 0 },
  [Gear.Hike]: { leg: 0.6, arm: 0.4, sway: 0, bob: 0.01, wheel: 0, freq: 20, still: 0 },
  [Gear.Ski]: { leg: 0.08, arm: 0.12, sway: 0.2, bob: 0.008, wheel: 0, freq: 9, still: 0 },
  [Gear.Board]: { leg: 0, arm: 0, sway: 0.28, bob: 0.006, wheel: 0, freq: 8, still: 0 },
  [Gear.Bike]: { leg: 0.7, arm: 0.04, sway: 0.06, bob: 0.004, wheel: 14, freq: 22, still: 0 },
  [Gear.Sit]: { leg: 0.25, arm: 0, sway: 0.03, bob: 0, wheel: 0, freq: 1.2, still: 1 },
  [Gear.Skate]: { leg: 0.45, arm: 0.5, sway: 0.1, bob: 0.004, wheel: 0, freq: 9, still: 0 },
  [Gear.Lie]: { leg: 0, arm: 0, sway: 0, bob: 0, wheel: 0, freq: 0, still: 0 },
};
/** Animation phase (radians) of a guest: per-guest offset + time x speed x frequency. */
export const animPhase = (phase0: number, time: number, speed: number, freq: number): number => phase0 + time * speed * freq;
/** 0..1 "is moving" factor used to freeze limbs for stationary guests. */
export const moveFactor = (speed: number, still = 0): number => (still ? 1 : Math.min(1, Math.max(0, speed / 0.04)));
