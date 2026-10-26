import { describe, expect, it } from 'vitest';
import { GOALS } from '../../src/config/goals';
import { BUILDINGS } from '../../src/config/buildings';
import { NETWORK_ITEMS } from '../../src/ui/buildInfo';

const DRAWERS = ['buildings', 'lifts', 'pistes', 'paths', 'finance', 'ops', 'marketing', 'pricing', 'rating'];

describe("'Show me' always lands somewhere", () => {
  it('every goal has a panel fallback that names a real drawer and item', () => {
    for (const g of GOALS) {
      expect(g.panel, g.id).toBeTruthy();
      expect(DRAWERS, g.id).toContain(g.panel.drawer);
      if (g.panel.drawer === 'buildings') expect(BUILDINGS[g.panel.item!], g.id).toBeTruthy();
      if (g.panel.drawer === 'pistes') expect(NETWORK_ITEMS.some((n) => n.key === g.panel.item), g.id).toBe(true);
    }
  });
});
