import type * as THREE from 'three';
import type { LiftKind } from '../../../config/lifts';
import { LIFT_STATION_SIZE } from '../../../config/balance';
import { PartBuilder, type SignSpec } from '../common';
import { finishWithSign } from './geo';
import { STATION_DESIGNS } from './stations';
import { midStationDesign } from './midStation';
import { LIFTS, normalizeLiftKind } from '../../../config/lifts';
import { SB } from './stationKit';

export interface StationParts { geometry: THREE.BufferGeometry; sign: SignSpec | null }

/**
 * Station building, local origin = footprint centre at ground level, local +z = the line direction (bottom station faces up the
 * line; the top station is mirrored so its back lies beyond the cable end). Each lift kind has its own design (see stations.ts).
 */
export function buildStationParts(kind: LiftKind, isTop: boolean): StationParts {
  const b = new PartBuilder(LIFT_STATION_SIZE, LIFT_STATION_SIZE);
  const design = STATION_DESIGNS[kind];
  if (!design) throw new Error(`No station design for '${kind}'`);
  design(new SB(b, isTop));
  const out = finishWithSign(b);
  out.geometry.userData.meshInfo = { kind, role: isTop ? 'top' : 'bottom' };
  return out;
}

export function buildStationGeometry(kind: LiftKind, isTop: boolean): THREE.BufferGeometry {
  return buildStationParts(kind, isTop).geometry;
}

/** Pass-through mid-station of an N-station lift (docs/mid-stations.md): symmetric along the line, themed per lift family. */
export function buildMidStationParts(kind: LiftKind): StationParts {
  const b = new PartBuilder(LIFT_STATION_SIZE, LIFT_STATION_SIZE);
  midStationDesign(LIFTS[normalizeLiftKind(kind)].family)(new SB(b, false));
  const out = finishWithSign(b);
  out.geometry.userData.meshInfo = { kind, role: 'mid' };
  return out;
}
