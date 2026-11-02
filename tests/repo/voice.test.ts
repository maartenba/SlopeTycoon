import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Voice lint, part 2 (M7.2 follow-up). tests/site/voice.test.ts bans single filler words on the website; this one covers every public text
 * (site sources, CHANGELOG, README, outreach drafts) and the strings players read in the game, with sentence-shape patterns as well:
 * "not just X but Y", "it's not X, it's Y", "Here's the thing", rhetorical openers, staccato "No X. No Y." slogans, "Let's", "ready to" and similar.
 * The owner's voice is plain, friendly and modest; these constructions read as machine-written. Allow-list entries (below) need a reason.
 */
export const PATTERNS: Array<[RegExp, string]> = [
  [/\bnot (just|only|merely) [^.\n]{1,70}\bbut (also )?/i, 'not just X but Y'],
  [/\bmore than just\b/i, 'more than just'],
  [/\b(isn(?:'|’)t|is not|it(?:'|’)s not|it is not) (just )?[^.,;\n]{1,40}[,;] (it(?:'|’)s|it is|but)\b/i, "it's not X, it's Y"],
  [/\bwhether you(?:'|’)?re\b/i, "whether you're A or B"],
  [/\bhere(?:'|’)s the (thing|catch|deal|truth)\b/i, "here's the thing"],
  [/\bthat(?:'|’)s the (thing|part|beauty)\b/i, "that's the thing"],
  [/\b(the best part|the secret|the magic)\?/i, 'the best part?'],
  [/\b(and )?honestly,/i, 'honestly,'],
  [/\bthe truth is\b/i, 'the truth is'],
  [/\bin a world where\b/i, 'in a world where'],
  [/\bevery \w+ has a (story|secret)\b/i, 'every X has a story'],
  [/\b(that is|that(?:'|’)s) the (part|thing) I (care|love|like) (about )?(the )?most\b/i, 'announced importance'],
  [/\b(what|which) matters (most|more)\b/i, 'what matters most'],
  [/\bletting?(?:'|’)?s (dive|go|get|build|see|explore)\b/i, "let's go"],
  [/\blet(?:'|’)s\b(?! put it back)/i, "Let's"],
  [/\b(ready|waiting) (to|for) (you|dive|play|embark|build|take)\b/i, 'ready to'],
  [/\b(love letter|passion project|labou?r of love)\b/i, 'love letter'],
  [/\b(craft(ed|ing)? (a|an|the|your|every))\b/i, 'crafted'],
  [/\b(navigate|navigating) (the|your|a)\b/i, 'navigate'],
  [/\b(landscape of|realm of|world of)\b/i, 'landscape of'],
  [/\b(testament to|a joy to|sure to|bound to|look no further)\b/i, 'testament to'],
  [/\b(perfect for|ideal for|great for)\b/i, 'perfect for'],
  [/\b(an? )?(truly|genuinely|incredibly|absolutely|utterly|effortless(ly)?|beautifully|lovingly|meticulous(ly)?)\b/i, 'intensifier'],
  [/\b(at your fingertips|take it to the next level|next level|come to life|comes alive|brings? [^.]{0,25} to life)\b/i, 'cliche'],
  [/\b(whole|brand) new (world|way|experience)\b/i, 'whole new world'],
  [/\b(fast|simple|easy|fun|free|small|friendly|quick),? (and )?(fast|simple|easy|fun|free|small|friendly|quick)(,| and) (fast|simple|easy|fun|free|small|friendly|quick)\b/i, 'fast, fun and free'],
  [/(?:^|[.!?"”] )(No [\w -]{1,22}\.) (No [\w -]{1,22}\.)/m, 'No X. No Y. slogan'],
  [/\bJust (play|build|ski|click|enjoy|open)\b\.?/, 'Just play.'],
  [/(?:^|\n)(?:> )?(Why|Want|Ever|Looking|Tired|Ready|Imagine|Picture)\b[^.\n]{0,70}\?/, 'rhetorical opener'],
  [/\b(game|tycoon)[- ]chang\w+\b/i, 'game-changing'],
  [/\b(rich|deep|vibrant|living|breathing) (and|,) (rich|deep|vibrant|detailed)\b/i, 'adjective pair'],
  [/\bdelight(s|ed|ful(ly)?)?\b/i, 'delight'],
];
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const MARKETING = ['site/index.html', ...walk('site/landing'), ...walk('site/pages'), 'site/devlog/intros.json', 'docs/outreach-drafts.md'].filter((f) => /\.(md|html|json)$/.test(f));
const PLAYER = [...MARKETING, ...walk('site/guide').filter((f) => f.endsWith('.md')), 'README.md', 'CHANGELOG.md', 'scripts/site/faq.ts', 'scripts/site/templates.ts', 'src/tutorial/strings.ts', 'src/sim/advisor/strings.ts', 'src/ui/buildInfo.ts', 'src/ui/components/StMainMenu.ts', 'src/ui/components/StHelp.ts', 'src/config/festivals.ts'].filter((f) => existsSync(f));
/** Allow-list: `file: [pattern name]`. Each entry needs a reason. */
const ALLOW: Record<string, string[]> = {

  'docs/outreach-drafts.md': ['rhetorical opener'], // drafts quote the titles of threads the owner is replying to ("I would really like to play ski resort tycoon again")
  'scripts/site/templates.ts': ["Let's", 'whether you\'re A or B'], // code comments / identifiers, not copy
  'src/tutorial/strings.ts': ["Let's"], // the assistant's own voice: "Let’s put it back" is a plain sentence
};
const strip = (f: string, t: string): string => (f.endsWith('.ts') ? t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') : t);

describe('voice (public text and player-facing strings)', () => {
  it('lists real files', () => { expect(MARKETING.length).toBeGreaterThan(8); expect(PLAYER.length).toBeGreaterThan(30); });
  for (const f of PLAYER) it(`no machine-written constructions: ${f}`, () => {
    const t = strip(f, readFileSync(f, 'utf8'));
    const bad = PATTERNS.filter(([re, name]) => re.test(t) && !(ALLOW[f] ?? []).includes(name)).map(([, n]) => n);
    expect(bad, `${f}: ${bad.join(', ')}`).toEqual([]);
  });
  it('the landing page and About keep the owner wording', () => {
    expect(readFileSync('site/pages/about.md', 'utf8')).toContain('This is the game I wanted to build, one day. Here we are!');
    expect(readFileSync('site/index.html', 'utf8')).toContain('This is the game I wanted to build, one day. Here we are!');
  });
  it('no technical or time-claim copy on the landing pages', () => {
    for (const f of MARKETING.filter((x) => !x.includes('privacy') && !x.includes('outreach'))) {
      const t = readFileSync(f, 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
      expect(t, f).not.toMatch(/generated from a seed|first hour|in minutes|first (ten|five|10|5) minutes|a browser tab, and|in a few (seconds|minutes)/i);
    }
  });
  it('em dashes stay rare (at most 2 per public file, none in marketing copy)', () => {
    for (const f of PLAYER) expect((readFileSync(f, 'utf8').match(/—/g) ?? []).length, f).toBeLessThanOrEqual(f === 'CHANGELOG.md' ? 10 : 2);
    for (const f of MARKETING) expect(readFileSync(f, 'utf8'), f).not.toContain('—');
  });
  it('lists of three ("a, b and c") stay under a density cap in marketing copy', () => {
    const tri = /\b[A-Za-z'’-]+(?: [A-Za-z'’-]+)?, [A-Za-z'’-]+(?: [A-Za-z'’-]+)?,? (?:and|or) [A-Za-z'’-]+/g;
    for (const f of MARKETING) {
      const t = readFileSync(f, 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
      const words = t.split(/\s+/).length;
      expect(((t.match(tri) ?? []).length * 1000) / words, `${f}: triads per 1000 words`).toBeLessThanOrEqual(15);
    }
  });
  it('semicolons are not a style: at most 3 per marketing file', () => {
    for (const f of MARKETING) expect((readFileSync(f, 'utf8').replace(/^---[\s\S]*?\n---\n/, '').match(/; /g) ?? []).length, f).toBeLessThanOrEqual(3);
  });
});
