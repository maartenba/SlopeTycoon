/**
 * Bridge family (Phase 6 Task 45, docs/bridges.md). Data only: `world/Bridges.ts` plans, `world/Networks.ts` stores, `render/meshes/bridges.ts` draws.
 * Rail never bridges (refused with today's message). The suspension footbridge is Phase 6.2 task 46 and is NOT part of v1.
 */
export const BRIDGE_KINDS = ['footbridge', 'hikeBridge', 'mtbBridge', 'roadBridge'] as const;
export type BridgeKind = (typeof BRIDGE_KINDS)[number];
/** Network layer a bridge carries. */
export type BridgeLayer = 'path' | 'road' | 'hike' | 'mtb';

export interface BridgeSpec {
  id: BridgeKind;
  label: string;
  layer: BridgeLayer;
  /** Longest span (tiles between the two banks, banks excluded). */
  maxSpan: number;
  /** $ per span tile (x the construction multiplier); the bank tiles are charged as ordinary path / road / trail tiles. */
  costPerTile: number;
  /** Deck clearance over the water surface / the ground of a gap, in half-steps. */
  clearance: number;
  /** Half the deck width (tiles). */
  halfWidth: number;
  /** Both banks must be flat (corner spread <= 1). */
  flatBanks: boolean;
  desc: string;
}

export const BRIDGES: Record<BridgeKind, BridgeSpec> = {
  footbridge: { id: 'footbridge', label: 'Footbridge', layer: 'path', maxSpan: 4, costPerTile: 150, clearance: 1, halfWidth: 0.27, flatBanks: false, desc: 'Timber footbridge with rails for footpaths.' },
  hikeBridge: { id: 'hikeBridge', label: 'Wooden hiking bridge', layer: 'hike', maxSpan: 4, costPerTile: 120, clearance: 1, halfWidth: 0.24, flatBanks: false, desc: 'Rustic log bridge for hiking trails (also the forest bridge for hikers).' },
  mtbBridge: { id: 'mtbBridge', label: 'MTB bridge', layer: 'mtb', maxSpan: 4, costPerTile: 140, clearance: 1, halfWidth: 0.22, flatBanks: false, desc: 'Plank deck without rails for mountain-bike trails.' },
  roadBridge: { id: 'roadBridge', label: 'Road bridge', layer: 'road', maxSpan: 3, costPerTile: 600, clearance: 2, halfWidth: 0.42, flatBanks: true, desc: 'Stone road bridge, one lane. Both banks must be flat.' },
};

/** The deck may sit at most this many half-steps above the lower bank (stairs / ramp on the bank tile). */
export const BRIDGE_MAX_RISE = 3;
/** A dry span tile counts as a gap when its lowest corner lies at least this many half-steps below BOTH banks' highest corners (a depression, not a slope). */
export const GAP_MIN_DROP = 3;

/** Exact failure texts (tool tooltips, tests). */
export const BRIDGE_MSG = {
  straight: 'Bridges must run in a straight line',
  nothing: 'Nothing to bridge: drag from one bank across water or a gap',
  tooLong: (max: number): string => `Span too long: max ${max} tiles`,
  nearBank: 'Start the bridge on solid ground: begin the drag on the near bank',
  farBank: 'Keep dragging to the far bank: a bridge needs solid ground at both ends',
  ends: 'Needs solid ground at both ends',
  flatEnds: 'Road bridges need flat ground at both ends',
  low: 'Too low over the water: the banks are lower than the deck needs',
  blocked: 'Something is in the way under the bridge',
  notGap: 'Bridges only cross water or a gap',
  rail: 'Rail cannot cross water',
} as const;
