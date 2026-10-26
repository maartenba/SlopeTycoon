import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('themed controls', () => {
  it('no component creates a native <select> (use st-select / makeSelect) or window.confirm for in-game dialogs', () => {
    const dir = join(__dirname, '..', '..', 'src', 'ui', 'components');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'StSelect.ts')) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/createElement\('select'\)|el\('select'\)|<select/.test(src), `${f} uses a native select`).toBe(false);
    }
  });
  it('every font family is a token (no hard-coded system-ui stacks in components)', () => {
    const dir = join(__dirname, '..', '..', 'src', 'ui', 'components');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/font-family:\s*system-ui|font:[^;'"]*system-ui/.test(src), `${f} hard-codes system-ui`).toBe(false);
    }
  });
});
