/** `npm run docs:rules`: rewrite the generated rules block of docs/placement-rules.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import { withRulesBlock } from './rulesTable';

const p = 'docs/placement-rules.md';
writeFileSync(p, withRulesBlock(readFileSync(p, 'utf8')));
console.log('rules block written to', p);
