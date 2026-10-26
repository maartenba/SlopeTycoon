// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { Emotes, EMOTE_LIFE_S, EMOTE_T, clusterRepresentatives, coldness, feedbackPolicy, pickEmote, type EmoteNeeds } from '../../src/render/fx';
import { GState, GuestStore } from '../../src/sim/guests/Guest';
import { fullHash } from '../game/harness';

const n0: EmoteNeeds = { day: 3, hunger: 0.2, fatigue: 0.2, happiness: 0.6, queueMin: 0, cold: 0, runDone: false, sighting: false };
const P = feedbackPolicy('subtle');
const none = { day: -1, count: 0 };
const w = (o: Partial<EmoteNeeds>): EmoteNeeds => ({ ...n0, ...o });

describe('pickEmote', () => {
  it('is silent for ordinary needs and for levels without a crossing', () => {
    expect(pickEmote(n0, n0, none, P)).toBeNull();
    expect(pickEmote(w({ hunger: 0.9 }), w({ hunger: 0.9 }), none, P)).toBeNull(); // already hungry: no edge
    expect(pickEmote(w({ hunger: 0.8 }), n0, none, P)).toBeNull(); // below threshold
  });
  it('fires on strong crossings only', () => {
    expect(pickEmote(w({ hunger: EMOTE_T.hunger }), n0, none, P)).toBe('hungry');
    expect(pickEmote(w({ fatigue: 0.9 }), n0, none, P)).toBe('tired');
    expect(pickEmote(w({ cold: 0.8 }), n0, none, P)).toBe('cold');
    expect(pickEmote(w({ queueMin: EMOTE_T.queueMin }), w({ queueMin: 5 }), none, P)).toBe('angry');
    expect(pickEmote(w({ sighting: true }), n0, none, P)).toBe('scared');
  });
  it('delight needs a finished run and high happiness', () => {
    expect(pickEmote(w({ runDone: true, happiness: 0.9 }), n0, none, P)).toBe('happy');
    expect(pickEmote(w({ runDone: true, happiness: 0.7 }), n0, none, P)).toBeNull();
    expect(pickEmote(w({ happiness: 0.95 }), n0, none, P)).toBeNull();
  });
  it('priority: scared > angry > cold > hungry', () => {
    expect(pickEmote(w({ sighting: true, queueMin: 20 }), n0, none, P)).toBe('scared');
    expect(pickEmote(w({ queueMin: 20, cold: 1, hunger: 1 }), n0, none, P)).toBe('angry');
    expect(pickEmote(w({ cold: 1, hunger: 1 }), n0, none, P)).toBe('cold');
  });
  it('per-guest daily limit (1 subtle / 2 lively), resets next day', () => {
    const e = w({ hunger: 0.95 });
    expect(pickEmote(e, n0, { day: 3, count: 1 }, P)).toBeNull();
    expect(pickEmote(e, n0, { day: 2, count: 1 }, P)).toBe('hungry');
    const L = feedbackPolicy('lively');
    expect(pickEmote(e, n0, { day: 3, count: 1 }, L)).toBe('hungry');
    expect(pickEmote(e, n0, { day: 3, count: 2 }, L)).toBeNull();
  });
  it('Off never fires; reduced motion clamps lively to subtle limits', () => {
    expect(pickEmote(w({ hunger: 1 }), n0, none, feedbackPolicy('off'))).toBeNull();
    const rl = feedbackPolicy('lively', { reducedMotion: true });
    expect(rl.maxEmotes).toBe(12);
    expect(pickEmote(w({ hunger: 1 }), n0, { day: 3, count: 1 }, rl)).toBeNull();
  });
  it('coldness maps temperature', () => { expect(coldness(0)).toBe(0); expect(coldness(-9)).toBeCloseTo(0.5); expect(coldness(-30)).toBe(1); });
});

describe('clusterRepresentatives', () => {
  it('one per cell, none in busy cells, capped by room', () => {
    const c = (slot: number, x: number, z: number) => ({ slot, x, z, kind: 'angry' as const });
    const out = clusterRepresentatives([c(1, 1, 1), c(2, 2, 2), c(3, 3, 3), c(4, 20, 20), c(5, 40, 40)], 5, new Set(), 10);
    expect(out.map((o) => o.slot)).toEqual([1, 4, 5]);
    expect(clusterRepresentatives([c(1, 1, 1), c(4, 20, 20)], 5, new Set([0 + 4096 * 8192 + 4096 + 0]).add(4096 * 8192 + 4096), 10).map((o) => o.slot)).toEqual([4]);
    expect(clusterRepresentatives([c(1, 1, 1), c(4, 20, 20), c(5, 40, 40)], 5, new Set(), 2).length).toBe(2);
  });
});

function rig(intensity: 'off' | 'subtle' | 'lively' = 'subtle', guests = 60) {
  const store = new GuestStore(128);
  for (let i = 0; i < guests; i++) store.add({ x: (i % 20) * 8, y: Math.floor(i / 20) * 8, z: 0, type: 0, skill: 1, budget: 500, group: 0, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
  let red = false;
  const em = new Emotes(store, { policy: () => feedbackPolicy(intensity, { reducedMotion: red }), reducedMotion: () => red, day: () => 3, cold: () => 0, anchor: (s, o) => { o.set(store.x[s]!, 2, store.y[s]!); return true; } });
  const cam = new THREE.OrthographicCamera(-100, 100, 100, -100); cam.position.set(0, 50, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  return { store, em, cam, setRed: (v: boolean) => { red = v; } };
}

describe('Emotes', () => {
  it('a busy resort never exceeds the on-screen cap and one emote per queue cluster', () => {
    const { store, em, cam } = rig('subtle', 100);
    let tick = 0;
    em.update(0.1, cam, tick++, false, 200, 800); // first look: baselines
    for (let i = 0; i < 100; i++) { store.state[i] = GState.Queueing; store.hunger[i] = 0.95; }
    em.update(0.1, cam, tick++, false, 200, 800);
    expect(em.count).toBeGreaterThan(0); expect(em.count).toBeLessThanOrEqual(12);
    for (let t = 0; t < 40; t++) { em.update(0.05, cam, tick++, false, 200, 800); expect(em.count).toBeLessThanOrEqual(12); }
  });
  it('lives ~1.5 s, hidden when far or Off', () => {
    const { store, em, cam } = rig();
    em.update(0.1, cam, 0, false, 100, 800);
    expect(em.spawn(0, 'hungry')).toBe(true);
    em.update(0.1, cam, 1, false, 100, 800); expect(em.count).toBe(1); expect(em.mesh.visible).toBe(true);
    em.update(0.1, cam, 2, true, 100, 800); expect(em.mesh.visible).toBe(false); // far view
    for (let t = 0; t < EMOTE_LIFE_S + 0.3; t += 0.1) em.update(0.1, cam, 3, false, 100, 800);
    expect(em.count).toBe(0);
    store.alive[0] = 1;
    const off = rig('off');
    expect(off.em.spawn(0, 'hungry')).toBe(false);
  });
  it('one emote per guest per day through the scan', () => {
    const { store, em, cam } = rig('subtle', 3);
    store.x[1] = 100; store.x[2] = 200;
    em.update(0.1, cam, 0, false, 200, 800);
    store.hunger[0] = 0.95; em.update(0.1, cam, 1, false, 200, 800);
    expect(em.stats.spawned).toBe(1);
    store.hunger[0] = 0.1; em.update(0.1, cam, 2, false, 200, 800);
    store.hunger[0] = 0.95; em.update(0.1, cam, 3, false, 200, 800);
    expect(em.stats.spawned).toBe(1); // daily limit
  });
  it('reduced motion: no rise', () => {
    const { em, cam, setRed } = rig();
    setRed(true);
    em.update(0.1, cam, 0, false, 100, 800); em.spawn(0, 'tired');
    em.update(0.7, cam, 1, false, 100, 800);
    const y1 = (em.mesh.instanceMatrix.array as Float32Array)[13]!;
    em.update(0.3, cam, 2, false, 100, 800);
    expect((em.mesh.instanceMatrix.array as Float32Array)[13]).toBeCloseTo(y1, 5);
  });
});

describe('sim isolation', () => {
  it('stateHash identical after 3 sim days with emotes on and off', () => {
    const go = (on: boolean): string => {
      const sim = createSim({ size: 64, seed: 7 }); buildStarterResort(sim);
      const em = new Emotes(sim.guestSim.store, { policy: () => feedbackPolicy('lively'), reducedMotion: () => false, day: () => sim.game.date.day, cold: () => 1, anchor: (s, o) => { o.set(0, 0, 0); return true; } });
      const cam = new THREE.OrthographicCamera(-500, 500, 500, -500); cam.position.set(0, 50, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      for (let t = 1; t <= 720; t++) { sim.tick(1); if (on && t % 2 === 0) em.update(0.1, cam, t, false, 100, 800); }
      return fullHash(sim);
    };
    expect(go(true)).toBe(go(false));
  }, 90000);
});
