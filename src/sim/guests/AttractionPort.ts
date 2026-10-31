import type { WorldBuilding } from './GuestWorld';

/** What the guest decision logic needs to know about attractions (implemented by sim/attractions/AttractionSystem). */
export interface DecisionPort {
  /** Open, active and staffed (true for buildings the port does not manage). */
  accepts(buildingId: number): boolean;
  /** Food / drink venues only: inside serving hours (08:00 - 23:00). Absent / true for everything else. */
  serving?(buildingId: number): boolean;
  /** Type rules, e.g. lodging only serves overnight guests. */
  canUse(buildingId: number, guestSlot: number): boolean;
  queueLength(buildingId: number): number;
  unitPrice(buildingId: number): number;
  /** Guest lacks ski/board or bike gear (needs a rental visit first). */
  needsGear(guestId: number, kind: 'ski' | 'bike'): boolean;
  /** Rental stock (docs/rental.md): a unit of the guest's kind is left to rent (absent = unlimited). */
  gearAvailable?(guestId: number, kind: 'ski' | 'bike'): boolean;
  /** The guest wanted gear but there was none left (shortage counter). */
  gearShort?(guestId: number): void;
  /** Preference 0..1 of a guest type (GuestType) for this building. */
  appeal(buildingId: number, guestType: number): number;
  /** Trekker beds free in a Mountain Hut (undefined = port without beds). */
  bedsFree?(buildingId: number): number;
}

/** 'using' = the guest is now in the attraction (state Using); 'handled' = refused/balked; 'unhandled' = not an attraction. */
export type ArriveResult = 'using' | 'handled' | 'unhandled';

export interface GuestAttractionPort extends DecisionPort {
  arrive(slot: number, b: WorldBuilding, tick: number): ArriveResult;
  trail(slot: number, kind: 'hike' | 'bike', tick: number): void;
  /** Trekker beds (Mountain Hut): free beds (0 when closed / none), booking, release, and the paid check-in on arrival. */
  reserveBed?(guestId: number, buildingId: number): boolean;
  releaseBed?(guestId: number): void;
  checkInBed?(slot: number, buildingId: number): boolean;
}
