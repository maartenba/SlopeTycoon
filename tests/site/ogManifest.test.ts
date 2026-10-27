import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OG_MANIFEST, ogInputsHash } from '../../scripts/site/ogCards';

describe('og card manifest', () => {
  it('matches the inputs the cards are rendered from (else: run npm run site:og)', () => {
    expect(existsSync(OG_MANIFEST), 'run npm run site:og').toBe(true);
    expect((JSON.parse(readFileSync(OG_MANIFEST, 'utf8')) as { inputs: string }).inputs, 'stale social cards: run npm run site:og').toBe(ogInputsHash());
  });
});
