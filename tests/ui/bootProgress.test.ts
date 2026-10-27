import { describe, it, expect } from 'vitest';
import { BOOT_STAGES, advance } from '@/ui/bootProgress';

describe('boot progress (pure)', () => {
  it('stages are strictly increasing and end at 100', () => {
    for (let i = 1; i < BOOT_STAGES.length; i++) expect(BOOT_STAGES[i]!.pct).toBeGreaterThan(BOOT_STAGES[i - 1]!.pct);
    expect(BOOT_STAGES.at(-1)!.pct).toBe(100);
  });
  it('never goes backwards', () => { expect(advance(70, 'world').pct).toBe(70); expect(advance(10, 'world').pct).toBe(48); });
  it('unknown stage is indeterminate', () => { expect(advance(40, 'nope').pct).toBeNull(); });
});
