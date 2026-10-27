/**
 * Viewpoint system (Phase 6 Task 6; docs/viewpoints.md). A building with `def.viewpoint` is a POI for hikers: it gets a view score
 * (share of lower ground around it x relative altitude), adds a bonus to the hiker goal choice (TrailGoals), a longer stop at the goal,
 * a small happiness gain and a photo-mode spot. Config only: later viewpoint / treehouse / suspension-bridge buildings just set `viewpoint`.
 */
export interface ViewpointSpec {
  /** Radius (tiles) sampled for the lower-ground share. Default VIEWPOINT.radius. */
  radius?: number;
  /** Multiplier on the goal bonus (a platform on a ridge = 1, a treehouse 0.8...). Default 1. */
  weight?: number;
  /** Extra stop at the goal in hours (scaled by the view score). Default VIEWPOINT.dwellH. */
  dwellH?: number;
  /** Listed as a photo-mode spot (default true). */
  photo?: boolean;
}

export const VIEWPOINT = {
  /** Disc radius (tiles) of the view. */
  radius: 12,
  /** Goal score bonus at view score 1 (hut bonus is 0.3, summit 0.35: a great viewpoint ranks above both). */
  poiBonus: 0.55,
  /** Viewpoint POIs always kept when the POI list is trimmed to the cap (TRAIL_GOALS.maxPois). */
  maxKept: 8,
  /** Extra stop at the goal (hours) at view score 1. */
  dwellH: 0.25,
  /** Happiness gain for a hiker who reached the viewpoint, at view score 1. */
  happiness: 0.12,
  /** Trail tile must be within this distance (tiles) of the viewpoint to serve as its goal. */
  trailReach: 6,
  /** A tile counts as 'lower' when it is at least this many altitude units below the viewpoint tile. */
  lowerMargin: 1,
  /** Photo spots look away from the higher ground; camera distance / lift of the spot orbit. */
  photoDist: 9, photoLift: 2.2, photoPitch: -0.12,
} as const;

/** Forest-around site rule defaults (treehouse): see SiteRule.forest. */
export const FOREST_SITE = { radius: 3, minTrees: 6 } as const;
