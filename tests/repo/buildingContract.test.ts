import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { ALWAYS_AVAILABLE, UNLOCKS, key } from '../../src/config/unlocks';
import { LIFTS } from '../../src/config/lifts';
import { CAMPAIGNS } from '../../src/config/marketing';
import { SHIPPED_TYPES } from '../../src/config/guestTypes';
import { OPTIONAL_EXTRAS, formatContract, runContract } from '../../scripts/analysis/contractLib';

/**
 * M7.1 building contract (docs/economy-audit.md): every building / lift / campaign / guest-type row is checked by ONE data-driven table:
 * icon, description, mesh within budget, height entry, price, upkeep, an explicit unlock decision, access reason wording, info card, guide mention,
 * advisor / goal / tutorial touchpoint, a successful placement on a suitable site and demolition with the 50 % refund.
 * The KNOWN_GAPS allow-list is EMPTY (Task 7.1.5): a new row that breaks the contract fails here with the full list.
 */
const KNOWN_GAPS: Readonly<Record<string, string>> = {};

describe('building contract [data-driven]', () => {
  const rows = runContract();
  it('covers every row of every catalog', () => {
    const n = Object.keys(BUILDINGS).length + Object.keys(LIFTS).length + CAMPAIGNS.length + SHIPPED_TYPES.length;
    expect(rows.length).toBe(n);
  });
  it('has no gaps (the allow-list is empty)', () => {
    const bad = rows.filter((r) => r.problems.length && !KNOWN_GAPS[`${r.kind}:${r.id}`]);
    expect(formatContract(bad), formatContract(bad)).toBe('(no gaps)');
    expect(Object.keys(KNOWN_GAPS)).toEqual([]);
  });
  it('every unlock row names a real item and nothing is both gated and always-available', () => {
    for (const u of UNLOCKS) if (u.kind === 'building') expect(BUILDINGS[u.id], u.id).toBeDefined();
    for (const k of Object.keys(ALWAYS_AVAILABLE)) expect(UNLOCKS.some((u) => key(u.kind, u.id) === k), k).toBe(false);
    for (const k of Object.keys(ALWAYS_AVAILABLE)) {
      const [kind, id] = k.split(':') as [string, string];
      const real = kind === 'building' ? BUILDINGS[id] : kind === 'lift' ? (LIFTS as Record<string, unknown>)[id] : CAMPAIGNS.find((c) => c.id === id);
      expect(real, k).toBeDefined();
    }
  });
  it('OPTIONAL_EXTRAS only lists real buildings, each with a reason', () => {
    for (const [id, why] of Object.entries(OPTIONAL_EXTRAS)) { expect(BUILDINGS[id], id).toBeDefined(); expect(why.length, id).toBeGreaterThan(10); }
  });
});
