/** NO DEATHS, EVER (owner decision D-P3, Phase 6 Task 32): avalanche burials, attacks, strandings and every other incident end in an injury, never a death. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', 'src');
const WORDS = /\b(died|dies|die|dying|killed|kills?|killing|death|deaths|deadly|fatal|fatality|fatalities|dead|corpse|body bag|perished|deceased)\b/i;
/** Legacy-save migration only: old blobs may contain the removed outcome; it is READ and turned into a severe hospitalisation (tests/sim/ops/noDeaths.test.ts). */
const ALLOWED_LITERALS: Array<{ file: string; text: string }> = [{ file: 'sim/ops/Incidents.ts', text: "'fatal'" }];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|json|md)$/.test(n) && !/\.generated\./.test(n)) out.push(p);
  }
  return out;
}

/** String literals of a TypeScript source (comments are skipped): single, double and template strings. */
export function literals(src: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i]!, d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c, start = i, l0 = line; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') { line++; if (q !== '`') break; } i++; }
      out.push({ text: src.slice(start, i + 1), line: l0 }); i++; continue;
    }
    i++;
  }
  return out;
}

describe('no deaths anywhere', () => {
  it('no sim / ui / config / game / render string or incident enum names a death (comments, tests and docs may)', () => {
    const bad: string[] = [];
    for (const dir of ['sim', 'ui', 'config', 'game', 'core', 'render', 'tutorial', 'world', 'persist', 'audio']) {
      for (const f of walk(join(ROOT, dir))) {
        if (!f.endsWith('.ts')) continue;
        const rel = f.slice(ROOT.length + 1);
        for (const l of literals(readFileSync(f, 'utf8'))) {
          if (!WORDS.test(l.text)) continue;
          if (ALLOWED_LITERALS.some((a) => rel === a.file && l.text.includes(a.text))) continue;
          bad.push(`${rel}:${l.line} ${l.text.slice(0, 90)}`);
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the incident kinds and outcomes are an injury-only set', () => {
    const src = readFileSync(join(ROOT, 'sim/ops/Incidents.ts'), 'utf8');
    const kinds = /export type IncidentKind = ([^;]+);/.exec(src)![1]!;
    const outcomes = /export type Outcome = ([^;]+);/.exec(src)![1]!;
    expect(kinds.match(/'(\w+)'/g)).toEqual(["'injury'", "'buried'", "'attack'", "'stranded'"]);
    expect(outcomes.match(/'(\w+)'/g)).toEqual(["'recovered'", "'hospitalised'", "'evacuated'", "'left'"]);
    expect(WORDS.test(kinds + outcomes)).toBe(false);
  });

  it('the scanner itself sees string literals and skips comments', () => {
    const l = literals("// 'died' in a comment\nconst a = 'he was killed'; /* 'dead' */ const b = `ok`;");
    expect(l.map((x) => x.text)).toEqual(["'he was killed'", '`ok`']);
  });
});
