/**
 * Rules table (M7.1 Task 7.1.2): every building's access + altAccess + piste rule + site rules + season, generated from config into docs/placement-rules.md
 * between the `gen:rules` markers. `npm run docs:rules` (rulesTableWrite.ts) rewrites the block; tests/repo/rulesTable.test.ts fails when it is stale.
 */
import { BUILDINGS, type BuildingDef } from '../../src/config/buildings';
import { accessReason, accessSummary, isAccessReason } from '../../src/sim/PlacementRules';

const slope = (d: BuildingDef): string => (d.site.slopeKind === 'gentleSlope' ? 'gentle slope' : !Number.isFinite(d.site.maxSlope) ? 'any' : d.site.maxSlope <= 1 ? 'flat' : `≤${d.site.maxSlope}`);
const water = (d: BuildingDef): string => (d.site.onWater === 'lakeEdge' ? 'lake shore' : d.site.onWater === 'shallow' ? 'shallows' : d.streamAdjacent ? 'stream bank' : 'never');
const extra = (d: BuildingDef): string => {
  const e: string[] = [];
  const s = d.site;
  if (s.forest) e.push(`${s.forest.minTrees}+ trees within ${s.forest.radius}`);
  if (s.nearRock) e.push(`rock face within ${s.nearRock.radius}`);
  if (s.nearWaterway) e.push('river / stream within 3');
  if (s.minAltitude !== undefined) e.push(`high ground (≥${s.minAltitude})`);
  if (d.waterSource) e.push('water source');
  if (d.requires.length) e.push(`needs ${d.requires.map((r) => BUILDINGS[r]?.name ?? r).join(', ')}`);
  if (d.overRail) e.push('on rail end');
  return e.join('; ') || '–';
};

export function rulesTable(): string {
  const head = '| Building | access (alternatives) | Not-connected reason | pisteRule | slope | autoFlatten | water | rock ok | max | season | extra |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = Object.values(BUILDINGS).map((d) => {
    const reason = accessReason(d);
    if (reason && !isAccessReason(reason)) throw new Error(`${d.id}: bad access reason '${reason}'`);
    return `| ${d.name} | ${accessSummary(d)} | ${reason || '–'} | ${d.pisteRule} | ${slope(d)} | ${d.site.autoFlatten} | ${water(d)} | ${d.site.allowRock ? 'yes' : 'no'} | ${d.maxCount ?? '–'} | ${d.season} | ${extra(d)} |`;
  });
  return `${head}\n${rows.join('\n')}`;
}

export const START = '<!-- gen:rules -->';
export const END = '<!-- /gen:rules -->';
export function withRulesBlock(doc: string): string {
  const a = doc.indexOf(START), b = doc.indexOf(END);
  if (a < 0 || b < 0) throw new Error('docs/placement-rules.md lacks the gen:rules markers');
  return `${doc.slice(0, a + START.length)}\n${rulesTable()}\n${doc.slice(b)}`;
}
