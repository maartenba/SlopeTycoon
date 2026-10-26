import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STRINGS, hintKey, parseRich, stepKey, t } from '../../src/tutorial/strings';
import { STEPS } from '../../src/tutorial/steps';
import { HINTS } from '../../src/tutorial/hints';

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const SRC = walk('src').filter((f) => /\.ts$/.test(f) && !f.endsWith('tutorial/strings.ts'));
const srcText = SRC.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('tutorial strings', () => {
  it('every step has title, text and show strings', () => {
    for (const s of STEPS) for (const p of ['title', 'text', 'show'] as const) expect(STRINGS, `${s.id}.${p}`).toHaveProperty([stepKey(s.id, p)]);
  });
  it('every hint has a text string', () => { for (const h of HINTS) expect(STRINGS, h.id).toHaveProperty([hintKey(h.id)]); });
  it('every string key used by the code exists', () => {
    const used = new Set<string>();
    for (const m of srcText.matchAll(/\bt\(\s*'([a-zA-Z]+\.[\w.]+)'/g)) used.add(m[1]!);
    for (const m of srcText.matchAll(/\btr\(\s*'([a-zA-Z]+\.[\w.]+)'/g)) used.add(m[1]!);
    for (const m of srcText.matchAll(/\bt\(\s*(?:h\.on \? )?'((?:ui|msg|reason|name)\.[\w.]+)'/g)) used.add(m[1]!);
    for (const k of used) expect(STRINGS, k).toHaveProperty([k]);
    expect(used.size).toBeGreaterThan(20);
  });
  it('every defined key is used (steps/hints by id, others referenced from code)', () => {
    const stepKeys = new Set(STEPS.flatMap((s) => (['title', 'text', 'show'] as const).map((p) => stepKey(s.id, p))));
    const hintKeys = new Set(HINTS.map((h) => hintKey(h.id)));
    const unused = Object.keys(STRINGS).filter((k) => !stepKeys.has(k) && !hintKeys.has(k) && !srcText.includes(`'${k}'`));
    expect(unused).toEqual([]);
    // and no orphaned step / hint strings
    const orphan = Object.keys(STRINGS).filter((k) => (k.startsWith('step.') && !stepKeys.has(k)) || (k.startsWith('hint.') && !hintKeys.has(k)));
    expect(orphan).toEqual([]);
  });
  it('steps / hints / suggest / engine contain no raw user-facing literals', () => {
    // string literals with a space and letters (>= 2 words) outside comments; whitelist: internal ids and sim reason texts that are only compared
    const allowed = new Set(['Not enough funds', 'tutorial funding']);
    for (const f of ['steps.ts', 'hints.ts', 'suggest.ts', 'TutorialEngine.ts', 'queries.ts', 'ui-targets.ts']) {
      const code = readFileSync(`src/tutorial/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      for (const m of code.matchAll(/'([A-Za-z][^'\n]*\s[^'\n]*)'/g)) {
        const lit = m[1]!;
        if (allowed.has(lit) || /^[\w:.\-/\s]*$/.test(lit) && !/[A-Z][a-z]+ [a-z]+ [a-z]+/.test(lit) && lit.split(' ').length < 3) continue;
        throw new Error(`raw literal in ${f}: '${lit}'`);
      }
    }
  });
  it('t() fills placeholders and falls back to the key', () => {
    expect(t('ui.progress', { n: 2, total: 9 })).toBe('Step 2 of 9');
    expect(t('nope.nothing')).toBe('nope.nothing');
    expect(t('ui.progress')).toContain('{n}');
  });
  it('parseRich understands bold, keys and italics', () => {
    expect(parseRich('a **b** `Q` *c* d').map((s) => s.kind)).toEqual(['text', 'bold', 'text', 'key', 'text', 'em', 'text']);
  });
});
