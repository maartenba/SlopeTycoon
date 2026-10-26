import { describe, expect, it } from 'vitest';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { Sev } from '../../../src/sim/ops';

const injure = (m: ReturnType<typeof mkSafety>, id: number, x: number, y: number, sev: number) => {
  m.guests.add(id, x, y);
  return m.safety.incidents.report('injury', x, y, sev, id)!;
};

describe('incidents + patrol', () => {
  it('a Patrol Hub rescues an injured skier (observable events, guest released, cost booked)', () => {
    const m = mkSafety({ buildings: [mkB('patrolHub', 10, 10)] });
    m.safety.resync();
    const inc = injure(m, 1, 20, 14, Sev.Major);
    expect(inc.state === 'open' || inc.state === 'responding').toBe(true);
    run(m.safety, 60);
    expect(m.safety.incidents.open.length).toBe(0);
    const st = m.safety.incidents.stats();
    expect(st.resolved).toBe(1);
    expect(st.meanResponseTicks).toBeGreaterThan(0);
    expect(m.events.map((e) => e.name)).toEqual(expect.arrayContaining(['incident:created', 'incident:resolved']));
    expect(m.guests.released.length).toBe(1);
    expect(m.spent.length).toBeGreaterThan(0);
  });

  it('response time is lower with a closer hub', () => {
    const resp = (hx: number): number => {
      const m = mkSafety({ buildings: [mkB('patrolHub', hx, 10)] }); m.safety.resync();
      const inc = injure(m, 1, 40, 12, Sev.Major);
      run(m.safety, 80);
      return inc.responseTicks;
    };
    const near = resp(36), far = resp(14);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
  });

  it('a First-Aid Hut treats minors on site', () => {
    const m = mkSafety({ buildings: [mkB('firstAid', 10, 10)] }); m.safety.resync();
    const inc = injure(m, 1, 16, 14, Sev.Minor);
    run(m.safety, 30);
    expect(inc.outcome).toBe('recovered');
    expect(inc.responder).toBe('firstAid');
    expect(m.guests.released[0]!.how).toBe('return');
  });

  it('without any hub incidents stay unresolved, hit the penalty and post a helpful toast; nothing blocks forever', () => {
    const m = mkSafety({});
    m.safety.resync();
    const inc = injure(m, 1, 20, 20, Sev.Minor);
    expect(m.news.some((n) => /Ski Patrol Hub/.test(n))).toBe(true);
    let t = run(m.safety, 40);
    expect(m.safety.incidents.open.length).toBe(1);
    expect(m.safety.incidents.stats().unresolved).toBe(1);
    expect(m.safety.incidents.stats().penalty).toBeGreaterThan(0);
    t = run(m.safety, 200, t);
    expect(inc.severity).toBe(Sev.Critical); // minor -> major -> critical
    run(m.safety, 700, t);
    expect(m.safety.incidents.open.length).toBe(0); // neglected critical: hospital care, never a death
    expect(inc.outcome).toBe('hospitalised');
    expect(inc.severe).toBe(true);
    expect(m.safety.incidents.stats().severe).toBe(1);
    expect(m.safety.incidents.stats().recovered).toBe(0);
  });

  it('removing the Patrol Hub makes rescues fail', () => {
    const hub = mkB('patrolHub', 10, 10);
    const ok = mkSafety({ buildings: [hub] }); ok.safety.resync();
    const a = injure(ok, 1, 20, 14, Sev.Major);
    run(ok.safety, 80);
    expect(a.outcome === 'recovered' || a.outcome === 'hospitalised').toBe(true);

    const m = mkSafety({ buildings: [hub] }); m.safety.resync();
    const b = injure(m, 1, 20, 14, Sev.Major);
    run(m.safety, 2);
    m.blds.length = 0; m.cov.refresh(m.blds); // bulldoze the hub mid-response
    run(m.safety, 80, 2);
    expect(b.state).not.toBe('resolved');
    expect(m.safety.patrol.agents.length).toBe(0);
    expect(m.safety.incidents.stats().recovered + m.safety.incidents.stats().hospitalised).toBe(0);
  });

  it('coverage reduces bad outcomes (hub+helipad vs none) over many critical incidents', () => {
    const batch = (blds: Array<ReturnType<typeof mkB>>): { severe: number; saved: number } => {
      const m = mkSafety({ buildings: blds, seed: 5 }); m.safety.resync();
      let t = 0;
      for (let k = 0; k < 12; k++) { injure(m, k + 1, 12 + (k % 5) * 6, 14 + (k % 3) * 5, Sev.Critical); t = run(m.safety, 12, t); }
      run(m.safety, 400, t);
      const s = m.safety.incidents.stats();
      return { severe: s.severe, saved: s.hospitalised + s.recovered - s.severe };
    };
    const none = batch([]);
    const covered = batch([mkB('patrolHub', 10, 10), mkB('helipad', 30, 30)]);
    expect(covered.severe).toBeLessThan(none.severe);
    expect(covered.saved).toBeGreaterThan(none.saved);
  });

  it('is deterministic (hash)', () => {
    const go = (): string => {
      const m = mkSafety({ buildings: [mkB('patrolHub', 10, 10)], seed: 9 }); m.safety.resync();
      let t = 0;
      for (let k = 0; k < 6; k++) { injure(m, k + 1, 12 + k * 5, 15, k % 3); t = run(m.safety, 15, t); }
      run(m.safety, 100, t);
      return m.safety.hash();
    };
    expect(go()).toBe(go());
  });

  it('patrol staff is adjustable', () => {
    const hub = mkB('patrolHub', 10, 10);
    const m = mkSafety({ buildings: [hub] }); m.safety.resync();
    expect(m.safety.patrol.sledsOf(hub.id)).toBe(2);
    m.safety.patrol.setStaff(hub.id, 4); m.safety.resync();
    expect(m.safety.patrol.sledsOf(hub.id)).toBe(4);
    m.safety.patrol.setStaff(hub.id, 1); m.safety.resync();
    expect(m.safety.patrol.sledsOf(hub.id)).toBe(1);
  });
});
void FakeGuests;
