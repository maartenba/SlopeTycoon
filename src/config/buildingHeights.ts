/**
 * Roof / chimney / flagpole top above the footprint ground per building id (world units). Derived from the building mesh bounding boxes
 * (render/meshes buildParts) rounded up to 0.05; tests/sim/LiftClearance.test.ts keeps it >= the mesh bbox (and within 0.15). Used by lift
 * clearance (cable over a low roof) - the sim never imports the renderer.
 */
export const BUILDING_HEIGHT: Readonly<Record<string, number>> = {
  baseLodge: 2.8, lodge: 2.0, cafe: 1.45, mountainHut: 1.55, apresBar: 1.85, shop: 1.2, rental: 1.2, chalet: 1.9, apartment: 2.95,
  skiSchoolHQ: 1.85, magicCarpet: 1.1, kidsGround: 0.75, playground: 0.9, patrolHub: 1.9, firstAid: 1.2, helipad: 1.0, rangerStation: 1.55,
  groomerGarage: 1.55, liftWorkshop: 1.5, snowcatOutpost: 1.0, reservoir: 0.95, snowCannon: 1.3, boatRental: 0.85, beach: 1.25, iceRink: 1.25,
  heatedTerrace: 1.4, stuntPark: 1.15, adventurePark: 2.2, trainStation: 1.7, altiport: 1.85, shuttleDepot: 1.45, warningSign: 1.25,
  parking: 1.05, alpineFarm: 1.9, ticketOffice: 1.2, toilets: 0.9, campground: 0.7, smallHotel: 2.75, luxuryHotel: 3.1, coffeeStand: 0.95, pettingZoo: 0.75, viewpoint: 1.0, treehouse: 2.0, tackleHut: 1.15, fishingPier: 0.45, quadBase: 1.0, crag: 0.95, raftingBase: 1.0, canyoningBase: 0.94,
  solarArray: 0.5, solarPlant: 0.95, windTurbine: 3.45, smallHydro: 1.3, biomassHeating: 2.3, treeNursery: 1.0, recyclingCentre: 1.15, ecoCentre: 2.1,
};
/** Buildings taller than this (roof above ground) are never overflown by a cable: 'Cable would hit <Building>'. */
export const BUILDING_OVERFLY_MAX = 2.0;
