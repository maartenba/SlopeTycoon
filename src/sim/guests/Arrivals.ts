import { BUILDINGS } from '../../config/buildings';
import { Mode } from './Guest';
import type { GuestWorld, Pt, Rect, WorldBuilding } from './GuestWorld';

export const MODE_NAMES = ['road', 'rail', 'air'] as const;
/** Concurrent guests per unit of capacity (parking spaces hold cars of ~2.5 guests). */
export const GUESTS_PER_PARKING_SPACE = 2.5;
export const WALKIN_ROAD_CAPACITY = 30; // road connected to the Base Lodge but no Parking: drop-off only

export interface ArrivalPoint {
  mode: number;
  available: boolean;
  reason?: string;
  /** Concurrent-guest capacity for this mode. */
  capacity: number;
  /** Destination buildings (parking/bus depot/base lodge, station, altiport). */
  destinations: WorldBuilding[];
  /** Where vehicles enter the map. */
  entry: Pt | null;
}

export interface ArrivalReport {
  road: ArrivalPoint; rail: ArrivalPoint; air: ArrivalPoint;
  any: boolean;
  /** HUD text when nothing can arrive; '' otherwise. */
  message: string;
}

const cap = (type: string): number => BUILDINGS[type]?.capacity ?? 0;

/**
 * Which arrival modes work right now. Station/altiport modes need the building to be ACTIVE (the Dependencies shuttle /
 * walking-radius rule already folded into `active`) and, for rail, to be served by rail from the rail entry. Road needs a road
 * entry plus Parking (or the Base Lodge/Bus Depot on the connected road).
 */
export function evaluateArrivals(w: GuestWorld): ArrivalReport {
  const bs = [...w.buildings()];
  const ofType = (t: string): WorldBuilding[] => bs.filter((b) => b.type === t);
  const roadEntry = w.roadEntry();

  // Road
  const road: ArrivalPoint = { mode: Mode.Road, available: false, capacity: 0, destinations: [], entry: roadEntry };
  if (!roadEntry) road.reason = 'No parking/road access';
  else {
    const parking = ofType('parking').filter((b) => b.active && w.isRoadServed(b.id));
    const depots = ofType('shuttleDepot').filter((b) => b.active && w.isRoadServed(b.id));
    const lodge = ofType('baseLodge').filter((b) => b.active && w.isRoadServed(b.id));
    if (parking.length) {
      road.capacity = parking.length * cap('parking') * GUESTS_PER_PARKING_SPACE;
      road.destinations = [...parking, ...depots];
    } else if (lodge.length) {
      road.capacity = WALKIN_ROAD_CAPACITY;
      road.destinations = lodge;
    }
    road.available = road.destinations.length > 0;
    if (!road.available) road.reason = 'No parking/road access';
  }

  // Rail
  const rail: ArrivalPoint = { mode: Mode.Rail, available: false, capacity: 0, destinations: [], entry: w.railEntry() };
  const station = ofType('trainStation')[0];
  if (!station) rail.reason = 'No Train Station';
  else if (!station.active) rail.reason = station.reason ?? 'Train Station inactive';
  else if (!rail.entry || !w.isRailServed(station.id)) rail.reason = 'Train Station not connected by rail';
  else { rail.available = true; rail.capacity = cap('trainStation'); rail.destinations = [station]; }

  // Altiport
  const air: ArrivalPoint = { mode: Mode.Air, available: false, capacity: 0, destinations: [], entry: null };
  const port = ofType('altiport')[0];
  if (!port) air.reason = 'No Altiport';
  else if (!port.active) air.reason = port.reason ?? 'Altiport inactive';
  else { air.available = true; air.capacity = cap('altiport'); air.destinations = [port]; }

  const any = road.available || rail.available || air.available;
  return { road, rail, air, any, message: any ? '' : (road.reason ?? 'No parking/road access') };
}

/** Polyline vehicle (car/bus/train/plane) moving along tile coordinates; guests materialise when it arrives. */
export interface Vehicle {
  id: number;
  /** 0 car, 1 bus, 2 train, 3 plane */
  kind: number;
  mode: number;
  /** Flat x,y pairs (tile coords, tile centres). */
  pts: number[];
  /** Cumulative length at each point. */
  cum: number[];
  dist: number;
  speed: number;
  /** Guest types riding along. */
  riders: number[];
  group: number;
  dest: number;
  /** Plane approach height above destination at the start. */
  alt: number;
}

export const VehicleKind = { Car: 0, Bus: 1, Train: 2, Plane: 3 } as const;
export const VEHICLE_SPEED = [5, 3.75, 7.5, 12.5] as const;
/**
 * Arrival trips are size independent: a vehicle never spends more than VEHICLE_MAX_TRIP_TICKS (6 ticks = 36 game minutes) on its way
 * to the destination. Routes longer than VEHICLE_MAX_ROUTE_TILES are joined that many tiles from the destination ("teleport" from
 * the map edge), and the remaining distance is driven at least fast enough to fit the time cap (speed floor = VEHICLE_SPEED).
 */
export const VEHICLE_MAX_TRIP_TICKS = 6;
export const VEHICLE_MAX_ROUTE_TILES = 30;

/** Initial travelled distance and speed for a vehicle on a route of `total` tiles. */
export function tripPlan(total: number, baseSpeed: number): { dist: number; speed: number } {
  const dist = Math.max(0, total - VEHICLE_MAX_ROUTE_TILES);
  return { dist, speed: Math.max(baseSpeed, (total - dist) / VEHICLE_MAX_TRIP_TICKS) };
}

export function makeCum(pts: number[]): number[] {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1]! + Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!));
  return cum;
}

/** Position and heading at travelled distance `d` along the vehicle's polyline. */
export function vehiclePose(v: Pick<Vehicle, 'pts' | 'cum'>, d: number, out: { x: number; y: number; heading: number } = { x: 0, y: 0, heading: 0 }): { x: number; y: number; heading: number } {
  const n = v.cum.length;
  if (n === 1) { out.x = v.pts[0]!; out.y = v.pts[1]!; return out; }
  const total = v.cum[n - 1]!;
  const dd = Math.min(Math.max(d, 0), total);
  let k = 1;
  while (k < n - 1 && v.cum[k]! < dd) k++;
  const a = k - 1, seg = v.cum[k]! - v.cum[a]!, t = seg > 0 ? (dd - v.cum[a]!) / seg : 1;
  const ax = v.pts[a * 2]!, ay = v.pts[a * 2 + 1]!, bx = v.pts[k * 2]!, by = v.pts[k * 2 + 1]!;
  out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t; out.heading = Math.atan2(bx - ax, by - ay);
  return out;
}

export const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const DX4 = [0, 1, 0, -1], DY4 = [-1, 0, 1, 0];

/**
 * BFS over tiles of one network kind (2 = road, 3 = rail) from `from` to a tile adjacent to `to`'s footprint.
 * Returns tile-centre points (flat-mapped by the caller) or [] when unreachable. Only existing network tiles are used.
 */
export function routeOnKind(kind: ArrayLike<number>, size: number, netKind: number, from: Pt, to: Rect, cross?: ArrayLike<number>): Pt[] {
  const s = from.y * size + from.x;
  if (from.x < 0 || from.y < 0 || from.x >= size || from.y >= size || kind[s] !== netKind) return [];
  /** A road runs over a road level crossing (a rail tile with cross 2); rail already runs on its own tiles. */
  const ok = (i: number): boolean => kind[i] === netKind || (netKind === 2 && cross !== undefined && kind[i] === 3 && (cross[i] === 2 || cross[i] === 5));
  const prev = new Int32Array(size * size).fill(-2);
  prev[s] = -1;
  const q = [s];
  const adj = (x: number, y: number): boolean => x >= to.x - 1 && x <= to.x + to.w && y >= to.y - 1 && y <= to.y + to.h && !(x >= to.x && x < to.x + to.w && y >= to.y && y < to.y + to.h) && (x >= to.x && x < to.x + to.w || y >= to.y && y < to.y + to.h);
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % size, y = (i / size) | 0;
    if (adj(x, y)) {
      const out: Pt[] = [];
      for (let c = i; c !== -1; c = prev[c]!) out.push({ x: c % size, y: (c / size) | 0 });
      return out.reverse();
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k]!, ny = y + DY4[k]!;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (prev[ni] !== -2 || !ok(ni)) continue;
      prev[ni] = i; q.push(ni);
    }
  }
  return [];
}
