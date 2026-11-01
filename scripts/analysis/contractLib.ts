/**
 * Building contract (M7.1, docs/economy-audit.md): ONE data-driven check of every building / lift / campaign / guest-type row.
 * Used by tests/repo/buildingContract.test.ts (fails with the full table) and `npm run analysis:contract` (prints it).
 * A "problem" is a plain sentence; an empty list = the row honours the contract.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDINGS, type BuildingDef } from '../../src/config/buildings';
import { BUILDING_HEIGHT } from '../../src/config/buildingHeights';
import { LIFTS } from '../../src/config/lifts';
import { CAMPAIGNS } from '../../src/config/marketing';
import { SHIPPED_TYPES } from '../../src/config/guestTypes';
import { ALWAYS_AVAILABLE, UNLOCKS, key } from '../../src/config/unlocks';
import { BUILDING_DESCRIPTIONS, BUILDING_ICONS, LIFT_DESCRIPTIONS, LIFT_ICONS, buildingInfo } from '../../src/ui/buildInfo';
import { accessReason, describeRules, isAccessReason } from '../../src/sim/PlacementRules';
import { BUILDING_BUILDERS, buildParts } from '../../src/render/meshes';
import { createSim, type Sim } from '../../src/game/createSim';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { bulldoze, refundValue } from '../../src/build/Bulldoze';
import { findSite } from '../../src/tutorial/suggest';
import { allGenerated } from '../site/generated';

export interface ContractRow { kind: 'building' | 'lift' | 'campaign' | 'guestType'; id: string; problems: string[] }

const ROOT = process.cwd();
const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&amp;/g, '&').replace(/[’']/g, "'");

let corpus: string | null = null;
/** The player guide text: every site/guide/*.md plus the generated tables (lifts, campaigns, unlocks ...). */
export function guideText(): string {
  if (corpus !== null) return corpus;
  const dir = join(ROOT, 'site', 'guide');
  const parts = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(dir, f), 'utf8'));
  // the 'buildings' reference table lists every building by construction: it does not count as a prose mention
  const { buildings: _all, ...gens } = allGenerated();
  void _all;
  parts.push(...Object.values(gens));
  corpus = norm(parts.join('\n'));
  return corpus;
}
/** Name variants a guide may use for an item ('Lodge/Restaurant' -> lodge, restaurant; 'Tackle & Bait Hut' -> 'tackle and bait hut'). */
export function nameVariants(name: string): string[] {
  const n = norm(name);
  const v = new Set<string>([n, n.replace(/ & /g, ' and '), n.replace(/-/g, ' ')]);
  if (n.includes('/')) for (const p of n.split('/')) v.add(p.trim());
  return [...v];
}
export const guideMentions = (name: string, id?: string): boolean => {
  const g = guideText();
  return nameVariants(name).some((v) => g.includes(v)) || (id !== undefined && g.includes(norm(id)));
};

const srcCache = new Map<string, string>();
const read = (rel: string): string => { let s = srcCache.get(rel); if (s === undefined) { s = readFileSync(join(ROOT, rel), 'utf8'); srcCache.set(rel, s); } return s; };
const walk = (dir: string, ext: RegExp): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), ext) : ext.test(e.name) ? [join(dir, e.name)] : []));

/** Where a building is taught / suggested / required: Advisor rules, goals, tutorial steps, campaign prerequisites, scenarios, bot wish lists, Rudi hints. */
export function touchpoints(id: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`['"\`]${id}['"\`]`);
  const scan: Array<[string, string[]]> = [
    ['advisor', walk('src/sim/advisor', /\.ts$/)], ['goals', ['src/config/goals.ts', ...walk('src/sim/goals', /\.ts$/)]], ['tutorial', walk('src/tutorial', /\.ts$/)],
    ['campaign', ['src/config/marketing.ts']], ['scenario', walk('src/config/scenarios', /\.json$/)], ['rudi', ['src/config/storyWishes.ts', 'src/sim/advisor/hints.ts'].filter((f) => { try { read(f); return true; } catch { return false; } })],
    ['guestType', ['src/config/guestTypes.ts']], ['achievement', ['src/config/achievements.ts']],
  ];
  for (const [label, files] of scan) if (files.some((f) => re.test(read(f)))) hits.push(label);
  return hits;
}

/** Buildings that are a player-driven extra with no goal / advisor / tutorial / campaign touchpoint (by design: nothing REQUIRES them). M7.2: the Helipad, Tree Nursery, Recycling Centre and the energy extras now have Advisor rules (heli.rescue, trees.nursery, eco.recycling, energy.more) and left this list. */
export const OPTIONAL_EXTRAS: Readonly<Record<string, string>> = {
  chalet: 'lodging is taught by the generic "guests have no bed" Advisor rule and the Base Lodge goals, not by id',
  fishingPier: 'extension of the Tackle & Bait Hut (which the Angler campaign requires)',
  treehouse: 'optional hiker / family extra (docs/viewpoints.md)',
  crag: 'optional summer adventure extra (docs/climbing.md)',
  canyoningBase: 'optional summer adventure extra (docs/water-tours.md)',
  coffeeStand: 'optional food extra, never required by a goal or campaign (docs/coffee-stand.md)',
};

export interface Sandbox { sim: Sim; place(id: string): { ok: boolean; reason: string; refundOk: boolean; freed: boolean } }

/** A sandbox sim (size 64 / seed 61 by default): placement of one building on a suitable site, then demolition with refund, using the real rules. */
export function makeSandbox(seed = 61, size: 64 | 128 = 64): Sandbox {
  const sim = createSim({ size, seed, money: 1e9, mode: 'sandbox', lodge: false });
  const placed = new Set<string>();
  const put = (id: string): string | null => {
    const def = BUILDINGS[id]!;
    for (const r of def.requires) if (!placed.has(r)) { const err = put(r); if (err) return `prerequisite ${r}: ${err}`; }
    const c = sim.terrainInfo.villageAnchor;
    const site = sim.progression.withBypass(() => findSite(sim, id, { x: c.x, y: c.y }, { rmax: size }));
    if (!site) return 'no valid site found on the sandbox map';
    const out = sim.progression.withBypass(() => placeBuilding(sim.env, sim.props, id, site.x, site.y, site.rot, site.autoFlatten, false));
    if (!out.ok || !out.building) return `placement refused: ${out.reasons.join(', ')}`;
    placed.add(id);
    return null;
  };
  return {
    sim,
    place(id: string) {
      const def = BUILDINGS[id]!;
      const err = put(id);
      if (err) return { ok: false, reason: err, refundOk: false, freed: false };
      const b = sim.buildings.all().filter((x) => x.type === id).pop()!;
      const before = sim.game.money;
      const res = bulldoze(sim.buildings, sim.economy, b.id);
      const refundOk = res.ok && Math.abs(sim.game.money - before - refundValue(id)) < 1e-6 && refundValue(id) === Math.round(def.cost * 0.5);
      const freed = !sim.buildings.all().some((x) => x.id === b.id);
      placed.delete(id);
      return { ok: true, reason: '', refundOk, freed };
    },
  };
}

function rowForBuilding(def: BuildingDef, sb: Sandbox | null, cats: Set<string>): ContractRow {
  const id = def.id, p: string[] = [];
  if (!BUILDING_ICONS[id]) p.push('no icon (BUILDING_ICONS)');
  if (!def.name) p.push('no name');
  if (!(BUILDING_DESCRIPTIONS[id] ?? '').trim()) p.push('no description / tooltip (DESCRIPTIONS in ui/buildInfo.ts)');
  const entry = BUILDING_BUILDERS[def.meshBuilder];
  if (!entry) p.push(`no mesh builder '${def.meshBuilder}'`);
  else {
    try {
      const parts = buildParts(def.meshBuilder, def.w, def.h);
      let tris = 0, any = false;
      for (const g of [parts.wood, parts.stone, parts.roof, parts.glass, parts.sign?.geometry]) if (g) { any = true; tris += (g.index ? g.index.count : g.attributes.position!.count) / 3; }
      const budget = def.w * def.h <= 6 ? 3000 : 9000;
      if (!any || tris === 0) p.push('mesh is empty');
      else if (tris >= budget) p.push(`mesh over the triangle budget (${tris} >= ${budget})`);
    } catch (e) { p.push(`mesh build throws: ${(e as Error).message}`); }
  }
  if (!(id in BUILDING_HEIGHT)) p.push('no entry in buildingHeights.ts');
  if (!(def.cost > 0)) p.push('price is not > 0');
  if (!(def.upkeep >= 0)) p.push('upkeep is negative');
  const k = key('building', id);
  const gated = UNLOCKS.some((u) => key(u.kind, u.id) === k), open = ALWAYS_AVAILABLE[k];
  if (gated && open) p.push('both in UNLOCKS and ALWAYS_AVAILABLE');
  if (!gated && !open) p.push('no unlock decision: add it to UNLOCKS or ALWAYS_AVAILABLE (config/unlocks.ts)');
  if (def.access !== 'none') {
    const r = accessReason(def);
    if (!isAccessReason(r)) p.push(`access reason reads wrong: '${r}'`);
  } else if (accessReason(def) !== '') p.push('access none but a reason is generated');
  if (def.altAccess?.includes(def.access)) p.push('altAccess repeats the primary access');
  if (describeRules(id).length < 4) p.push('placement rule lines are missing');
  const info = buildingInfo(id, { locked: () => [], cost: (t) => BUILDINGS[t]!.cost, multiplier: () => 1 });
  if (!info) p.push('no inspector / info card');
  else {
    if (!info.stats.some(([l]) => l === 'Cost') || !info.stats.some(([l]) => l === 'Upkeep')) p.push('info card lacks Cost / Upkeep');
    if (!info.rules.length) p.push('info card has no rules');
  }
  if (def.needs?.length && def.season === 'all') p.push('needs set but season is "all"');
  if (def.maxCount !== undefined && def.maxCount < 1) p.push('maxCount < 1');
  if (!cats.has(def.category)) p.push(`unknown category ${def.category}`);
  if (!guideMentions(def.name, undefined)) p.push('not mentioned in the player guide (site/guide) by name');
  if (!touchpoints(id).length && !OPTIONAL_EXTRAS[id]) p.push('no advisor / goal / tutorial / campaign touchpoint and not listed in OPTIONAL_EXTRAS');
  if (sb) {
    const r = sb.place(id);
    if (!r.ok) p.push(`placement: ${r.reason}`);
    else { if (!r.refundOk) p.push('demolition refund is not 50% of the price'); if (!r.freed) p.push('demolition did not remove the building'); }
  }
  return { kind: 'building', id, problems: p };
}

const CATEGORIES = new Set(['core', 'services', 'lodging', 'kids', 'safety', 'operations', 'snow', 'water', 'recreation', 'transport', 'misc', 'energy']);

/** Every row, as a table. `sandbox` false skips the placement + demolition check (fast). */
export function runContract(opts: { sandbox?: boolean; fallbackSeeds?: Array<[number, 64 | 128]> } = {}): ContractRow[] {
  const rows: ContractRow[] = [];
  const sb = opts.sandbox === false ? null : makeSandbox();
  const fallbacks = opts.sandbox === false ? [] : (opts.fallbackSeeds ?? [[5, 128], [1, 128], [4, 128]]);
  for (const def of Object.values(BUILDINGS)) {
    let row = rowForBuilding(def, sb, CATEGORIES);
    if (sb && row.problems.some((q) => q.startsWith('placement: no valid site'))) {
      // terrain-specific buildings (river, rock face, forest, lake) may have no site on the default sandbox map: try the fallback maps
      for (const [seed, size] of fallbacks) {
        const r = makeSandbox(seed, size).place(def.id);
        if (r.ok) { row = { ...row, problems: row.problems.filter((q) => !q.startsWith('placement:')) }; if (!r.refundOk) row.problems.push('demolition refund is not 50% of the price'); break; }
      }
    }
    rows.push(row);
  }
  for (const l of Object.values(LIFTS)) {
    const p: string[] = [];
    if (!LIFT_ICONS[l.id]) p.push('no icon');
    if (!(LIFT_DESCRIPTIONS[l.id] ?? '').trim()) p.push('no description');
    if (!(l.costPerMetre > 0) || !(l.stationCost > 0)) p.push('price is not > 0');
    const k = key('lift', l.id);
    const gated = UNLOCKS.some((u) => key(u.kind, u.id) === k), open = ALWAYS_AVAILABLE[k];
    if (gated && open) p.push('both in UNLOCKS and ALWAYS_AVAILABLE');
    if (!gated && !open) p.push('no unlock decision');
    if (l.bottomAccess !== 'path' || l.topAccess !== 'none') p.push('station access rule differs from the documented path / none');
    if (!guideMentions(l.name, undefined)) p.push('not mentioned in the player guide by name');
    rows.push({ kind: 'lift', id: l.id, problems: p });
  }
  for (const c of CAMPAIGNS) {
    const p: string[] = [];
    if (!c.icon) p.push('no icon');
    if (!c.blurb.trim()) p.push('no description (blurb)');
    if (!(c.cost > 0)) p.push('price is not > 0');
    const k = key('campaign', c.id);
    const gated = UNLOCKS.some((u) => key(u.kind, u.id) === k), open = ALWAYS_AVAILABLE[k];
    if (gated && open) p.push('both in UNLOCKS and ALWAYS_AVAILABLE');
    if (!gated && !open) p.push('no unlock decision');
    if (!c.prereqs.length) p.push('no prerequisites');
    for (const q of c.prereqs) if (q.build && !BUILDINGS[q.build]) p.push(`prerequisite builds unknown '${q.build}'`);
    if (!guideMentions(c.name, undefined)) p.push('not mentioned in the player guide by name');
    rows.push({ kind: 'campaign', id: c.id, problems: p });
  }
  for (const t of SHIPPED_TYPES) {
    const p: string[] = [];
    if (!guideMentions(t.label, undefined) && !guideMentions(t.label + 's', undefined)) p.push('not mentioned in the player guide by name');
    for (const r of t.requires ?? []) if (!r.startsWith('@') && !BUILDINGS[r]) p.push(`requires unknown building '${r}'`);
    if (!t.look) p.push('no look hooks');
    rows.push({ kind: 'guestType', id: t.id, problems: p });
  }
  return rows;
}

export const formatContract = (rows: readonly ContractRow[]): string =>
  rows.filter((r) => r.problems.length).map((r) => `${r.kind}:${r.id}\n${r.problems.map((x) => `    - ${x}`).join('\n')}`).join('\n') || '(no gaps)';
