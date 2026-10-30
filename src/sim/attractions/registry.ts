import type { AttractionSpec } from './Attraction';
import { ANGLING_SPECS } from './Angling';
import { ADVENTURE_PARK_SPECS } from './AdventurePark';
import { BEACH_SPECS } from './Beach';
import { BOAT_RENTAL_SPECS } from './BoatRental';
import { FARM_SPECS } from './Farm';
import { HEATED_TERRACE_SPECS } from './HeatedTerrace';
import { ICE_RINK_SPECS } from './IceRink';
import { KIDS_GROUND_SPECS } from './KidsGround';
import { LODGING_SPECS } from './Lodging';
import { MAGIC_CARPET_SPECS } from './MagicCarpet';
import { PLAYGROUND_SPECS } from './Playground';
import { PETTING_ZOO_SPECS } from './PettingZoo';
import { RENTAL_SPECS } from './Rental';
import { RESTAURANT_SPECS } from './Restaurant';
import { SHOP_SPECS } from './Shop';
import { STUNT_PARK_SPECS } from './StuntPark';
import { tourSpecs } from './Tour';
import { TOILET_SPECS } from './Toilets';

/** Catalog-derived registry: building type -> runtime behaviour spec. */
export const ATTRACTION_SPECS: Readonly<Record<string, AttractionSpec>> = {
  ...RESTAURANT_SPECS, ...HEATED_TERRACE_SPECS, ...SHOP_SPECS, ...RENTAL_SPECS, ...LODGING_SPECS, ...ICE_RINK_SPECS, ...STUNT_PARK_SPECS,
  ...ADVENTURE_PARK_SPECS, ...PLAYGROUND_SPECS, ...KIDS_GROUND_SPECS, ...MAGIC_CARPET_SPECS, ...BEACH_SPECS, ...BOAT_RENTAL_SPECS, ...FARM_SPECS, ...tourSpecs(), ...TOILET_SPECS, ...ANGLING_SPECS, ...PETTING_ZOO_SPECS,
};
