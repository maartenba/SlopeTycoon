/**
 * Landscaping (Landscape drawer): data tables. Costs are base prices; the construction multiplier (summer discount) applies on top.
 * Rules live in `sim/landscape/Landscape.ts`, tests in `tests/sim/landscape*.test.ts`. See docs/landscaping.md.
 */
export type DecorKind = 'bench' | 'lamp' | 'flowerBed' | 'hedge' | 'fence' | 'wall' | 'fountain';

export interface DecorDef {
  id: DecorKind;
  label: string;
  icon: string;
  cost: number;
  /** Row pieces take a direction (0 = along x, 1 = along y) so a drag draws an edging along a path. */
  oriented: boolean;
  /** Walk mode collides with it (see render/view/WalkMode decorCircles). */
  solid: boolean;
  blurb: string;
}

export const DECOR: Record<DecorKind, DecorDef> = {
  bench: { id: 'bench', label: 'Bench', icon: '<svg viewBox="0 0 40 28" width="44" height="31" fill="none"><g stroke="#e8d3a8" stroke-linecap="round"><path d="M6 6h28M6 11h28" stroke-width="3"/><path d="M4 17h32" stroke-width="3.5"/></g><g stroke="#2f2a28" stroke-width="2.4" stroke-linecap="round"><path d="M9 4v21M31 4v21M5 15v-3M35 15v-3M5 15h6M35 15h-6" /></g></svg>', cost: 60, oriented: true, solid: true, blurb: 'A place to sit and look at the mountain.' },
  lamp: { id: 'lamp', label: 'Lamp post', icon: '<svg viewBox="0 0 28 40" width="30" height="42" fill="none"><path d="M9 11h10l-5-8z" fill="#3a3431"/><rect x="10" y="11" width="8" height="10" rx="1" fill="#ffd98a"/><path d="M12.6 21.5 12 35M15.4 21.5 16 35" stroke="#d8d4cc" stroke-width="2" stroke-linecap="round"/><path d="M9 37h10M11 33h6" stroke="#d8d4cc" stroke-width="3" stroke-linecap="round"/></svg>', cost: 80, oriented: false, solid: true, blurb: 'Glows warm at night.' },
  flowerBed: { id: 'flowerBed', label: 'Flower bed', icon: '🌷', cost: 40, oriented: true, solid: false, blurb: 'Low, colourful, walkable.' },
  hedge: { id: 'hedge', label: 'Hedge', icon: '🌿', cost: 30, oriented: true, solid: true, blurb: 'Drag along a path to edge it.' },
  fence: { id: 'fence', label: 'Picket fence', icon: '🚧', cost: 25, oriented: true, solid: false, blurb: 'Drag along a path to edge it.' },
  wall: { id: 'wall', label: 'Stone wall', icon: '🧱', cost: 45, oriented: true, solid: true, blurb: 'Low dry-stone wall, drag to edge a path.' },
  fountain: { id: 'fountain', label: 'Fountain', icon: '⛲', cost: 600, oriented: false, solid: true, blurb: 'A showpiece for the village square.' },
};
export const DECOR_IDS = Object.keys(DECOR) as DecorKind[];

export const LANDSCAPE = {
  pond: {
    /** Per water tile + earthworks at the terrain's usual half-step price. Cheapest sensible pond (3x3, ~6 tiles) ~ $400, a 9x9 lake ~ $5,000. */
    costPerTile: 70,
    /** Filling a pond back in, per tile. */
    fillCostPerTile: 35,
    minExtent: 3,
    maxExtent: 11,
    /** Ground the pond may sit on: steepness of every footprint tile (half-steps per tile) and the corner spread (half-steps) over the whole footprint. */
    maxSlope: 1,
    maxSpread: 4,
    /** Clear distance (tiles) to other water, to buildings, to pistes / lifts. */
    waterGap: 2,
    buildingGap: 2,
    pisteGap: 2,
    liftGap: 3,
    edgeMargin: 4,
    /** Resort level that unlocks digging (config/unlocks.ts). */
    unlockId: 'pond',
  },
  rock: { cost: 25, removeCost: 12, maxPerTile: 2, maxBrush: 4, maxSlope: 2.6 },
  decor: { maxSlope: 1.6, edgeMargin: 2 },
} as const;
