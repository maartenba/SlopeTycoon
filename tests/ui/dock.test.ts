import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/config/buildings';
import { BUILDING_TABS, buildingTab, buildingsInTab, buildingInfo, catalogRules, ruleLines } from '@/ui/buildInfo';
import { DRAWERS, drawerReduce, digitSelectsItem, FLATTEN_DRAWERS } from '@/ui/drawerState';
import { thumbKey } from '@/render/thumbnails/keys';

describe('building tabs', () => {
  it('maps every catalog id to exactly one valid tab', () => {
    const seen = new Map<string, number>();
    for (const t of BUILDING_TABS) for (const d of buildingsInTab(t.id)) seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
    expect([...seen.keys()].sort()).toEqual(Object.keys(BUILDINGS).sort());
    for (const n of seen.values()) expect(n).toBe(1);
    for (const d of Object.values(BUILDINGS)) expect(BUILDING_TABS.map((t) => t.id)).toContain(buildingTab(d));
  });
  it('places transport hubs and utilities as specified', () => {
    for (const id of ['trainStation', 'altiport', 'shuttleDepot', 'parking']) expect(buildingTab(BUILDINGS[id]!)).toBe('transport');
    for (const id of ['reservoir', 'snowCannon']) expect(buildingTab(BUILDINGS[id]!)).toBe('utilities');
  });
});

describe('drawer state machine', () => {
  it('toggles, replaces and closes', () => {
    let s = { open: null as ReturnType<typeof drawerReduce>['open'] };
    s = drawerReduce(s, { type: 'toggle', id: 'lifts' });
    expect(s.open).toBe('lifts');
    s = drawerReduce(s, { type: 'toggle', id: 'paths' });
    expect(s.open).toBe('paths');
    s = drawerReduce(s, { type: 'toggle', id: 'paths' });
    expect(s.open).toBeNull();
    s = drawerReduce({ open: 'view' }, { type: 'escape' });
    expect(s.open).toBeNull();
    expect(drawerReduce({ open: null }, { type: 'escape' }).open).toBeNull();
  });
  it('digit selection only in buildings drawer; flatten toggle for building/lift', () => {
    expect(digitSelectsItem('buildings')).toBe(true);
    expect(digitSelectsItem('terrain')).toBe(false);
    expect(digitSelectsItem(null)).toBe(false);
    expect([...FLATTEN_DRAWERS].sort()).toEqual(['buildings', 'lifts']);
    expect(new Set(DRAWERS.map((d) => d.id)).size).toBe(DRAWERS.length);
  });
});

describe('thumbnail keys & info', () => {
  it('keys are unique per kind/id/size', () => {
    expect(thumbKey('building', 'cafe', 96)).toBe('building:cafe@96');
    expect(thumbKey('building', 'cafe', 96)).not.toBe(thumbKey('lift', 'cafe', 96));
    expect(thumbKey('building', 'cafe', 96)).not.toBe(thumbKey('building', 'cafe', 160));
  });
  it('building info shows season hint and requirement state', () => {
    const m = buildingInfo('firstAid', { locked: () => ['Needs Ski Patrol Hub'], cost: () => 900, multiplier: () => 0.5 });
    expect(m!.stats[0]![1]).toContain('−50%');
    expect(m!.reqs).toEqual([{ text: 'Ski Patrol Hub', ok: false }]);
    expect(m!.stats.find(([k]) => k === 'Footprint')![1]).toBe('2×2');
    expect(buildingInfo('nope', { locked: () => [], cost: () => 0, multiplier: () => 1 })).toBeNull();
  });
  it('rule lines fall back to catalog data', () => {
    expect(ruleLines('beach').length).toBeGreaterThan(0);
    expect(ruleLines('cafe').length).toBeGreaterThan(0);
    expect(catalogRules('beach')).toContain('Must touch a lake');
  });
});

import { ChangeGate, changedKeys } from '@/ui/keyedDiff';
describe('keyed diff', () => {
  it('reports only changed/new keys', () => {
    const prev = new Map([['a', 1], ['b', 2]]);
    expect(changedKeys(prev, new Map([['a', 1], ['b', 3], ['c', 1]]))).toEqual(['b', 'c']);
    expect(changedKeys(prev, prev)).toEqual([]);
  });
  it('ChangeGate gates unchanged values', () => {
    const g = new ChangeGate<string>();
    expect(g.set('p', '$1')).toBe(true);
    expect(g.set('p', '$1')).toBe(false);
    expect(g.set('p', '$2')).toBe(true);
  });
});
describe('drawer reducer no-op', () => {
  it('escape on closed returns same state; close twice stays closed', () => {
    const s = { open: null };
    expect(drawerReduce(s, { type: 'escape' })).toBe(s);
    expect(drawerReduce({ open: null }, { type: 'close' }).open).toBeNull();
  });
});
