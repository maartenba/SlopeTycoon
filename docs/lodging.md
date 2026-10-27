# Lodging v2 (tiers, seasonal opening, amenities)

Framework for the lodging rows that arrive later (campground, small hotel, luxury hotel). Chalet, Apartment and Base Lodge are **unchanged** (no `tier`, no `seasonOpen`, no `amenity`: bit-identical, goldens untouched). `RoomBook` serialisation is unchanged.

Code: optional fields on `AttractionSpec` (`src/sim/attractions/Attraction.ts`), helpers in `src/sim/attractions/Lodging.ts` and `src/config/prices.ts`, behaviour in `AttractionSystem`.

| Field | Meaning |
|---|---|
| `tier` | `'budget' \| 'standard' \| 'luxury'`. Nightly rate x0.6 / x1 / x2.5 (`LODGING_TIER_MULT`, D-P8). |
| `seasonOpen` | Seasons in which it takes guests. Outside: `open = false`, reason **"Closed for the season"**, no check-ins, not counted in `lodgingCapacity()`. |
| `amenity: 'pool'` | `poolSlots` extra simultaneous `Using` places (overnight guests only, like all lodging) and `poolHappiness` (default 0.06) added per visit. |

## How to author a tiered row
1. Rate: `NIGHTLY_RATE.<type> = tieredNightly({ price: 40, max: 150 }, 'luxury')` (price and cap scale; Pricing key `night:<type>` picks it up).
2. Appeal: `appeal: tierAppeal(base, 'luxury')` (`TIER_APPEAL_SHIFT`: luxury +0.4 VIP / +0.1 couple / -0.25 budget; budget +0.3 budget / -0.3 VIP / -0.05 couple; clamped 0..1).
3. Spec: `{ kind: 'lodging', overnightOnly: true, rooms, tier, seasonOpen?, amenity?, poolSlots? ... }` in `LODGING_SPECS`, plus a `buildings.ts` row (`access` per the access table).
4. `VIP_LODGING_MIN` (marketing) still counts only chalets/apartments until the hotel rows land (Task 27 extends it).

Tests: `tests/sim/attractions/Lodging.test.ts` ("lodging v2": tier prices, appeal shift, season closure and reopening, pool slots and bonus; they register throw-away building types and remove them afterwards).
