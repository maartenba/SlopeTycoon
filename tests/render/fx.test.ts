// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { Feedback, FloatText, MoneyAggregator, Particles, feedbackPolicy, type FeedbackIntensity } from '../../src/render/fx';
import { fullHash } from '../game/harness';
import { MemStorage } from '../audio/fakeBackend';

const cam = new THREE.OrthographicCamera(-10, 10, 10, -10);
function rig(intensity: FeedbackIntensity = 'subtle', reduced = false) {
  const bus = new EventBus<GameEvents>();
  const st = new MemStorage(); st.setItem('slope.fx.v1', JSON.stringify({ intensity }));
  const played: string[] = [];
  const ft = new FloatText(document.body); ft.project = () => ({ x: 10, y: 10, scale: 1 });
  const particles = new Particles(64);
  let red = reduced;
  const fx = new Feedback({
    bus, floatText: ft, particles, reducedMotion: () => red, storage: st,
    locate: (c) => ({ key: c.length, x: 1, y: 0, z: 1 }), placedAt: (_i, x, y) => ({ x, y: 0, z: y }), focus: () => ({ x: 5, y: 0, z: 5 }), winter: () => true,
    play: (s) => { played.push(s); },
  });
  return { bus, fx, ft, particles, played, setReduced: (v: boolean) => { red = v; } };
}
const sale = (bus: EventBus<GameEvents>, delta: number, category = 'lodging'): void => bus.emit('money:changed', { money: 1e6, delta, reason: 'earn', category });
const run = (fx: Feedback, secs: number): void => { for (let t = 0; t < secs; t += 0.1) fx.update(0.1, cam); };

describe('MoneyAggregator', () => {
  const p = feedbackPolicy('subtle');
  it('sums per source over the window, then emits one popup if significant', () => {
    const a = new MoneyAggregator();
    a.add(1, 300, 0, 0, 0); a.add(1, 300, 0, 0, 1);
    expect(a.flush(1.9, p, 6)).toEqual([]); // window still open
    const out = a.flush(2.0, p, 6);
    expect(out.length).toBe(1); expect(out[0]!.amount).toBe(600);
    expect(a.pending).toBe(0);
  });
  it('drops sub-threshold sums', () => {
    const a = new MoneyAggregator(); a.add(1, 499, 0, 0, 0);
    expect(a.flush(3, p, 6)).toEqual([]);
  });
  it('threshold = max($500, 5% of the rolling daily average)', () => {
    const a = new MoneyAggregator();
    expect(a.threshold(p)).toBe(500);
    a.noteIncome(20000); a.rollDay();
    expect(a.dailyAverage).toBe(20000); expect(a.threshold(p)).toBe(1000);
    a.add(1, 900, 0, 0, 0); expect(a.flush(3, p, 6)).toEqual([]);
    a.add(2, 1000, 0, 0, 3); expect(a.flush(5, p, 6).length).toBe(1);
  });
  it('respects room and keeps the largest first', () => {
    const a = new MoneyAggregator();
    for (let i = 0; i < 5; i++) a.add(i, 600 + i * 100, 0, 0, 0);
    const out = a.flush(2, p, 2);
    expect(out.map((o) => o.amount)).toEqual([1000, 900]);
  });
  it('Off yields nothing', () => {
    const a = new MoneyAggregator(); a.add(1, 1e6, 0, 0, 0);
    expect(a.flush(5, feedbackPolicy('off'), 6)).toEqual([]);
  });
});

describe('Feedback layer', () => {
  it('small sales are suppressed; a significant aggregate shows one popup + one ka-ching', () => {
    const { bus, fx, ft, played } = rig();
    sale(bus, 100); run(fx, 3);
    expect(ft.count).toBe(0); expect(played).toEqual([]);
    sale(bus, 300); sale(bus, 300); run(fx, 2.5);
    expect(fx.stats.popups).toBe(1); expect(played).toEqual(['kaching']);
  });
  it('popups last ~1 s then vanish', () => {
    const { bus, fx, ft } = rig();
    sale(bus, 900); run(fx, 2.1); expect(ft.count).toBe(1);
    run(fx, 1.2); expect(ft.count).toBe(0);
  });
  it('caps hold (6 in Subtle, 12 in Lively) and ka-ching is throttled to 1 per 3 s', () => {
    for (const [i, cap] of [['subtle', 6], ['lively', 12]] as const) {
      const { bus, fx, ft, played } = rig(i);
      const cats = ['lifts', 'passes', 'lodging', 'shops', 'restaurants', 'bars', 'recreation', 'rental', 'lessons', 'other'];
      for (let k = 0; k < 40; k++) { const c = cats[k % cats.length]! + (k > 9 ? k : ''); sale(bus, 5000, c); }
      fx.update(0.1, cam); run(fx, 2.2);
      expect(ft.count).toBeLessThanOrEqual(cap);
      expect(played.length).toBeLessThanOrEqual(1);
    }
  });
  it('ka-ching repeats no faster than every 3 s', () => {
    const { bus, fx, played } = rig();
    for (let k = 0; k < 20; k++) { sale(bus, 800); run(fx, 2.1); }
    expect(played.length).toBeLessThanOrEqual(Math.ceil((20 * 2.1) / 3));
    expect(played.length).toBeGreaterThan(5);
  });
  it('loans and charges are not income popups', () => {
    const { bus, fx, ft } = rig();
    bus.emit('money:changed', { money: 1, delta: 50000, reason: 'deposit', category: 'loan' });
    bus.emit('money:changed', { money: 1, delta: -9000, reason: 'charge', category: 'construction' });
    run(fx, 3); expect(ft.count + fx.stats.popups).toBe(0);
  });
  it('Off: zero effects of any kind', () => {
    const { bus, fx, ft, particles, played } = rig('off');
    sale(bus, 99999); bus.emit('building:placed', { id: 1, type: 'chalet', x: 3, y: 3 }); bus.emit('milestone', { id: 'c1', title: 'x', major: true });
    run(fx, 3);
    expect(fx.stats).toEqual({ popups: 0, puffs: 0, confetti: 0, kachings: 0 });
    expect(ft.count).toBe(0); expect(particles.count).toBe(0); expect(played).toEqual([]);
    expect(fx.demo()).toEqual({ popups: 0, puffs: 0 });
  });
  it('build puff is small; confetti only for major milestones', () => {
    const { bus, fx, particles } = rig();
    bus.emit('building:placed', { id: 1, type: 'chalet', x: 3, y: 3 });
    expect(fx.stats.puffs).toBe(1); expect(particles.count).toBeLessThanOrEqual(9);
    bus.emit('milestone', { id: 'm', title: 'minor', major: false });
    expect(fx.stats.confetti).toBe(0);
    bus.emit('milestone', { id: 'c1', title: 'Chapter 1', major: true });
    expect(fx.stats.confetti).toBe(1); expect(particles.count).toBeGreaterThan(9);
  });
  it('reduced motion: Lively clamps to Subtle, no confetti', () => {
    const { bus, fx, setReduced } = rig('lively', true);
    expect(fx.policy().intensity).toBe('subtle');
    bus.emit('milestone', { id: 'c1', title: 'x', major: true });
    expect(fx.stats.confetti).toBe(0);
    setReduced(false); expect(fx.policy().intensity).toBe('lively');
  });
  it('setIntensity persists and Off clears live effects', () => {
    const { bus, fx, ft } = rig();
    sale(bus, 900); run(fx, 2.1); expect(ft.count).toBe(1);
    fx.setIntensity('off'); expect(ft.count).toBe(0); expect(fx.intensity).toBe('off');
  });
  it('draw-call budget: one instanced mesh, no WebGL for popups', () => {
    const { particles, ft } = rig();
    expect(particles.mesh.isInstancedMesh).toBe(true);
    expect(ft.layer.tagName).toBe('DIV'); // DOM overlay: 0 draw calls
  });
});

describe('FX never touches the sim', () => {
  it('stateHash identical after 3 sim days with FX on vs off', () => {
    const go = (withFx: boolean): string => {
      const sim = createSim({ size: 64, seed: 11, now: () => 0 });
      buildStarterResort(sim);
      if (withFx) {
        const ft = new FloatText(document.body); ft.project = () => ({ x: 0, y: 0, scale: 1 });
        const fx = new Feedback({ bus: sim.bus, floatText: ft, particles: new Particles(64), reducedMotion: () => false, storage: null, locate: () => ({ key: 1, x: 1, y: 0, z: 1 }), placedAt: (_i, x, y) => ({ x, y: 0, z: y }), focus: () => ({ x: 1, y: 0, z: 1 }), winter: () => true, play: () => {} });
        fx.setIntensity('lively');
        for (let t = 1; t <= 720; t++) { sim.tick(1); if (t % 6 === 0) fx.update(0.1, cam); }
        expect(fx.stats.popups + fx.stats.puffs).toBeGreaterThanOrEqual(0);
      } else for (let t = 1; t <= 720; t++) sim.tick(1);
      return fullHash(sim);
    };
    expect(go(true)).toBe(go(false));
  }, 60000);
});
