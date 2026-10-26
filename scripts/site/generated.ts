/** Guide blocks generated from the game's own config at build time, so they cannot drift (tests/site/generated.test.ts). Return Markdown/HTML. */
import { KEY_BINDINGS, type KeyBinding, type KeyContext } from '../../src/ui/shortcuts';
import { LEVELS } from '../../src/config/progression';
import { UNLOCKS } from '../../src/config/unlocks';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS, LIFT_KIND_IDS } from '../../src/config/lifts';
import { CAMPAIGNS } from '../../src/config/marketing';
import { SCENARIOS } from '../../src/config/scenarios';
import { ACHIEVEMENTS, TIER_NAME, TIER_POINTS } from '../../src/config/achievements';
import { FESTIVALS } from '../../src/config/festivals';
import { STAFF_UPGRADES } from '../../src/config/staffUpgrades';
import { COSMETICS, COSMETIC_KIND_LABEL } from '../../src/config/cosmetics';

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: string[][]): string => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', '1-9': '1–9' };
export const keyLabel = (k: string): string => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
const kbd = (k: string): string => k.split('+').map((p) => `<kbd>${keyLabel(p)}</kbd>`).join('+');

export const CONTEXT_TITLES: Record<KeyContext, string> = {
  global: 'Anywhere', drawer: 'Buildings drawer open', terraform: 'Terrain drawer: terraform tools', plant: 'Terrain drawer: tree tools', build: 'Placing a building',
  lift: 'Placing a lift', path: 'Drawing paths, roads, rail and pistes', ride: 'Ride-along', photo: 'Photo mode', walk: 'Walk mode',
};
const CONTEXT_ORDER: KeyContext[] = ['global', 'drawer', 'build', 'lift', 'path', 'terraform', 'plant', 'ride', 'walk', 'photo'];

/** One table per context, rows merged by action (W / ↑ = pan up). Every KEY_BINDINGS key appears at least once. */
export function shortcuts(bindings: readonly KeyBinding[] = KEY_BINDINGS): string {
  const out: string[] = [];
  for (const c of CONTEXT_ORDER) {
    const rows = new Map<string, string[]>();
    for (const b of bindings.filter((x) => x.context === c)) rows.set(b.action, [...(rows.get(b.action) ?? []), b.key]);
    if (!rows.size) continue;
    out.push(`## ${CONTEXT_TITLES[c]}\n\n${table(['Keys', 'What it does'], [...rows].map(([a, ks]) => [ks.map(kbd).join(' / '), a[0]!.toUpperCase() + a.slice(1)]))}`);
  }
  return out.join('\n\n');
}

export function levels(): string {
  return table(['Level', 'Title', 'Stars', 'Guests (total)', 'Best day', 'Profitable months', 'Goal chapters', '12-month profit'],
    LEVELS.map((l) => [String(l.level), l.name, l.stars ? `${l.stars}★` : '–', l.guests ? l.guests.toLocaleString('en-US') : '–', l.peakDay ? String(l.peakDay) : '–', l.profitMonths ? String(l.profitMonths) : '–', l.chapters ? `${l.chapters} of 4` : '–', Number.isFinite(l.annualProfit) ? money(l.annualProfit) : '–']));
}
export function unlocks(): string {
  const nameOf = (u: (typeof UNLOCKS)[number]): string => u.kind === 'lift' ? `${LIFTS[u.id as keyof typeof LIFTS]?.name ?? u.id} (lift)` : u.kind === 'building' ? `${BUILDINGS[u.id]?.name ?? u.id} (building)` : `${CAMPAIGNS.find((c) => c.id === u.id)?.name ?? u.id} (marketing campaign)`;
  return table(['Level', 'Unlocks'], LEVELS.filter((l) => l.level > 1).map((l) => [`${l.level}: ${l.name}`, UNLOCKS.filter((u) => u.level === l.level).map(nameOf).join(', ') || 'Nothing new']));
}
export function lifts(): string {
  return table(['Lift', 'Riders per carrier', 'Max length', 'Cabin / bubble', 'Detachable', 'Carries bikes', 'Station price'],
    LIFT_KIND_IDS.map((id) => { const l = LIFTS[id]; return [l.name, String(l.capacityPerCarrier), `${l.maxLength} tiles`, l.bubble ? 'yes' : 'no', l.detachable ? 'yes' : 'no', l.carriesBikes ? 'yes' : 'no', money(l.stationCost)]; }));
}
export function campaigns(): string {
  return table(['Campaign', 'Targets', 'Cost', 'Runs for'], CAMPAIGNS.map((c) => [c.name, c.segment, money(c.cost), `${c.durationDays} days`]));
}
const MAP_LABEL: Record<number, string> = { 64: 'Small (64)', 128: 'Medium (128)', 256: 'Large (256)' };
export function scenarios(): string {
  return SCENARIOS.map((s) => {
    const goals = s.objectives.map((o) => `- ${o.mandatory ? '**' + o.title + '**' : o.title}${o.mandatory ? ' (required)' : ' (bonus)'}`).join('\n');
    return `### ${s.name} ${'★'.repeat(s.stars)}${'☆'.repeat(5 - s.stars)}\n\n*${s.tagline}* ${s.blurb}\n\nMap: ${MAP_LABEL[s.mapSize] ?? s.mapSize}, start in ${s.startSeason}.\n\n${goals}`;
  }).join('\n\n');
}
export function achievements(): string {
  const reward = (id?: string): string => { const c = COSMETICS.find((x) => x.id === id); return c ? `${COSMETIC_KIND_LABEL[c.kind]}: ${c.name}` : ''; };
  return [`There are **${ACHIEVEMENTS.length}** trophies. Common ones are worth ${TIER_POINTS[1]} point, notable ${TIER_POINTS[2]}, rare ${TIER_POINTS[3]}.`, '',
    table(['Trophy', 'How to get it', 'Tier', 'Reward'], ACHIEVEMENTS.map((a) => [a.hidden ? '??? (secret)' : a.title, a.hidden ? 'A surprise.' : a.description, TIER_NAME[a.tier], reward(a.reward)]))].join('\n');
}
export function cosmetics(): string {
  const ach = (id: string): string => ACHIEVEMENTS.find((a) => a.reward === id)?.title ?? 'Free from the start';
  return table(['Kind', 'Name', 'Unlocked by'], COSMETICS.map((c) => [COSMETIC_KIND_LABEL[c.kind], c.name, c.default ? 'Always yours' : ach(c.id)]));
}

export function festivals(): string {
  const need = (n: string): string => n === 'lodge' ? 'Base Lodge' : n === 'blackPiste' ? 'a black piste' : n;
  const when = (f: (typeof FESTIVALS)[number]): string => f.kind === 'auto' ? 'Happens by itself' : `Book it (${f.seasons.join(' / ')}), ${f.leadDays} days notice`;
  return table(['Event', 'What it is', 'When', 'Runs for', 'Cost', 'Extra guests', 'Needs'],
    FESTIVALS.map((f) => [f.name, f.blurb, when(f), f.days > 1 ? `${f.days} days` : f.days === 1 ? '1 day' : 'a while', f.cost ? money(f.cost) : '–', f.arrivalMult > 1 ? `+${Math.round((f.arrivalMult - 1) * 100)}%` : '–', f.kind === 'auto' ? '–' : [`${f.minStars}★`, ...f.needs.map(need), `level ${f.minLevel}`].join(', ')]));
}
export function staffUpgrades(): string {
  return table(['Course', 'What it does', 'Cost', 'Training', 'Upkeep', 'Level'],
    STAFF_UPGRADES.map((u) => [u.name, u.effect, money(u.cost), `${u.days} days`, `${money(u.upkeep)} / day`, String(u.minLevel)]));
}

export function allGenerated(): Record<string, string> {
  return { shortcuts: shortcuts(), levels: levels(), unlocks: unlocks(), lifts: lifts(), campaigns: campaigns(), scenarios: scenarios(), achievements: achievements(), cosmetics: cosmetics(), festivals: festivals(), staffUpgrades: staffUpgrades() };
}
