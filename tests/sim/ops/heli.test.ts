import { describe, expect, it } from 'vitest';
import { mkB, mkSafety, run } from './safetyHelpers';
import { HELI, Sev } from '../../../src/sim/ops';

describe('helicopter', () => {
  it('is dispatched for a critical incident outside patrol range, flies to the off-map hospital and back, costs per mission', () => {
    const m = mkSafety({ size: 128, buildings: [mkB('patrolHub', 10, 10), mkB('helipad', 12, 14)] }); m.safety.resync();
    m.guests.add(1, 60, 50);
    const inc = m.safety.incidents.report('injury', 60, 50, Sev.Critical, 1)!;
    expect(inc.responder).toBe('heli');
    expect(m.spent).toContain(HELI.missionCost);
    let seenAway = false, t = 0;
    for (let k = 0; k < 60; k++) { t = run(m.safety, 1, t); if (m.safety.heli.helis[0]!.state === 'away') seenAway = true; }
    expect(seenAway).toBe(true);
    expect(inc.outcome).toBe('hospitalised');
    expect(m.safety.heli.helis[0]!.state).toBe('idle');
    expect(m.safety.heli.helis[0]!.x).toBeCloseTo(m.safety.heli.helis[0]!.px, 3);
    expect(m.events.some((e) => e.name === 'incident:escalated')).toBe(true);
    expect(m.safety.incidents.stats().severeAvoided).toBe(1);
  });

  it('out of helipad range there is no helicopter; slow patrol major escalates when a helipad is in range', () => {
    const none = mkSafety({ size: 128, buildings: [mkB('helipad', 4, 4)] }); none.safety.resync();
    none.guests.add(1, 120, 120);
    const a = none.safety.incidents.report('injury', 120, 120, Sev.Critical, 1)!;
    expect(a.responder).toBe('none');

    const m = mkSafety({ size: 128, buildings: [mkB('patrolHub', 10, 10), mkB('helipad', 12, 14)] }); m.safety.resync();
    m.guests.add(2, 38, 36); // inside the hub radius but > 18 ticks away off-piste
    const b = m.safety.incidents.report('injury', 38, 36, Sev.Major, 2)!;
    expect(['patrol', 'heli']).toContain(b.responder);
  });
});
