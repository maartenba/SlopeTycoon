// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { el, registerComponents } from '../../src/ui';
import { modalPause } from '../../src/ui/modalPauseGate';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents, Speed } from '../../src/core/events';
import { MemStorage } from '../audio/fakeBackend';

registerComponents();

function game(speed: Speed = 1) {
  const s = { speed, ff: 0 };
  modalPause.attach({ getSpeed: () => s.speed, setSpeed: (v) => { s.speed = v as Speed; }, cancelFastForward: () => { s.ff++; } });
  return s;
}
const settings = () => { const e = el('st-settings'); document.body.append(e); e.bind(new AudioSettings(new MemStorage()), { state: 'running', needsHint: false, onState: () => () => {} }, []); return e; };

describe('dialogs pause the game', () => {
  beforeEach(() => { modalPause.attach(null); document.body.replaceChildren(); });
  it('Settings: opening pauses a running game, closing restores the speed', () => {
    const g = game(2), e = settings();
    e.open(); expect(g.speed).toBe(0); expect(g.ff).toBe(1);
    e.close(); expect(g.speed).toBe(2);
  });
  it('Settings opened while paused stays paused; toggle works', () => {
    const g = game(0), e = settings();
    e.toggle(true); e.toggle(false);
    expect(g.speed).toBe(0);
  });
  it('Help + Settings stacked: resumes only after both are closed', () => {
    const g = game(3), e = settings(), help = el('st-help'); document.body.append(help);
    e.open(); help.open(); e.close();
    expect(g.speed).toBe(0);
    help.close(); expect(g.speed).toBe(3);
  });
  it("the speed control shows a 'Paused' badge while a dialog holds the game", () => {
    const g = game(1), bus = new EventBus<GameEvents>();
    const h = el('st-speed-control'); document.body.append(h);
    h.bind({ bus, getSpeed: () => g.speed as Speed, setSpeed: (v) => { g.speed = v; }, getDate: () => ({ year: 0, day: 3, minute: 600, tick: 0 }) });
    const badge = h.shadowRoot!.querySelector('[data-role=dialog-pause]') as HTMLElement;
    expect(badge.hidden).toBe(true);
    const e = settings(); e.open();
    expect(badge.hidden).toBe(false);
    e.close(); expect(badge.hidden).toBe(true);
  });
  it('no host (title screen): opening Settings changes nothing and shows no badge', () => {
    const e = settings(); e.open(); expect(modalPause.active).toBe(false); e.close();
  });
});
