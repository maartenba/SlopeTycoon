import type { PoiKind } from './DemoCamera';

export interface PoiSpec { kind: PoiKind; id: string; at: { x: number; z: number }; /** visible tiles at the wide / close framing */ view: [number, number]; weight: number }

/** Named site (from `townSites`) -> the POI kind it produces, its framing and default weight. */
const SITE_POI: Record<string, { kind: PoiKind; view: [number, number]; weight: number }> = {
  farm: { kind: 'farm', view: [18, 11], weight: 2.5 }, hut: { kind: 'hut', view: [16, 9], weight: 1.5 }, beach: { kind: 'beach', view: [18, 10], weight: 2 },
  boat: { kind: 'beach', view: [18, 10], weight: 1.2 }, station: { kind: 'train', view: [18, 11], weight: 1.5 }, altiport: { kind: 'altiport', view: [22, 12], weight: 2 },
  heli: { kind: 'heli', view: [16, 9], weight: 2 }, festival: { kind: 'festival', view: [16, 9], weight: 2 }, terrace: { kind: 'festival', view: [16, 9], weight: 1.2 },
  adventure: { kind: 'adventure', view: [18, 10], weight: 1.6 }, stunt: { kind: 'adventure', view: [18, 10], weight: 1.6 }, ranger: { kind: 'hut', view: [16, 9], weight: 1 },
  rink: { kind: 'festival', view: [16, 9], weight: 1 }, bus: { kind: 'train', view: [18, 11], weight: 1 },
};

/** Per-archetype pick-weight multipliers: the camera lingers on what makes the town special. */
const FOCUS: Record<string, Partial<Record<PoiKind, number>>> = {
  alpine: { farm: 1.4, hut: 1.3 }, family: { festival: 1.5 }, luxury: { altiport: 2, lift: 1.3, carrier: 1.3 }, hiking: { farm: 1.4, beach: 1.4, hut: 1.5, adventure: 1.5 },
  lakeside: { beach: 2.2, lake: 1.8 }, fortress: { cat: 1.6, adventure: 1.6, piste: 1.3 }, bigmountain: { train: 1.5, lift: 1.4, carrier: 1.5 }, hamlet: { hut: 2.2, animal: 2.2, farm: 1 },
  festival: { festival: 2.5 }, rescue: { heli: 2.5, hut: 1.2 },
};

/** Pure: the extra POIs for the sites a town has, weighted for its archetype. Missing sites simply produce nothing. */
export function townPoiSpecs(archetype: string, sites: Record<string, { x: number; y: number }>): PoiSpec[] {
  const focus = FOCUS[archetype] ?? {};
  const out: PoiSpec[] = [];
  for (const [name, p] of Object.entries(sites)) {
    const s = SITE_POI[name];
    if (!s) continue;
    out.push({ kind: s.kind, id: `site-${name}`, at: { x: p.x, z: p.y }, view: s.view, weight: s.weight * (focus[s.kind] ?? 1) });
  }
  return out;
}

/** Weight multiplier for the generic POI kinds (lake, animal, cat ...) of an archetype. */
export const poiFocus = (archetype: string, kind: PoiKind): number => FOCUS[archetype]?.[kind] ?? 1;
