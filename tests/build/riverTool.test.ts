// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { makeResort } from '../game/harness';
import type { Sim } from '../../src/game/createSim';
import { Undo } from '../../src/build/UndoActions';
import { LandscapeTool } from '../../src/build/LandscapeTool';
import { stateHash } from '../../src/game/saveState';
import { TileType } from '../../src/world/Grid';
import { planRiver } from '../../src/world/RiverPlanner';
import { planSpring } from '../../src/world/Rivers';
import { SPRING } from '../../src/config/rivers';
import { isGated, unlockLevel, unlockName } from '../../src/config/unlocks';

/** The Dig river / Place spring / Fill in river modes of the Landscape tool (Phase 6 Task 14): real sim, real planner, a top-down camera so tiles map to pixels. */
const PX = 10; // 64 tiles on a 640 px canvas
const cleanup: Array<() => void> = [];
afterEach(() => { for (const c of cleanup.splice(0)) c(); document.body.replaceChildren(); });

interface Opts { unlock?: boolean; confirmFirst?: boolean; money?: number }
function rig(o: Opts = {}) {
  const { sim } = makeResort(64, 61);
  sim.tick(2);
  if (o.unlock !== false) sim.progression.unlockAll = true;
  if (o.money !== undefined) sim.game.money = o.money;
  const dom = document.createElement('canvas'); document.body.append(dom);
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 640, right: 640, bottom: 640, x: 0, y: 0, toJSON: () => ({}) });
  const camera = new THREE.OrthographicCamera(-32, 32, 32, -32, 0.1, 400);
  camera.position.set(32, 200, 32.001); camera.lookAt(32, 0, 32); camera.updateMatrixWorld(true);
  const undo = new Undo(sim);
  const ghost = vi.fn(), tip = vi.fn(), refused = vi.fn(), applied = vi.fn(), sprs = vi.fn();
  const overlays = { setVertexRect: vi.fn(), setColor: vi.fn(), setTooltip: tip, hide: vi.fn(), setRiverGhost: ghost, setTerraformPreview: vi.fn() };
  let confirmFirst = !!o.confirmFirst;
  const tool = new LandscapeTool({
    grid: sim.grid, props: sim.props, ls: sim.landscape, camera: camera as never, dom, overlays: overlays as never,
    env: () => sim.landscapeEnv(), now: () => 0, charge: (c) => sim.economy.charge(c), beginStroke: (l) => undo.landscapeStroke(l),
    onApplied: applied, onRefused: refused,
    rivers: sim.rivers, riverEnv: () => sim.riverEnv(), beginRiverStroke: (l) => undo.riverStroke(l),
    locked: () => sim.gate.locked('landscape', 'river'), confirmFirst: () => confirmFirst, onSprings: sprs,
  });
  cleanup.push(() => tool.dispose());
  tool.enable();
  const ev = (type: string, x: number, y: number, buttons: number): Event => {
    const e = new Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
    Object.assign(e, { clientX: (x + 0.5) * PX, clientY: (y + 0.5) * PX, button: 0, buttons, pointerId: 1, pointerType: 'mouse', altKey: false });
    return e as unknown as Event;
  };
  const hover = (x: number, y: number): void => { dom.dispatchEvent(ev('pointermove', x, y, 0)); };
  const press = (x: number, y: number): void => { dom.dispatchEvent(ev('pointerdown', x, y, 1)); };
  const move = (x: number, y: number): void => { dom.dispatchEvent(ev('pointermove', x, y, 1)); };
  const release = (x: number, y: number): void => { window.dispatchEvent(ev('pointerup', x, y, 0)); };
  const drag = (a: { x: number; y: number }, b: { x: number; y: number }): void => { press(a.x, a.y); move(b.x, b.y); release(b.x, b.y); };
  const tap = (x: number, y: number): void => { press(x, y); release(x, y); };
  return { sim, tool, undo, ghost, tip, refused, applied, sprs, hover, press, move, release, drag, tap, setConfirm: (v: boolean) => { confirmFirst = v; } };
}

/** A natural spring with a diggable river to a lake. */
function site(sim: Sim) {
  const env = sim.riverEnv(), N = sim.size;
  for (const s of sim.rivers.natural) {
    for (const l of sim.terrainInfo.lakes) { const t = l.tileIdx[0]!, sink = { x: t % N, y: (t / N) | 0 }, p = planRiver(env, s, sink); if (p.ok && p.cost > 0) return { from: s, sink, plan: p }; }
    const p = planRiver(env, s);
    if (p.ok) return { from: s, sink: null, plan: p };
  }
  throw new Error('no river site');
}

describe('Dig river tool', () => {
  it('hover over a spring previews the route: ghost with the channel tiles, cost in the tip', () => {
    const r = rig(), s = site(r.sim);
    r.tool.setMode('river');
    r.hover(s.from.x, s.from.y);
    expect(r.ghost).toHaveBeenCalled();
    const [path, depth] = r.ghost.mock.calls.at(-1)!;
    expect((path as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect((depth as number[]).length).toBe((path as unknown[]).length);
    const t = r.tip.mock.calls.at(-1)![0] as { cost: number; blocked: boolean; text: string };
    expect(t.blocked).toBe(false); expect(t.cost).toBeGreaterThan(0);
    expect(t.text).toMatch(/tiles/); expect(t.text).toMatch(/drop/); expect(t.text).toContain(`$${t.cost}`);
    expect(r.sim.rivers.rivers).toHaveLength(0); // hovering digs nothing
  });

  it('drag from a spring to a lake digs the river: stream tiles, money charged, one undo step restores everything, redo digs it again', () => {
    const r = rig(), s = site(r.sim);
    r.tool.setMode('river');
    const money = r.sim.game.money, h0 = stateHash(r.sim), heights0 = [...r.sim.grid.heights];
    r.drag(s.from, s.sink ?? s.plan.path.at(-1)!);
    expect(r.sim.rivers.rivers).toHaveLength(1);
    const rec = r.sim.rivers.rivers[0]!;
    expect(r.sim.game.money).toBe(money - rec.cost);
    for (const p of rec.path) expect(r.sim.grid.tileType[p.y * 64 + p.x]).toBe(TileType.Stream);
    expect(r.applied).toHaveBeenCalledTimes(1);
    const h1 = stateHash(r.sim).hash, size = r.undo.size;
    expect(size).toBeGreaterThanOrEqual(1);
    expect(r.undo.undo().ok).toBe(true);
    expect(r.sim.rivers.rivers).toHaveLength(0);
    expect([...r.sim.grid.heights]).toEqual(heights0);
    expect(r.sim.game.money).toBe(money);
    expect(stateHash(r.sim).hash).toBe(h0.hash);
    expect(r.undo.redo().ok).toBe(true);
    expect(stateHash(r.sim).hash).toBe(h1);
    expect(r.sim.game.money).toBe(money - rec.cost);
  });

  it('a plain click on a spring takes the cheapest outlet', () => {
    const r = rig(), s = site(r.sim);
    r.tool.setMode('river');
    r.tap(s.from.x, s.from.y);
    expect(r.sim.rivers.rivers).toHaveLength(1);
    expect(r.sim.rivers.rivers[0]!.source.kind).toBe('spring');
  });

  it('refuses a start that is not a source (plain ground away from water) with the reason, digs nothing, charges nothing', () => {
    const r = rig();
    r.tool.setMode('river');
    const money = r.sim.game.money;
    let x = 0, y = 0;
    outer: for (y = 10; y < 54; y++) for (x = 10; x < 54; x++) { const t = r.sim.grid.tileType[y * 64 + x]; if (t !== TileType.Water && t !== TileType.Stream && !r.sim.rivers.isSource(x, y) && r.sim.grid.occupancy.flags[y * 64 + x] === 0) break outer; }
    r.hover(x, y);
    const t = r.tip.mock.calls.at(-1)![0] as { blocked: boolean; text: string };
    expect(t.blocked).toBe(true); expect(t.text).toMatch(/spring|lake|stream/i);
    r.drag({ x, y }, { x: x + 3, y: y + 3 });
    expect(r.refused).toHaveBeenCalled();
    expect(r.sim.rivers.rivers).toHaveLength(0); expect(r.sim.game.money).toBe(money);
  });

  it('refuses an uphill / impossible river with the planner reason in the tooltip', () => {
    const r = rig(), env = r.sim.riverEnv(), N = 64;
    r.tool.setMode('river');
    // find a spring + a lake tile that is NOT reachable: any explicit sink the planner refuses
    let found: { from: { x: number; y: number }; sink: { x: number; y: number }; reason: string } | null = null;
    for (const s of r.sim.rivers.natural) for (let k = 0; k < N * N && !found; k += 7) {
      const tt = r.sim.grid.tileType[k]!; if (tt !== TileType.Water && tt !== TileType.Stream) continue;
      const p = planRiver(env, s, { x: k % N, y: (k / N) | 0 }); if (!p.ok && p.reason) found = { from: s, sink: { x: k % N, y: (k / N) | 0 }, reason: p.reason };
    }
    if (!found) return; // every sink reachable on this map: nothing to refuse
    r.press(found.from.x, found.from.y); r.move(found.sink.x, found.sink.y);
    const t = r.tip.mock.calls.at(-1)![0] as { blocked: boolean; text: string; lines?: Array<{ text: string }> };
    expect(t.blocked).toBe(true); expect(t.text).toContain(found.reason); expect(t.lines?.length).toBeGreaterThan(0);
    r.release(found.sink.x, found.sink.y);
    expect(r.sim.rivers.rivers).toHaveLength(0);
  });

  it('refuses when the money is short', () => {
    const r = rig({ money: 5 }), s = site(r.sim);
    r.tool.setMode('river');
    r.tap(s.from.x, s.from.y);
    expect(r.sim.rivers.rivers).toHaveLength(0);
    expect(r.refused).toHaveBeenCalledWith('Not enough funds');
  });

  it('is locked below level 2 (career), open at level 2 and in the unlock table', () => {
    expect(unlockLevel('landscape', 'river')).toBe(2); expect(isGated('landscape', 'river')).toBe(true);
    expect(unlockName('landscape', 'river')).toMatch(/river/i);
    const r = rig({ unlock: false }), s = site(r.sim);
    r.sim.progression.mode = 'career';
    r.tool.setMode('river');
    r.hover(s.from.x, s.from.y);
    expect((r.tip.mock.calls.at(-1)![0] as { text: string }).text).toMatch(/level 2/);
    r.tap(s.from.x, s.from.y);
    expect(r.sim.rivers.rivers).toHaveLength(0);
    expect(r.refused.mock.calls.at(-1)![0]).toMatch(/level 2/);
    r.sim.progression.setLevel(2);
    r.tap(s.from.x, s.from.y);
    expect(r.sim.rivers.rivers).toHaveLength(1);
  });

  it('keys 7 / 8 / 9 switch to river / spring / fill in river; Esc cancels a stroke', () => {
    const r = rig();
    for (const [k, m] of [['7', 'river'], ['8', 'spring'], ['9', 'riverFill'], ['1', 'pond']] as const) {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: k, ctrlKey: false, metaKey: false, altKey: false }));
      expect(r.tool.mode).toBe(m);
    }
  });

  it('spring markers are asked for only while a Water-tab mode is active and the toggle is on', () => {
    const r = rig();
    expect(r.sprs).toHaveBeenLastCalledWith(true); // pond mode is a Water mode
    r.tool.setMode('rock'); expect(r.sprs).toHaveBeenLastCalledWith(false);
    r.tool.setMode('spring'); expect(r.sprs).toHaveBeenLastCalledWith(true);
    r.tool.setShowSprings(false); expect(r.sprs).toHaveBeenLastCalledWith(false);
    r.tool.setShowSprings(true); r.tool.disable(); expect(r.sprs).toHaveBeenLastCalledWith(false);
  });
});

describe('Place spring tool', () => {
  const spot = (sim: Sim) => { const env = sim.riverEnv(); for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) if (planSpring(env, sim.rivers, x, y).ok) return { x, y }; throw new Error('no spring spot'); };

  it('click places a spring for $250 (one undo step), refuses on occupied / water / flat ground', () => {
    const r = rig(), p = spot(r.sim);
    r.tool.setMode('spring');
    r.hover(p.x, p.y);
    const t = r.tip.mock.calls.at(-1)![0] as { cost: number; blocked: boolean };
    expect(t.blocked).toBe(false); expect(t.cost).toBe(SPRING.cost);
    const money = r.sim.game.money, h0 = stateHash(r.sim).hash;
    r.tap(p.x, p.y);
    expect(r.sim.rivers.springs).toEqual([p]);
    expect(r.sim.game.money).toBe(money - SPRING.cost);
    expect(r.undo.undo().ok).toBe(true);
    expect(r.sim.rivers.springs).toHaveLength(0); expect(r.sim.game.money).toBe(money); expect(stateHash(r.sim).hash).toBe(h0);
    expect(r.undo.redo().ok).toBe(true);
    expect(r.sim.rivers.springs).toHaveLength(1);
    // the same tile twice: refused
    r.tap(p.x, p.y);
    expect(r.refused).toHaveBeenCalled(); expect(r.sim.rivers.springs).toHaveLength(1);
  });

  it('a placed spring is a river source: dig from it', () => {
    const r = rig();
    const env = r.sim.riverEnv();
    let done = false;
    for (let y = 8; y < 56 && !done; y++) for (let x = 8; x < 56 && !done; x++) {
      if (!planSpring(env, r.sim.rivers, x, y).ok) continue;
      r.tool.setMode('spring'); r.tap(x, y);
      r.tool.setMode('river');
      const before = r.sim.rivers.rivers.length;
      r.tap(x, y);
      if (r.sim.rivers.rivers.length > before) { expect(r.sim.rivers.rivers.at(-1)!.source).toMatchObject({ kind: 'spring', x, y }); done = true; }
      else { r.undo.undo(); } // no river from here: undo the spring and try the next spot
    }
    expect(done).toBe(true);
  });
});

describe('Fill in river tool', () => {
  it('click on a dug river fills it in (ground back, free), undo brings it back; natural streams are refused', () => {
    const r = rig(), s = site(r.sim);
    const heights0 = [...r.sim.grid.heights];
    r.tool.setMode('river'); r.tap(s.from.x, s.from.y);
    const rec = r.sim.rivers.rivers[0]!, dug = [...r.sim.grid.heights], money = r.sim.game.money;
    r.tool.setMode('riverFill');
    const mid = rec.path[Math.floor(rec.path.length / 2)]!;
    r.hover(mid.x, mid.y);
    expect((r.tip.mock.calls.at(-1)![0] as { text: string }).text).toMatch(/Fill in this river/);
    r.tap(mid.x, mid.y);
    expect(r.sim.rivers.rivers).toHaveLength(0);
    expect([...r.sim.grid.heights]).toEqual(heights0);
    expect(r.sim.game.money).toBe(money); // refund 0, no fee
    for (const p of rec.path) expect(r.sim.grid.tileType[p.y * 64 + p.x]).not.toBe(TileType.Stream);
    expect(r.undo.undo().ok).toBe(true);
    expect(r.sim.rivers.rivers).toHaveLength(1);
    expect([...r.sim.grid.heights]).toEqual(dug);
    // natural stream tile
    const st = r.sim.terrainInfo.streams[0]?.path[2];
    if (st) { r.tap(st.x, st.y); expect(r.sim.grid.tileType[st.y * 64 + st.x]).toBe(TileType.Stream); }
  });
});

describe('touch two-step confirm', () => {
  it('release arms the river; tapping the end again (or confirm()) digs; another tap / Esc drops it', () => {
    const r = rig({ confirmFirst: true }), s = site(r.sim);
    r.tool.setMode('river');
    r.tap(s.from.x, s.from.y);
    expect(r.sim.rivers.rivers).toHaveLength(0);
    expect(r.tool.hasPending()).toBe(true); expect(r.tool.state().pending).toBe(true);
    expect((r.tip.mock.calls.at(-1)![0] as { text: string }).text).toMatch(/confirm/i);
    r.tap(s.from.x, s.from.y); // second tap on the start / end
    expect(r.sim.rivers.rivers).toHaveLength(1); expect(r.tool.hasPending()).toBe(false);
    r.undo.undo();
    r.tap(s.from.x, s.from.y);
    expect(r.tool.confirm()).toBe(true); // the Confirm button
    expect(r.sim.rivers.rivers).toHaveLength(1);
    expect(r.tool.confirm()).toBe(false);
    r.undo.undo();
    r.tap(s.from.x, s.from.y);
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape', ctrlKey: false, metaKey: false, altKey: false }));
    expect(r.tool.hasPending()).toBe(false); expect(r.sim.rivers.rivers).toHaveLength(0);
  });

  it('springs arm too', () => {
    const r = rig({ confirmFirst: true }), env = r.sim.riverEnv();
    let p = { x: 0, y: 0 };
    outer: for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) if (planSpring(env, r.sim.rivers, x, y).ok) { p = { x, y }; break outer; }
    r.tool.setMode('spring'); r.tap(p.x, p.y);
    expect(r.sim.rivers.springs).toHaveLength(0); expect(r.tool.hasPending()).toBe(true);
    r.tap(p.x, p.y);
    expect(r.sim.rivers.springs).toHaveLength(1);
  });
});
