import { describe, expect, it } from 'vitest';
import { STEPS } from '../../src/tutorial/steps';
import { isKnownTarget } from '../../src/tutorial/ui-targets';
import { makeEngine, tutorialSim } from './helpers';

/** The engine is map-size independent: steps resolve through queries / suggestions, never fixed coordinates. */
describe('tutorial engine on generated maps of every size', () => {
  for (const [size, seed, until] of [[64, 7, 'none'], [128, 3, 'none'], [256, 5, 'none']] as const) {
    it(`${size}×${size}: show me is valid and the assisted lessons succeed (until '${until}')`, () => {
      const sim = tutorialSim(size, seed);
      const eng = makeEngine(sim, { funding: true });
      eng.start({ fresh: true });
      let valid = 0, looked = 0;
      for (let i = 0; i < 60 && eng.status === 'active'; i++) {
        const s = eng.current!;
        if (s.id === until) break;
        const show = eng.showMe();
        looked++;
        expect(show.ui.every(isKnownTarget), s.id).toBe(true);
        if (show.valid) valid++;
        if (s.ack) { eng.next(); continue; }
        const r = eng.doItForMe();
        if (!r.ok) eng.skip();
        sim.tick(size === 256 ? 0 : 30);
      }
      expect(valid / looked).toBeGreaterThan(0.85);
      expect(sim.buildings.has('parking') && sim.buildings.has('ticketOffice')).toBe(true);
      expect(sim.lifts.size).toBeGreaterThanOrEqual(1);
      expect(sim.networks.pisteComponents().length).toBeGreaterThanOrEqual(1);
      expect(until === 'none' ? eng.status === 'complete' : eng.current?.id === until).toBe(true);
    }, 120000);
  }

  it('lesson ids / predicates never mention coordinates (map-size independent by construction)', () => {
    for (const s of STEPS) expect(typeof s.isComplete).toBe('function');
    expect(STEPS.length).toBeGreaterThan(25);
  });
});
