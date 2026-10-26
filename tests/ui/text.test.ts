import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/config/buildings';
import { LIFTS } from '@/config/lifts';
import { GAME_EVENT_NAMES } from '@/core/events';
import { NEWS_FORMATTERS, NON_SPATIAL_EVENTS, formatEvent, formatLiftOpened, type NewsCtx } from '@/ui/newsFormat';
import { displayName, humanizeId, sentence, title } from '@/ui/text';
import { describeRules, accessReason } from '@/sim/PlacementRules';
import { canPlace } from '@/sim/Dependencies';
import { CAMPAIGNS } from '@/config/marketing';
import { STRINGS } from '@/tutorial/strings';
import { EVENT_SAMPLES } from './eventSamples';

/** A user-facing string starts with an uppercase letter, a digit or a symbol/emoji. */
const startsOk = (s: string): boolean => { const c = s.trim().charAt(0); return c !== '' && !(c !== c.toUpperCase()); };
const RAW_ID = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/;
const SNAKE = /\b[a-z0-9]+_[a-z0-9_]+\b/;
const clean = (s: string, what: string): void => {
  expect(startsOk(s), `${what}: "${s}" must start uppercase`).toBe(true);
  expect(RAW_ID.test(s), `${what}: "${s}" leaks a camelCase id`).toBe(false);
  expect(SNAKE.test(s), `${what}: "${s}" leaks a snake_case id`).toBe(false);
};

const ctx: NewsCtx = {
  liftName: (id) => `Chairlift ${id}`, money: (n) => `$${n}`, locate: (_k, id) => ({ x: 10 + id, y: 20 + id }),
  where: () => ({ name: 'the northern upper bowl', on: 'on Blue Run 3', near: 'near Mountain Hut 2' }),
};

describe('text helpers', () => {
  it('sentence capitalises the first letter only and keeps acronyms', () => {
    expect(sentence('no snow at 1,450 m')).toBe('No snow at 1,450 m');
    expect(sentence('Ski School HQ closed')).toBe('Ski School HQ closed');
    expect(sentence('café closed')).toBe('Café closed');
    expect(sentence('⚠ needs a depot')).toBe('⚠ Needs a depot');
    expect(sentence('3 guests')).toBe('3 guests'); expect(sentence('')).toBe('');
  });
  it('title Title-Cases words, keeps small joiners and acronyms', () => {
    expect(title('ski school HQ')).toBe('Ski School HQ');
    expect(title('lift of the day')).toBe('Lift of the Day');
  });
  it('displayName maps ids to catalog names, lifts included, and humanises unknown ids', () => {
    expect(displayName('cafe')).toBe('Café'); expect(displayName('mountainHut')).toBe('Mountain Hut'); expect(displayName('skiSchoolHQ')).toBe('Ski School HQ');
    expect(displayName('apresBar')).toBe('Après-Ski Bar'); expect(displayName('chair4d')).toBe(LIFTS.chair4d.name);
    expect(displayName('someNewThing')).toBe('Some New Thing'); expect(humanizeId('snake_case_id')).toBe('Snake Case Id');
  });
  it('every catalog name (buildings and lifts) is title-cased', () => {
    const small = new Set(['of', 'and', 'the', 'a', 'an', 'to', 'in', 'on', 'at', 'for', 'or']);
    for (const n of [...Object.values(BUILDINGS).map((b) => b.name), ...Object.values(LIFTS).map((l) => l.name)]) {
      for (const w of n.replace(/\(.*\)/, '').split(/[\s/]+/)) if (w && !small.has(w)) expect(w[0] === w[0]!.toUpperCase(), `"${n}": word "${w}"`).toBe(true);
    }
  });
});

describe('message audit: capitalisation and raw ids', () => {
  it('has a sample payload for every event', () => { for (const n of GAME_EVENT_NAMES) expect(EVENT_SAMPLES[n], n).toBeDefined(); });
  it('every news formatter output starts uppercase and leaks no raw ids', () => {
    for (const n of GAME_EVENT_NAMES) {
      if (NEWS_FORMATTERS[n] === 'ignored') continue;
      const it = formatEvent(n, EVENT_SAMPLES[n] as never, ctx);
      if (!it) continue;
      clean(it.text, n); if (it.many) clean(it.many(3), `${n} (many)`);
    }
    clean(formatLiftOpened({ id: 2, open: true }, ctx)!.text, 'lift:opened');
  });
  it('attraction events use the catalog name and a sentence-cased reason (the "cafe" bug)', () => {
    expect(formatEvent('attraction:opened', { id: 3, type: 'cafe' }, ctx)!.text).toBe('Café opened');
    expect(formatEvent('attraction:closed', { id: 3, type: 'mountainHut', reason: 'Closed: no snow at 1,450 m' }, ctx)!.text).toBe('Mountain Hut closed. No snow at 1,450 m');
    expect(formatEvent('marketing:cancelled', { id: 'x', name: 'Families', reason: 'requires: Ski School HQ' }, ctx)!.text).toBe('Campaign cancelled: Families. Requires: Ski School HQ');
  });
  it('placement rules, dependency reasons and access reasons for every catalog type are clean', () => {
    for (const id of Object.keys(BUILDINGS)) {
      for (const l of describeRules(id)) clean(l, `describeRules(${id})`);
      const a = accessReason(BUILDINGS[id]!); if (a) clean(a, `accessReason(${id})`);
      for (const r of canPlace(id, { buildings: [] }).reasons) clean(r, `canPlace(${id})`);
    }
  });
  it('marketing campaign names, blurbs and prerequisite labels are clean', () => {
    for (const c of CAMPAIGNS) { clean(c.name, c.id); clean(c.blurb, c.id); for (const p of c.prereqs) clean(p.label, `${c.id}:${p.id}`); }
  });
  it('tutorial strings start uppercase (or with a symbol / markup)', () => {
    for (const [k, v] of Object.entries(STRINGS)) { const s = String(v).replace(/^[*_`]+/, ''); if (s && !k.startsWith('frag.')) expect(startsOk(s), `${k}: "${v}"`).toBe(true); }
  });
});

describe('Go to: every location-bearing event carries a focus', () => {
  it('iterates GAME_EVENT_NAMES: spatial events give a focus, non-spatial ones are explicitly listed', () => {
    for (const n of GAME_EVENT_NAMES) {
      if (NEWS_FORMATTERS[n] === 'ignored') { expect(NON_SPATIAL_EVENTS.has(n), `${n} is ignored, so it must be listed as non-spatial`).toBe(true); continue; }
      const it = formatEvent(n, EVENT_SAMPLES[n] as never, ctx);
      if (!it) continue;
      if (NON_SPATIAL_EVENTS.has(n)) expect(it.focus, `${n} is non-spatial`).toBeUndefined();
      else { expect(it.focus, `${n} needs a focus (or an entry in NON_SPATIAL_EVENTS)`).toBeDefined(); expect(it.loc).toEqual({ x: it.focus!.x, y: it.focus!.y }); }
    }
  });
  it('entity kinds and ids come from the payload; unknown buildings give no focus', () => {
    expect(formatEvent('attraction:closed', EVENT_SAMPLES['attraction:closed'], ctx)!.focus).toEqual({ x: 13, y: 23, entityKind: 'building', entityId: 3 });
    expect(formatEvent('lift:broken', EVENT_SAMPLES['lift:broken'], ctx)!.focus).toMatchObject({ entityKind: 'lift', entityId: 2 });
    expect(formatEvent('incident:created', EVENT_SAMPLES['incident:created'], ctx)!.focus).toEqual({ x: 14, y: 15, entityKind: 'guest', entityId: 7 });
    expect(formatEvent('incident:avalanche', EVENT_SAMPLES['incident:avalanche'], ctx)!.focus).toEqual({ x: 12, y: 20 });
    expect(formatEvent('wildlife:relocated', EVENT_SAMPLES['wildlife:relocated'], ctx)!.focus).toEqual({ x: 2, y: 3 });
    expect(formatEvent('attraction:closed', EVENT_SAMPLES['attraction:closed'], { ...ctx, locate: () => null })!.focus).toBeUndefined();
  });
});
