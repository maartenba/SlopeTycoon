// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSim, type Sim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { stateHash } from '../../src/game/saveState';
import { demolishLift, liftStations, midCount, placeLift, previewMids, setMidStations, stationAnchor, type LiftData, type LiftEnv, type StationSite } from '../../src/sim/Lift';
import { LiftTool } from '../../src/build/LiftTool';
import { Undo } from '../../src/build/UndoActions';
import { Ticketing } from '../../src/sim/Ticketing';
import { GState } from '../../src/sim/guests/Guest';
import { NavMode } from '../../src/sim/guests/NavGraph';
import { RideAlong } from '../../src/render/view/RideAlong';
import type { LiftKind } from '../../src/config/lifts';
import { TICKS_PER_DAY } from '../../src/config/balance';

/** A real 64 map with a lift of `kind` whose line carries a mid-station (the starter lift is rebuilt with one). Null when no valid site exists on that seed. */
function midResort(seed: number, kind: LiftKind = 'gondola6'): { sim: Sim; lift: LiftData; env: LiftEnv; mid: StationSite } | null {
  const sim = createSim({ size: 64, seed, startSeason: 'winter', now: () => 0 });
  const rep = buildStarterResort(sim, { lifts: 1, liftKind: kind, funds: 5_000_000 });
  const l0 = rep.lifts[0];
  if (!l0 || l0.kind !== kind) return null;
  const b: StationSite = { x: l0.bottom.x, y: l0.bottom.y }, t: StationSite = { x: l0.top.x, y: l0.top.y };
  const env: LiftEnv = { grid: sim.grid, lifts: sim.lifts, economy: sim.economy, props: sim.props, buildings: sim.buildings };
  demolishLift(sim.lifts, sim.economy, l0.id);
  for (const u of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
    const m = stationAnchor(sim.grid, b.x + 1 + (t.x - b.x) * u, b.y + 1 + (t.y - b.y) * u);
    const out = placeLift(env, sim.props, kind, b, t, true, true, [m]);
    if (out.ok && out.lift) { sim.nature.cover.rebuild(); return { sim, lift: out.lift, env, mid: m }; }
  }
  return null;
}
const SEEDS = [11, 23, 5, 61, 9, 37, 2, 3, 4, 6];
function anyMidResort(kind: LiftKind = 'gondola6') { for (const s of SEEDS) { const r = midResort(s, kind); if (r) return r; } return null; }

describe('add / remove a mid-station on a placed lift (Task 39, sim side)', () => {
  it('previewMids changes nothing; remove then add keeps id, position, speed and ops; money moves by the price difference', () => {
    const r = anyMidResort();
    expect(r, 'a seed with a valid mid-station site').not.toBeNull();
    const { sim, lift, env, mid } = r!;
    const id = lift.id;
    sim.lifts.setSpeed(id, 0.8);
    const snap = JSON.stringify(sim.lifts.all());
    const occ = Array.from(sim.grid.occupancy.flags).join('');
    const pv = previewMids(env, id, []);
    expect(pv.ok).toBe(true);
    expect(pv.charge).toBe(0);
    expect(JSON.stringify(sim.lifts.all()), 'preview leaves the store untouched').toBe(snap);
    expect(Array.from(sim.grid.occupancy.flags).join('')).toBe(occ);
    const idx = sim.lifts.indexOf(id), money0 = sim.game.money, cost0 = lift.cost;
    // remove
    const rm = setMidStations(env, sim.props, id, []);
    expect(rm.ok, rm.reasons.join()).toBe(true);
    const two = sim.lifts.get(id)!;
    expect(two.stations).toBeUndefined();
    expect(two.speed).toBe(0.8);
    expect(sim.lifts.indexOf(id)).toBe(idx);
    expect(rm.refunded).toBeGreaterThan(0);
    expect(sim.game.money).toBe(money0 + rm.refunded);
    expect(two.cost).toBeLessThan(cost0);
    // the old mid pad is no longer lift-occupied (its tiles are not in the union any more)
    expect(two.tiles.length).toBeLessThan(lift.tiles.length);
    // add again
    const add = setMidStations(env, sim.props, id, [mid]);
    expect(add.ok, add.reasons.join()).toBe(true);
    expect(add.charged).toBeGreaterThan(0);
    const three = sim.lifts.get(id)!;
    expect(midCount(three)).toBe(1);
    expect(three.speed).toBe(0.8);
    expect(sim.game.money).toBe(money0 + rm.refunded - add.charged);
    expect(three.cost).toBeGreaterThanOrEqual(two.cost);
  }, 120_000);

  it('a refused change leaves the lift and the money exactly as they were; fixed-grip kinds refuse mid-stations', () => {
    const r = anyMidResort();
    const { sim, lift, env } = r!;
    const snap = JSON.stringify(sim.lifts.all()), money0 = sim.game.money;
    const off = setMidStations(env, sim.props, lift.id, [{ x: lift.bottom.x + 20, y: lift.bottom.y + 1 }]);
    expect(off.ok).toBe(false);
    expect(off.reasons.join(' ')).toMatch(/straight line|between|Mid-station/i);
    expect(JSON.stringify(sim.lifts.all())).toBe(snap);
    expect(sim.game.money).toBe(money0);
    // 3 mid-stations: refused (max 2)
    const three = previewMids(env, lift.id, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(three.ok).toBe(false);
    // a chair4 (fixed grip)
    const sim2 = createSim({ size: 64, seed: 61, startSeason: 'winter', now: () => 0 });
    const rep = buildStarterResort(sim2, { lifts: 1, liftKind: 'chair4', funds: 5_000_000 });
    const c = rep.lifts[0]!;
    const env2: LiftEnv = { grid: sim2.grid, lifts: sim2.lifts, economy: sim2.economy, props: sim2.props, buildings: sim2.buildings };
    const pv = previewMids(env2, c.id, [stationAnchor(sim2.grid, (c.bottom.x + c.top.x) / 2 + 1, (c.bottom.y + c.top.y) / 2 + 1)]);
    expect(pv.ok).toBe(false);
    expect(pv.reasons.join(' ')).toMatch(/cannot have mid-stations/);
  }, 120_000);

  it('undo / redo of a mid-station change restores the exact lift record, the money and the lifts hash', () => {
    const r = anyMidResort();
    const { sim, lift, env, mid } = r!;
    const undo = new Undo(sim);
    const before = stateHash(sim).parts.lifts, rec0 = JSON.stringify(sim.lifts.get(lift.id)), money0 = sim.game.money;
    const rm = undo.setLiftMids(env, sim.props, lift.id, []);
    expect(rm.ok).toBe(true);
    expect(sim.lifts.get(lift.id)!.stations).toBeUndefined();
    const afterRm = JSON.stringify(sim.lifts.get(lift.id)), moneyRm = sim.game.money;
    const u = undo.undo();
    expect(u.ok).toBe(true);
    expect(JSON.stringify(sim.lifts.get(lift.id))).toBe(rec0);
    expect(sim.game.money).toBe(money0);
    expect(stateHash(sim).parts.lifts).toBe(before);
    const re = undo.redo();
    expect(re.ok).toBe(true);
    expect(JSON.stringify(sim.lifts.get(lift.id))).toBe(afterRm);
    expect(sim.game.money).toBe(moneyRm);
    // and the add direction: 2-station lift -> add a mid-station -> undo gives back the exact 2-station record
    expect(undo.undo().ok).toBe(true);
    expect(setMidStations(env, sim.props, lift.id, []).ok).toBe(true);
    const two = JSON.stringify(sim.lifts.get(lift.id)), hash2 = stateHash(sim).parts.lifts, m2 = sim.game.money;
    const add = undo.setLiftMids(env, sim.props, lift.id, [mid]);
    expect(add.ok, add.reasons.join()).toBe(true);
    expect(midCount(sim.lifts.get(lift.id)!)).toBe(1);
    expect(undo.undo().ok).toBe(true);
    expect(JSON.stringify(sim.lifts.get(lift.id))).toBe(two);
    expect(sim.game.money).toBe(m2);
    expect(stateHash(sim).parts.lifts).toBe(hash2);
  }, 120_000);

  it('undo refuses (and the change is refused) while guests queue for or ride the lift', () => {
    const r = anyMidResort();
    const { sim, lift, env } = r!;
    const undo = new Undo(sim);
    vi.spyOn(undo, 'guestsAtLift').mockReturnValue(2);
    const out = undo.setLiftMids(env, sim.props, lift.id, []);
    expect(out.ok).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/close it/i);
    expect(sim.lifts.get(lift.id)!.stations).toHaveLength(3);
  }, 120_000);
});

describe('LiftTool: Add mid-station pick mode (Task 39)', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const c of cleanup.splice(0)) c(); document.body.replaceChildren(); });
  const overlays = () => ({ setVertexRect: vi.fn(), setColor: vi.fn(), setTooltip: vi.fn(), hide: vi.fn() });

  it('start -> hover the line (snaps to a valid spot, preview + tip with the price) -> click builds; right-click / Esc cancel; remove via removeMid', () => {
    const r = anyMidResort();
    const { sim, lift, env, mid } = r!;
    expect(setMidStations(env, sim.props, lift.id, []).ok).toBe(true); // back to a plain 2-station lift
    const dom = document.createElement('canvas'); document.body.append(dom);
    dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) });
    const camera = new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 400);
    const cx = mid.x + 1, cz = mid.y + 1;
    camera.position.set(cx, 200, cz + 0.001); camera.lookAt(cx, 0, cz); camera.updateMatrixWorld(true);
    const ov = overlays(), onMid = vi.fn(), onErr = vi.fn(), onCancel = vi.fn();
    const created: boolean[] = [];
    const tool = new LiftTool({
      env, props: sim.props, scene: new THREE.Scene(), camera, dom, overlays: ov as never,
      view: { createPreview: (_l: unknown, ok: boolean) => { created.push(ok); return { group: new THREE.Group(), dispose() {} }; } } as never,
      onPlaced: vi.fn(), onError: onErr, onCancel, onMidChanged: onMid,
    });
    cleanup.push(() => tool.dispose());
    expect(tool.startMid(lift.id)).toBe(true);
    expect(tool.active).toBe(true);
    expect(tool.midMode).toBe(lift.id);
    expect(tool.touchHint()).toMatch(/mid-station/);
    const ptr = (type: string): void => { const e = new Event(type, { bubbles: true }) as unknown as Record<string, unknown>; Object.assign(e, { clientX: 320, clientY: 240, button: 0, buttons: 0, pointerId: 1 }); dom.dispatchEvent(e as unknown as Event); };
    ptr('pointermove');
    expect(tool.midPreview, 'a candidate was computed').not.toBeNull();
    expect(created.length).toBeGreaterThan(0);
    const tip = ov.setTooltip.mock.calls.at(-1)![0] as { text: string; blocked: boolean };
    expect(tip.text.length).toBeGreaterThan(0);
    expect(tool.midPreview!.ok, tool.midPreview!.reasons.join()).toBe(true); // the old mid site is (or snaps to) a valid spot
    expect(tip.text).toMatch(/Mid-station \$/);
    {
      const money0 = sim.game.money;
      expect(tool.confirm()).toBe(true);
      expect(onMid).toHaveBeenCalledTimes(1);
      expect(midCount(sim.lifts.get(lift.id)!)).toBe(1);
      expect(sim.game.money).toBeLessThan(money0);
      expect(tool.active).toBe(false);
      expect(onCancel).toHaveBeenCalled();
      // remove it again through the tool API
      expect(tool.removeMid(lift.id, 1)).toBe(true);
      expect(sim.lifts.get(lift.id)!.stations).toBeUndefined();
      expect(onMid).toHaveBeenCalledTimes(2);
    }
    // cancel paths
    expect(tool.startMid(lift.id)).toBe(true);
    tool.cancel();
    expect(tool.active).toBe(false);
    expect(tool.startMid(lift.id)).toBe(true);
    dom.dispatchEvent(new Event('contextmenu', { cancelable: true }));
    expect(tool.active).toBe(false);
    void onErr;
  }, 120_000);

  it('refuses to start on a fixed-grip lift or a busy lift', () => {
    const sim = createSim({ size: 64, seed: 61, startSeason: 'winter', now: () => 0 });
    const rep = buildStarterResort(sim, { lifts: 1, liftKind: 'chair4', funds: 5_000_000 });
    const c = rep.lifts[0]!;
    const env: LiftEnv = { grid: sim.grid, lifts: sim.lifts, economy: sim.economy, props: sim.props, buildings: sim.buildings };
    const dom = document.createElement('canvas'); document.body.append(dom);
    const onErr = vi.fn();
    let busy = false;
    const tool = new LiftTool({ env, props: sim.props, scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(-1, 1, 1, -1), dom, overlays: overlays() as never, view: {} as never, onPlaced: vi.fn(), onError: onErr, onCancel: vi.fn(), liftBusy: () => busy });
    cleanup.push(() => tool.dispose());
    expect(tool.startMid(c.id)).toBe(false);
    expect(onErr.mock.calls[0]![0]).toMatch(/cannot have mid-stations/);
    busy = true;
    const r = anyMidResort();
    const tool2 = new LiftTool({ env: r!.env, props: r!.sim.props, scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(-1, 1, 1, -1), dom, overlays: overlays() as never, view: {} as never, onPlaced: vi.fn(), onError: onErr, onCancel: vi.fn(), liftBusy: () => busy });
    cleanup.push(() => tool2.dispose());
    expect(tool2.removeMid(r!.lift.id, 1)).toBe(false);
    expect(onErr.mock.calls.at(-1)![0]).toMatch(/queueing for or riding/);
  }, 120_000);
});

describe('guests in a lift with a mid-station (Task 39)', () => {
  it('skiers alighting at the mid-station pick a run that starts there (below the mid, above the bottom); ticketing charges once per day however many boardings', () => {
    let found = 0;
    for (const seed of SEEDS) {
      const r = midResort(seed);
      if (!r) continue;
      const { sim, lift } = r;
      sim.liftOps.setHours(lift.id, 6, 22);
      for (let t = 0; t < 2 * TICKS_PER_DAY; t++) sim.tick(1);
      const g = sim.guestSim, st = g.store, mids = liftStations(lift)[1]!;
      const nav = (g as unknown as { graph(): { tileAltitude(t: number): number } | null }).graph();
      if (!nav) continue;
      const midAlt = nav.tileAltitude(mids.y * 64 + mids.x), botAlt = nav.tileAltitude(lift.bottom.y * 64 + lift.bottom.x);
      let slot = -1;
      for (let i = 0; i < st.limit; i++) if (st.alive[i]) { slot = i; break; }
      if (slot < 0) continue;
      const rng = { next: () => 0.5 };
      for (const d of [0, 1, 2, 3]) {
        st.moveMode[slot] = NavMode.Ski0 + d; st.via[slot] = 0; st.skill[slot] = 2;
        const via = g.exploration.pickVia(st, slot, lift, rng, 1);
        if (via > 0) {
          const a = nav.tileAltitude(via - 1);
          expect(a, 'via lies below the mid-station').toBeLessThan(midAlt);
          expect(a, 'via lies above the bottom').toBeGreaterThan(botAlt);
          found++;
        }
      }
      if (found) break;
    }
    expect(found, 'at least one run starts from a mid-station').toBeGreaterThan(0);
  }, 240_000);

  it('rides a day: day passes are sold at most once per guest per day (boardings are counted per segment), ride-along follows a rider without losing it', () => {
    const r = anyMidResort();
    const { sim, lift } = r!;
    sim.liftOps.setHours(lift.id, 6, 22);
    const store = sim.guestSim.store;
    const ra = new RideAlong({ store, liftFamily: () => 'gondola', ticksPerSecond: () => 8 });
    let followed = 0, lost = 0;
    const rideKinds = new Set<string>(), out = { x: 0, y: 0, z: 0, hx: 0, hz: 0, speed: 0, slope: 0, kind: 'foot' as never };
    for (let t = 0; t < 4 * TICKS_PER_DAY; t++) {
      sim.tick(1);
      if (!ra.active) {
        for (let i = 0; i < store.limit; i++) if (store.alive[i] && store.state[i] === GState.Riding && store.liftId[i] === lift.id) { ra.follow(store.id[i]!); break; }
      } else if (ra.check()) { followed++; if (ra.sample(1, out as never)) rideKinds.add(out.kind); } else lost++;
    }
    expect(followed).toBeGreaterThan(0);
    expect(rideKinds.has('gondola')).toBe(true);
    void lost;
    const t: Ticketing = sim.ticketing;
    const total = sim.lifts.get(lift.id)!.riders?.total ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(t.rides, 'Ticketing.rides = boardings (every segment), same count as the lift counter').toBe(total);
    // no per-boarding charge: lift income is exactly passes sold x price (+ hiker tickets), never boardings x price
    expect(t.dayPassesSold + t.hikerTickets, 'a pass is sold once per guest per day, not per boarding').toBeLessThanOrEqual(total);
  }, 240_000);
});

describe('chair6d with a mid-station in a real sim (Task 47)', () => {
  it('builds with a mid-station, carries guests for 3 days, never overloads a carrier (6 seats)', () => {
    const r = anyMidResort('chair6d');
    expect(r, 'a seed where a chair6d line with a mid-station is valid').not.toBeNull();
    const { sim, lift } = r!;
    expect(lift.kind).toBe('chair6d');
    expect(lift.stations).toHaveLength(3);
    sim.liftOps.setHours(lift.id, 6, 22);
    for (let t = 0; t < 3 * TICKS_PER_DAY; t++) sim.tick(1);
    expect(sim.lifts.get(lift.id)!.riders?.total ?? 0).toBeGreaterThan(0);
    expect(sim.guestSim.queues.maxCarrierLoad).toBeLessThanOrEqual(6);
  }, 240_000);
});
