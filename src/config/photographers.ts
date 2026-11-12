/**
 * Photographers (docs/photographers.md): a guest type that comes for the light. Every number here is read by `src/sim/guests/PhotoLight.ts`, `PhotoBuzz.ts`,
 * `Decision.ts` (the photo spot choice) and `GuestSim.ts` (the session). The light of a day is a pure function of (seed, day, weather): the SAME `specialSky` /
 * `fogDay` the Atmosphere layer draws (without its render-side "yesterday was wet" memory, which the simulation cannot know after a load).
 */
export const PHOTO = {
  /** Quality of a plain (not special) evening or morning inside the golden-hour window: the ordinary warm light is worth a photo, just a smaller crowd. */
  plainLight: 0.3,
  /** Arrival weight multiplier = `arrivalFloor + (1 - arrivalFloor) x 2 x light`: 0.3 off the light, about 0.8 on a plain golden hour, up to 2 on a special sky. */
  arrivalFloor: 0.3,
  /** Arrival window in hours: dusk photographers show up this long before the sunset ... */
  duskLead: [3.0, 0.5] as const,
  /** ... dawn photographers from this long before the sunrise to this long after. */
  dawnWindow: [0.5, 1.5] as const,
  /** Light windows a photographer shoots in (hours around sunrise / sunset): [before, after]. */
  duskShoot: [1.25, 0.5] as const,
  dawnShoot: [0.25, 1.25] as const,
  /** An inversion fog morning (summits clear, valleys full) is shot from sunrise + 0.25 h until this hour. */
  fogUntil: 9.5,
  /** Day guests leave at `sunset - leaveBefore`; a photographer stays until `sunset + photoStay` on a day with a usable evening light. */
  photoStay: 1.0,
  /** Excursion planning (the walk out to the viewpoint) may run until this long after the sunset: a photographer carries a head torch. */
  planUntil: 2.5,
  /** A photographer sets out this many hours before the light window, so the walk to the viewpoint ends inside it (the hike is a one-way excursion: no walk back planned). */
  walkLead: 1.5,
  /** The least light quality (0..1) that sends a photographer out; the least view score a spot needs. */
  minLight: 0.25, minView: 0.15,
  /** Spot choice: score = view x spec weight x (0.5 + 0.5 x light) - distPenalty x tiles. */
  distPenalty: 0.012,
  /** Session length in game ticks (6 game minutes each): 5 (30 min) + up to 5 more with a better shot. */
  sessionTicks: [5, 10] as const,
  /** Shots per session = shotsBase + round(quality x shotsMore). */
  shotsBase: 3, shotsMore: 4,
  /** Happiness gain of a session (x quality) on top of the viewpoint's own `viewed` gain. */
  happiness: 0.1,
  /** Photo buzz: each session adds `perSession x quality` to a decaying arrival bonus (cap `maxBuzz`, x `decayPerDay` each day): at most +4 % arrivals (the Tourist Office is a flat +6 %). */
  perSession: 0.0015, maxBuzz: 0.04, decayPerDay: 0.85,
  /** "Golden Hour" achievement: this many sessions on one special-sky day (light quality >= `goldenLight`). */
  goldenCount: 20, goldenLight: 0.6,
  /** Spots beyond the viewpoint buildings: none (a photographer goes to a Viewpoint or a Treehouse); a terrace / hut is the hot drink afterwards (`eatBonus`, `foodPrefer` of the type). */
  facets: 'viewpoint, treehouse',
} as const;
