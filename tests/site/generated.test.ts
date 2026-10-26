import { describe, expect, it } from 'vitest';
import { KEY_BINDINGS } from '../../src/ui/shortcuts';
import { LEVELS } from '../../src/config/progression';
import { UNLOCKS } from '../../src/config/unlocks';
import { SCENARIOS } from '../../src/config/scenarios';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { LIFT_KIND_IDS, LIFTS } from '../../src/config/lifts';
import { CAMPAIGNS } from '../../src/config/marketing';
import { allGenerated, keyLabel, shortcuts } from '../../scripts/site/generated';

const g = allGenerated();
const rowsOf = (md: string): string[][] => md.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));

describe('generated guide blocks', () => {
  it('shortcuts: every KEY_BINDINGS (context, key, action) is documented', () => {
    const doc = shortcuts();
    for (const b of KEY_BINDINGS) {
      expect(doc, `key '${b.key}' (${b.context}) not documented`).toContain(`<kbd>${keyLabel(b.key.split('+').pop()!)}</kbd>`);
      expect(doc.toLowerCase(), `action '${b.action}' missing`).toContain(b.action.toLowerCase());
    }
  });
  it('shortcuts: a binding added to the registry shows up (nothing hard-coded)', () => {
    expect(shortcuts([...KEY_BINDINGS, { key: 'F12', context: 'global', action: 'brand new test action' }])).toContain('<kbd>F12</kbd>');
  });
  it('levels table equals LEVELS', () => {
    const rows = rowsOf(g.levels!); expect(rows).toHaveLength(LEVELS.length);
    LEVELS.forEach((l, i) => { expect(rows[i]![0]).toBe(String(l.level)); expect(rows[i]![1]).toBe(l.name); if (l.guests) expect(rows[i]![3]).toBe(l.guests.toLocaleString('en-US')); });
  });
  it('unlocks lists every UNLOCKS entry at its level', () => {
    for (const u of UNLOCKS) { const row = rowsOf(g.unlocks!).find((r) => r[0]!.startsWith(`${u.level}:`))!; expect(row, `level ${u.level}`).toBeTruthy(); expect(row[1]).toContain(u.kind === 'lift' ? LIFTS[u.id as keyof typeof LIFTS].name : '('); }
  });
  it('scenarios: every shipped scenario with its mandatory objectives', () => {
    for (const s of SCENARIOS) { expect(g.scenarios).toContain(`### ${s.name}`); for (const o of s.objectives.filter((x) => x.mandatory)) expect(g.scenarios).toContain(o.title); }
  });
  it('achievements: all of them, count in the intro', () => {
    expect(g.achievements).toContain(`**${ACHIEVEMENTS.length}** trophies`);
    for (const a of ACHIEVEMENTS.filter((x) => !x.hidden)) expect(g.achievements).toContain(a.title);
  });
  it('lifts and campaigns tables cover every kind', () => {
    expect(rowsOf(g.lifts!)).toHaveLength(LIFT_KIND_IDS.length); expect(rowsOf(g.campaigns!)).toHaveLength(CAMPAIGNS.length);
  });
});
