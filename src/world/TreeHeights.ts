import { PropKind, growthFactor } from './Props';

/**
 * Pure canopy data per vegetation kind (world units, at prop scale 1, above the ground the tree stands on). Read-only mirror of the full
 * tree meshes in render/props/Trees.ts (tests/sim/LiftClearance.test.ts asserts every entry >= the mesh bounding box and within 0.1 of it),
 * kept here so the sim (lift clearance, planting rules) never imports the renderer.
 */
export interface CanopySpec { /** Top of the crown/trunk. */ height: number; /** Crown radius (horizontal). */ radius: number }

export const CANOPY: Readonly<Record<number, CanopySpec>> = {
  [PropKind.Conifer]: { height: 2.35, radius: 0.55 },
  [PropKind.Deciduous]: { height: 1.5, radius: 0.5 },
  [PropKind.Pine]: { height: 2.55, radius: 0.46 },
  [PropKind.Larch]: { height: 2.4, radius: 0.38 },
  [PropKind.Birch]: { height: 1.85, radius: 0.33 },
  [PropKind.Oak]: { height: 1.4, radius: 0.75 },
  [PropKind.Shrub]: { height: 0.46, radius: 0.34 },
  [PropKind.Snag]: { height: 1.75, radius: 0.37 },
};

/** True for kinds that count as an obstacle under a cable (all vegetation; rocks stay below the terrain clearance). */
export const isCanopyKind = (kind: number): boolean => CANOPY[kind] !== undefined;

/** Canopy top above ground of a prop right now (growth stage included). 0 for rocks. */
export function treeCanopyHeight(kind: number, scale: number, born: number, day: number): number {
  const c = CANOPY[kind];
  return c ? c.height * scale * growthFactor(born, day) : 0;
}
/** Canopy top above ground once fully grown: what planting / lift-clearance decisions use. */
export const matureCanopyHeight = (kind: number, scale: number): number => { const c = CANOPY[kind]; return c ? c.height * scale : 0; };
/** Crown radius once fully grown. */
export const matureCrownRadius = (kind: number, scale: number): number => { const c = CANOPY[kind]; return c ? c.radius * scale : 0; };
