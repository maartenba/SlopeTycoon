import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Voice lint (M7.2): the site is written in the owner's plain, friendly voice. These phrases read as filler or AI-speak, so they may not come back. */
export const BANNED: Array<[RegExp, string]> = [
  [/\bseamless(ly)?\b/i, 'seamless'], [/\bimmers(e|ive|ion)\b/i, 'immersive'], [/\bdive (in|into|deep)\b/i, 'dive into'], [/\bunleash/i, 'unleash'], [/\belevate/i, 'elevate'],
  [/\brevolution/i, 'revolutionise'], [/\bgame-?changer/i, 'game-changer'], [/\bcutting-edge\b/i, 'cutting-edge'], [/\bstate-of-the-art\b/i, 'state-of-the-art'], [/\bunparalleled\b/i, 'unparalleled'],
  [/\bembark/i, 'embark'], [/\bdelve/i, 'delve'], [/\btapestry\b/i, 'tapestry'], [/\bjourney\b/i, 'journey'], [/\bstunning(ly)?\b/i, 'stunning'], [/\bbreathtaking\b/i, 'breathtaking'], [/\bvibrant\b/i, 'vibrant'],
  [/\bnestled\b/i, 'nestled'], [/\bleverag(e|ing)\b/i, 'leverage'], [/\bultimate\b/i, 'ultimate'], [/\bworld-class\b/i, 'world-class'], [/\bwhether you(?:'|’)?re\b/i, "whether you're"], [/\bnot just\b[^.]{0,60}\bbut\b/i, 'not just X but Y'],
  [/\bit(?:'|’)?s worth noting\b/i, "it's worth noting"], [/\bin today(?:'|’)?s\b/i, "in today's"], [/\bat the end of the day\b/i, 'at the end of the day'], [/\bfurthermore\b/i, 'furthermore'], [/\bmoreover\b/i, 'moreover'],
  [/\bwhole new level\b/i, 'whole new level'], [/\bthe perfect\b/i, 'the perfect'], [/!!+/, 'double exclamation'],
];
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
/** Files whose copy is checked (the generated sections of the guide are not: they come from game data). Allow-list: `file: phrase`, with a reason. */
const FILES = [...walk('site').filter((f) => /\.(md|json)$/.test(f) && !f.includes('shots') && !f.includes('assets/') && !f.endsWith('README.md') && !f.endsWith('manifest.json')), 'site/index.html', 'scripts/site/faq.ts'];
const ALLOW: Record<string, string[]> = {};

describe('voice: no AI-isms or filler on the site', () => {
  it('lists real files', () => { expect(FILES.length).toBeGreaterThan(30); });
  for (const f of FILES) it(f, () => {
    const t = readFileSync(f, 'utf8').replace(/^---[\s\S]*?\n---\n/, (m) => m); // front matter is copy too
    const bad = BANNED.filter(([re, name]) => re.test(t) && !(ALLOW[f] ?? []).includes(name)).map(([, n]) => n);
    expect(bad, `${f}: ${bad.join(', ')}`).toEqual([]);
  });
  it('em dashes are rare (at most 3 per file, none in the landing page copy)', () => {
    for (const f of FILES) { const n = (readFileSync(f, 'utf8').match(/—/g) ?? []).length; expect(n, f).toBeLessThanOrEqual(3); }
    expect(readFileSync('site/index.html', 'utf8')).not.toContain('—');
  });
});
