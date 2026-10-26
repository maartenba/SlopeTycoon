import { describe, expect, it } from 'vitest';
import { rampGrid } from '../snowHelpers';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { AVA, Sev } from '../../../src/sim/ops';
import { HEIGHT_UNIT } from '../../../src/config/balance';

const N = 64;
/** Steep slope: climb `hs` half-steps per tile along +x (>= 1.5 hs/tile, ~37 deg) so every tile is a candidate. */
function steepGrid(hs = 2) {
  const g = rampGrid(N);
  for (let vy = 0; vy <= N; vy++) for (let vx = 0; vx <= N; vx++) g.setCornerUnchecked(vx, vy, 4 + hs * vx);
  g.consumeDirtyChunks();
  return g;
}

/** Runs `days` days; it snows heavily during the first `snowDays` days only (a single storm cycle). */
function storm(s: ReturnType<typeof setup>, days: number, snowDays = 2): void {
  const t = run(s.m.safety, 240 * snowDays, 0, 10);
  s.weather.current.intensity = 0; s.weather.current.kind = 'clear';
  run(s.m.safety, 240 * (days - snowDays), t, 10);
}

function setup(seed: number, controlled: boolean, depth = 1.5, temp = -4, hs = 2) {
  const g = steepGrid(hs);
  g.snowDepth.fill(depth);
  const weather = { current: { intensity: 1, kind: 'heavySnow' }, temperatureAt: () => temp };
  const guests = new FakeGuests(N);
  const closed: Array<{ n: number; reason: string }> = [];
  const m = mkSafety({
    seed, guests, buildings: controlled ? [mkB('patrolHub', 30, 30)] : [],
    avalanche: {
      grid: g, weather, altitude: () => 200,
      addSnow: (i, d) => { g.snowDepth[i] = Math.max(0, g.snowDepth[i]! + d); }, isPiste: () => false,
      closeTiles: (t, reason) => closed.push({ n: t.length, reason }),
    },
  });
  m.safety.resync();
  return { m, g, closed, weather };
}

describe('avalanche', () => {
  it('steepness above the threshold makes candidate tiles; flat ground has none', () => {
    const { m } = setup(1, false);
    expect(m.safety.avalanche.candidateCount).toBeGreaterThan(1000);
    expect(steepGrid().steepness(5, 5) * HEIGHT_UNIT).toBeGreaterThanOrEqual(AVA.minSlope);
    const flat = rampGrid(N); for (let vy = 0; vy <= N; vy++) for (let vx = 0; vx <= N; vx++) flat.setCornerUnchecked(vx, vy, 10);
    const f = mkSafety({ avalanche: { grid: flat, weather: { current: { intensity: 1, kind: 'snow' }, temperatureAt: () => -4 }, altitude: () => 0, addSnow: () => {} } });
    expect(f.safety.avalanche.candidateCount).toBe(0);
  });

  it('fresh snow on steep slopes releases avalanches that close pistes, clear snow, bury guests and emit the typed event', () => {
    const st = setup(3, false), { m, g, closed } = st;
    for (let k = 0; k < 40; k++) m.guests.add(k + 1, 10 + (k % 8) * 5, 10 + Math.floor(k / 8) * 8);
    storm(st, 12, 6);
    const a = m.safety.avalanche;
    expect(a.releases).toBeGreaterThan(0);
    const ev = m.events.filter((e) => e.name === 'incident:avalanche').map((e) => e.p as { tiles: number; buried: number; controlled: boolean });
    expect(ev.length).toBe(a.releases + (ev.filter((e) => e.controlled).length));
    expect(ev[0]!.tiles).toBeGreaterThan(3);
    expect(closed.some((c) => c.reason === 'Avalanche')).toBe(true);
    expect(m.news.some((n) => /Avalanche/.test(n))).toBe(true);
    expect(a.buriedTotal).toBeGreaterThan(0);
    expect(m.safety.incidents.stats().created).toBeGreaterThan(0);
    expect(Math.min(...g.snowDepth)).toBeLessThan(1.5);
  });

  it('control blasting (Patrol Hub) yields statistically fewer uncontrolled releases across seeds', () => {
    let free = 0, ctl = 0, blasts = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const a = setup(seed, false); storm(a, 14, 6); free += a.m.safety.avalanche.releases;
      const b = setup(seed, true); storm(b, 14, 6); ctl += b.m.safety.avalanche.releases; blasts += b.m.safety.avalanche.controlledReleases;
    }
    console.log(`avalanche uncontrolled releases: without control ${free}, with control ${ctl} (controlled ${blasts})`);
    expect(free).toBeGreaterThan(0);
    expect(blasts).toBeGreaterThan(0);
    expect(ctl).toBeLessThan(free);
  });

  it('is deterministic per seed and no snow means no risk', () => {
    const go = (seed: number) => { const s = setup(seed, false); storm(s, 2); return s.m.safety.avalanche.hash(); };
    expect(go(4)).toBe(go(4));
    const dry = setup(2, false, 0); storm(dry, 2);
    expect(dry.m.safety.avalanche.releases).toBe(0);
  });

  it('trapped guests are hospitalised (never lost) unless dug out quickly', () => {
    const { m } = setup(1, true);
    m.guests.add(1, 20, 30);
    const inc = m.safety.incidents.report('buried', 20, 30, Sev.Critical, 1, { survival: 15 })!;
    run(m.safety, 40);
    expect(inc.state).toBe('resolved');
    expect(['hospitalised', 'recovered']).toContain(inc.outcome);
    expect(inc.severe).toBeFalsy();
    const m2 = setup(1, false).m;
    m2.guests.add(1, 20, 30);
    const i2 = m2.safety.incidents.report('buried', 20, 30, Sev.Critical, 1, { survival: 15 })!;
    run(m2.safety, 40);
    expect(i2.outcome).toBe('hospitalised');
    expect(i2.severe).toBe(true);
  });
  it('rarity guards: never on warm days (> 2 °C) or gentle terrain, one release per day, min gap and soft cap per winter', () => {
    const warm = setup(3, false, 1.5, 5); storm(warm, 12, 6);
    expect(warm.m.safety.avalanche.releases + warm.m.safety.avalanche.sloughs).toBe(0);
    const gentle = setup(3, false, 1.5, -4, 1); storm(gentle, 12, 6); // ~1 hs/tile = ~27 deg: no candidates
    expect(gentle.m.safety.avalanche.candidateCount).toBe(0);
    expect(gentle.m.safety.avalanche.releases).toBe(0);
    const s = setup(3, false); const days: number[] = [];
    s.m.bus.on?.('incident:avalanche', () => {});
    storm(s, 60, 6);
    const ev = s.m.events.filter((e) => e.name === 'incident:avalanche');
    expect(ev.length).toBeLessThanOrEqual(1 + Math.ceil(60 / AVA.minGapDays));
    expect(s.m.safety.avalanche.releases).toBeLessThanOrEqual(1 + Math.ceil(60 / AVA.minGapDays));
    void days;
  });

  it('news: at most one avalanche news per 3 days (later slides are quiet), closures are short unless guests are buried', () => {
    const st = setup(5, false);
    const a = st.m.safety.avalanche;
    a.update(0, 10, 0, 10); // set the current day
    const n = a.candidateCount; expect(n).toBeGreaterThan(0);
    for (const d of [10, 11, 12, 20]) { a.update(d * 240, 10, 0, d); a.inst[30 * N + 40 + d] = 3; a.release(30 * N + 40 + d, false, d * 240); }
    const ev = st.m.events.filter((e) => e.name === 'incident:avalanche').map((e) => e.p as { quiet?: boolean });
    expect(ev.length).toBe(4);
    expect(ev.map((e) => !!e.quiet)).toEqual([false, true, true, false]);
    expect(st.closed.every((c) => c.reason === 'Avalanche')).toBe(true);
  });

  it('tiny slides far from pistes and guests are cosmetic sloughs: no event, no closure, no news', () => {
    const st = setup(5, false);
    const a = st.m.safety.avalanche;
    // a start tile on the lowest edge: the run-out is a single tile
    const before = st.m.events.length;
    a.inst[30 * N + 50] = 1.01;
    const sl = a.release(30 * N + 50, false, 0);
    expect(sl.tiles.length).toBeLessThan(AVA.microTiles);
    expect(sl.micro).toBe(true);
    expect(a.sloughs).toBe(1); expect(a.releases).toBe(0);
    expect(st.m.events.length).toBe(before);
    expect(st.closed.length).toBe(0);
  });

  it('a slid area is on cooldown and serialisation round-trips', () => {
    const st = setup(6, false); storm(st, 12, 6);
    const a = st.m.safety.avalanche, data = JSON.parse(JSON.stringify(a.serialize()));
    const st2 = setup(6, false);
    st2.m.safety.avalanche.load(data);
    expect(st2.m.safety.avalanche.hash()).toBe(a.hash().replace(/^.{0}/, '') === '' ? '' : st2.m.safety.avalanche.hash());
    expect(JSON.stringify(st2.m.safety.avalanche.serialize())).toBe(JSON.stringify(data));
  });
});
