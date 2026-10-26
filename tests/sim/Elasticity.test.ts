import { describe, expect, it } from 'vitest';
import { demandMultiplier, mixVolume, valueFromRatio, roll, accepts, affordShare } from '@/sim/Elasticity';
import { TYPE_MIX } from '@/sim/guests/Spawner';
import { GUEST_TYPE_KEYS } from '@/config/marketing';

describe('elasticity', () => {
  it('is 1 at the fair price and monotone decreasing in price for every type', () => {
    for (const t of GUEST_TYPE_KEYS) {
      expect(demandMultiplier(t, 1)).toBeCloseTo(1, 6);
      let prev = Infinity;
      for (let r = 0.65; r <= 3; r += 0.05) { const m = demandMultiplier(t, r); expect(m, `${t} ${r}`).toBeLessThanOrEqual(prev + 1e-9); prev = m; }
    }
  });
  it('budget guests react much more than VIPs; VIPs shy away from very cheap offers', () => {
    expect(demandMultiplier('budget', 1.5)).toBeLessThan(demandMultiplier('vip', 1.5) * 0.7);
    expect(demandMultiplier('budget', 0.8)).toBeGreaterThan(demandMultiplier('vip', 0.8));
    expect(demandMultiplier('vip', 0.2)).toBeLessThan(demandMultiplier('vip', 0.6));
  });
  it('crowding cap: giving it away never attracts more than maxVolume', () => {
    for (const t of GUEST_TYPE_KEYS) expect(demandMultiplier(t, 0)).toBeLessThanOrEqual(1.6);
  });
  it('revenue-maximising day pass price is interior (neither free nor at the cap) for the default mix', () => {
    const fair = 45, min = 11, max = 120;
    let best = { p: 0, rev: -1 };
    for (let p = min; p <= max; p++) { const rev = p * mixVolume(TYPE_MIX.winter, p / fair); if (rev > best.rev) best = { p, rev }; }
    expect(best.p).toBeGreaterThan(min + 5);
    expect(best.p).toBeLessThan(max - 20);
  });
  it('cap-price revenue does not beat the balanced price; free earns nothing', () => {
    const rev = (p: number): number => p * mixVolume(TYPE_MIX.winter, p / 45);
    expect(rev(120)).toBeLessThan(rev(45) * 1.0);
    expect(rev(0)).toBe(0);
  });
  it('value-for-money falls with price and free tickets are capped', () => {
    expect(valueFromRatio(1)).toBeCloseTo(0.5, 6);
    expect(valueFromRatio(2.6)).toBeLessThan(0.2);
    expect(valueFromRatio(0, true)).toBeLessThanOrEqual(0.4);
    expect(valueFromRatio(0.5)).toBeGreaterThan(valueFromRatio(1));
  });
  it('rolls are deterministic and roughly uniform; accepts follows the multiplier', () => {
    expect(roll(5, 2)).toBe(roll(5, 2));
    let n = 0; for (let i = 0; i < 4000; i++) if (accepts('budget', 1.5, i, 3)) n++;
    expect(n / 4000).toBeGreaterThan(demandMultiplier('budget', 1.5) - 0.05);
    expect(n / 4000).toBeLessThan(demandMultiplier('budget', 1.5) + 0.05);
    expect(affordShare('budget')).toBeLessThan(affordShare('vip'));
  });
});
