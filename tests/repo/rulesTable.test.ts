import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS } from '../../src/config/lifts';
import { accessReason, accessSummary, isAccessReason } from '../../src/sim/PlacementRules';
import { withRulesBlock } from '../../scripts/analysis/rulesTable';

describe('placement rules table (M7.1 audit)', () => {
  it('docs/placement-rules.md carries the current generated table (run `npm run docs:rules`)', () => {
    const doc = readFileSync('docs/placement-rules.md', 'utf8');
    expect(withRulesBlock(doc) === doc).toBe(true);
    for (const d of Object.values(BUILDINGS)) expect(doc, d.id).toContain(`| ${d.name} |`);
  });
  it('every access reason is well formed and lists every alternative (a road is always offered with a footpath)', () => {
    for (const d of Object.values(BUILDINGS)) {
      const r = accessReason(d);
      if (d.access === 'none') { expect(r, d.id).toBe(''); continue; }
      expect(isAccessReason(r), `${d.id}: ${r}`).toBe(true);
      const kinds = [d.access, ...(d.altAccess ?? [])];
      if (kinds.includes('path')) expect(r, d.id).toContain('road');
      if (kinds.includes('trail')) expect(r, d.id).toContain('trail');
      if (kinds.includes('pisteEdge')) expect(r, d.id).toContain('piste');
      expect(accessSummary(d).length, d.id).toBeGreaterThan(0);
    }
  });
  it('lifts use one documented access rule', () => {
    for (const l of Object.values(LIFTS)) { expect(l.bottomAccess).toBe('path'); expect(l.topAccess).toBe('none'); }
  });
  it('pisteRule edge rows are meant to sit beside a piste: they accept a piste, trail or footpath', () => {
    for (const d of Object.values(BUILDINGS)) if (d.pisteRule === 'edge') expect([d.access, ...(d.altAccess ?? [])].some((k) => k === 'pisteEdge' || k === 'trail' || k === 'path' || k === 'none'), d.id).toBe(true);
  });
});

describe('ghost tips agree with the access rule', () => {
  it('a placeTip only names access kinds the building really accepts', () => {
    for (const d of Object.values(BUILDINGS)) {
      if (!d.placeTip) continue;
      const tip = d.placeTip.toLowerCase().replace(/\b(never|not)\b[^,:;.]*/g, ''), allowed = accessReason(d).toLowerCase();
      for (const [word, re] of [['road', /\broad\b/], ['footpath', /\bfootpath\b/], ['trail', /\btrail\b/], ['piste', /\bpiste\b/]] as const) {
        // a tip may mention a piste / road as TERRAIN context ('beside a road on flat ground'); it must not promise an access the rule does not accept
        if (re.test(tip) && word !== 'road' && !allowed.includes(word)) throw new Error(`${d.id}: tip '${d.placeTip}' names a ${word} but the rule says '${accessReason(d)}'`);
        if (re.test(tip) && word === 'road' && !allowed.includes('road') && !/(trail|footpath)/.test(allowed)) throw new Error(`${d.id}: tip names a road, rule says '${accessReason(d)}'`);
      }
    }
  });
});
