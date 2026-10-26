import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { GuestStore } from '../../src/sim/guests/Guest';
import { Emotes } from '../../src/render/fx/Emotes';
import { Particles } from '../../src/render/fx/Particles';
import { feedbackPolicy } from '../../src/render/fx/feedbackPolicy';
import { ReviewDirector } from '../../src/sim/guests/Reviews';
import { budget } from '../perfMode';

/**
 * M5.1 frame budget: cost of the feedback layer with 3,000 guests on a 256 map. Per sim tick: goals / advisor evaluation (hourly / daily,
 * so amortised), review consideration for every leaver. Per rendered frame: emote scan + update, particle update. Numbers are printed
 * (docs/fun-feedback.md, 'Cost'); thresholds are generous guards, not targets.
 */
const N = 3000;
const time = (n: number, f: (i: number) => void): number => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(i); return (performance.now() - t0) / n; };

describe('[perf] feedback layer cost (256 map, 3,000 guests)', () => {
  it('[perf] goals, advisor, reviews, emotes, particles stay far below a frame', () => {
    const sim = createSim({ size: 256, seed: 61, now: () => 0 });
    runBot(sim, new Bot(sim, { starterLoan: true }), 30);
    const goals = time(200, () => sim.goals.evaluate());
    const advisorFull = time(100, () => sim.advisor.evaluate(true));
    const advisorHour = time(100, () => sim.advisor.evaluate(false));
    const rd = new ReviewDirector(); rd.rate = 1; rd.perDay = 1e9;
    const reviews = time(N, (i) => rd.consider({ id: i + 1, day: 3, reason: 'satisfied', happiness: 0.8, hunger: 0.2, fatigue: 0.4, budget: 100, runs: 6, queueMin: 4, crowd: 5, weatherPenalty: 0, pisteLike: 0.7, x: 10, y: 10 }, null));

    const store = new GuestStore(N + 10);
    for (let i = 0; i < N; i++) {
      const j = store.add({ x: 100 + (i % 60), y: 100 + Math.floor(i / 60), z: 0, type: i % 6, skill: i % 4, budget: 100, group: i % 40, mode: 0, overnight: false, leaveDay: 0, tick: 0, hunger: (i % 10) / 10 });
      store.state[j] = 1;
    }
    const cam = new THREE.OrthographicCamera(-60, 60, 40, -40, 0.1, 1000); cam.position.set(130, 100, 130); cam.lookAt(130, 0, 130); cam.updateMatrixWorld();
    const em = new Emotes(store, { policy: () => feedbackPolicy('lively', { reducedMotion: false }), reducedMotion: () => false, day: () => 1, cold: () => 0.5, anchor: (s, o) => { o.set(store.x[s]!, 1, store.y[s]!); return true; } });
    let tick = 0;
    const emoteScan = time(60, () => { for (let k = 0; k < 3; k++) { for (let g = 0; g < N; g++) { store.hunger[g] = (store.hunger[g]! + 0.07) % 1; store.fatigue[g] = (store.fatigue[g]! + 0.05) % 1; } } em.update(0.016, cam, ++tick, false, 80, 800); });
    const emoteFrame = time(300, () => em.update(0.016, cam, tick, false, 80, 800));
    const pt = new Particles(256);
    for (let i = 0; i < 40; i++) pt.emit({ x: i, y: 0, z: i, count: 6, kind: 'puff' });
    const particles = time(300, () => pt.update(0.016, cam));
    const f = (n: number): string => n.toFixed(4);
    console.log(`[perf-feedback] goals.evaluate ${f(goals)} ms/hour | advisor.evaluate(full) ${f(advisorFull)} ms/day, (hourly) ${f(advisorHour)} ms/hour | reviews.consider ${f(reviews * 1000)} us/leaver | emotes scan(3000 guests, incl. 3 ticks of needs churn) ${f(emoteScan)} ms/tick | emotes per frame ${f(emoteFrame)} ms | particles(40 bursts) ${f(particles)} ms/frame`);
    expect(goals).toBeLessThan(budget(2));
    expect(advisorFull).toBeLessThan(budget(5));
    expect(reviews).toBeLessThan(budget(0.05));
    expect(emoteScan).toBeLessThan(budget(4));
    expect(emoteFrame).toBeLessThan(budget(0.3));
    expect(particles).toBeLessThan(budget(0.5));
  }, 120_000);
});
