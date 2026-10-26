import { describe, expect, it } from 'vitest';
import { ModalPauseGate, type PauseHost } from '../../src/ui/modalPauseGate';

function host(speed = 1, o: Partial<PauseHost> = {}) {
  const h = { speed, sets: [] as number[], ffCancelled: 0, ended: false, exempt: false };
  const api: PauseHost = {
    getSpeed: () => h.speed, setSpeed: (s) => { h.speed = s; h.sets.push(s); }, cancelFastForward: () => { h.ffCancelled++; },
    exempt: () => h.exempt, ended: () => h.ended, ...o,
  };
  const g = new ModalPauseGate(); g.attach(api);
  return { h, g };
}

describe('ModalPauseGate', () => {
  it('pauses on open and restores the previous speed on close (1x, 3x, 10x)', () => {
    for (const sp of [1, 2, 3]) {
      const { h, g } = host(sp);
      g.enter(); expect(h.speed).toBe(0); expect(g.active).toBe(true);
      g.leave(); expect(h.speed).toBe(sp); expect(g.active).toBe(false);
    }
  });
  it('nesting: only the LAST closing dialog restores; inner open/close does not touch the speed', () => {
    const { h, g } = host(2);
    g.enter(); g.enter(); g.enter();
    expect(h.sets).toEqual([0]);
    g.leave(); expect(h.speed).toBe(0); g.leave(); expect(h.speed).toBe(0); expect(g.active).toBe(true);
    g.leave(); expect(h.speed).toBe(2); expect(h.sets).toEqual([0, 2]); expect(g.open).toBe(0);
  });
  it('already paused when opened: stays paused after closing', () => {
    const { h, g } = host(0);
    g.enter(); g.leave();
    expect(h.speed).toBe(0); expect(h.sets).toEqual([]);
  });
  it('a dialog opened on top of another pausing one (game paused by the first) does not resume at the inner close', () => {
    const { h, g } = host(1);
    g.enter(); g.enter(); g.leave();
    expect(h.speed).toBe(0);
    g.leave(); expect(h.speed).toBe(1);
  });
  it('if something else changed the speed while open (e.g. the player or a tutorial), the gate leaves it alone', () => {
    const { h, g } = host(1);
    g.enter(); h.speed = 3; g.leave();
    expect(h.speed).toBe(3); expect(h.sets).toEqual([0]);
  });
  it('cancels fast-forward when the first dialog opens (once)', () => {
    const { h, g } = host(3);
    g.enter(); g.enter();
    expect(h.ffCancelled).toBe(1);
  });
  it('exempt (title-screen demo): no pause, no restore, no badge', () => {
    const { h, g } = host(1); h.exempt = true;
    g.enter(); expect(h.speed).toBe(1); expect(g.active).toBe(false); g.leave(); expect(h.sets).toEqual([]);
  });
  it('a finished game (bankrupt) is never resumed', () => {
    const { h, g } = host(1);
    g.enter(); h.ended = true; g.leave();
    expect(h.speed).toBe(0);
  });
  it('without a host (unit tests, title screen) it is a no-op; unbalanced leave is harmless', () => {
    const g = new ModalPauseGate(); g.enter(); expect(g.active).toBe(false); g.leave(); g.leave(); expect(g.open).toBe(0);
  });
  it('notifies subscribers (badge)', () => {
    const { g } = host(1); let n = 0; const off = g.subscribe(() => { n++; });
    g.enter(); g.leave(); off(); g.enter();
    expect(n).toBe(2);
  });
});
