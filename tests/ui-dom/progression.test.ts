// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import type { DockApi, StDock } from '../../src/ui/components/StDock';
import { UNLOCK_CARD_MS, UNLOCK_H, UNLOCK_ROWS, type UnlockCardModel } from '../../src/ui/components/StRecap';
import type { GoalsView } from '../../src/sim/goals/Goals';
import type { ProgressView } from '../../src/sim/progression/Progression';
import { unlocksAt, unlockName, unlockIcon, lockedReason } from '../../src/config/unlocks';
import { LIFTS } from '../../src/config/lifts';
import { GOALS_CARD_H, PANELS, intersects, zoneRect } from '../../src/ui/layout';
import { RECAP_W } from '../../src/ui/components/StRecap';
import { DEFAULT_CONFIG } from '../../src/game/difficulty';

registerComponents();
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); try { localStorage.clear(); } catch { /* none */ } });
const q = (r: HTMLElement, s: string): HTMLElement | null => r.shadowRoot!.querySelector<HTMLElement>(s);
const qa = (r: HTMLElement, s: string): HTMLElement[] => Array.from(r.shadowRoot!.querySelectorAll<HTMLElement>(s));

function mountDock(): { dock: StDock; picked: string[]; lifts: string[] } {
  const picked: string[] = [], lifts: string[] = [];
  const dock = el('st-dock') as StDock;
  const api = {
    funds: () => 1e6,
    buildings: { locked: (id: string) => (id === 'helipad' ? [lockedReason(4)] : id === 'altiport' ? [lockedReason(5)] : id === 'firstAid' ? ['Needs Ski Patrol Hub'] : []), cost: () => 100, multiplier: () => 1, select: (id: string) => picked.push(id) },
    lifts: { select: (k: string) => lifts.push(k), costPer100m: () => 1, locked: (k: string) => (k === 'gondola6' ? [lockedReason(2)] : k === 'cablecar' ? [lockedReason(5)] : []) },
    network: { start: () => {}, setOverride: () => {}, setBrush: () => {} }, terraform: { setMode: () => {}, setTarget: () => {}, setBrush: () => {}, setMaxEdgeDelta: () => {}, state: () => ({ mode: 'raise', brush: 1, target: 'tile' }) },
    setBulldoze: () => {}, activateTerraform: () => {}, resetTool: () => {}, view: { overlay: () => 'off', setOverlay: () => {}, toggleGrid: () => {}, setSeason: () => {} },
    autoFlatten: { get: () => true, set: () => {} }, thumb: () => null,
  } as unknown as DockApi;
  document.body.append(dock);
  dock.bind(api);
  return { dock, picked, lifts };
}

describe('dock: Career level locks', () => {
  it('a level-locked building card shows a gold "L4" lock badge and the level reason as its tooltip; a prerequisite lock keeps the plain lock', () => {
    const { dock } = mountDock();
    dock.show('buildings');
    for (const tab of ['safety', 'transport'] as const) {
      (qa(dock, '.tabs button').find((b) => b.textContent!.toLowerCase().includes(tab === 'safety' ? 'safety' : 'transport')) as HTMLButtonElement).click();
      const cards = qa(dock, '.grid .card');
      const lvl = cards.filter((c) => c.classList.contains('lvl'));
      for (const c of lvl) {
        expect(c.classList.contains('locked')).toBe(true);
        expect(c.querySelector('.lk')!.textContent).toMatch(/^🔒 L[45]$/);
        expect(c.querySelector('.lk')!.className).toContain('lv');
        expect(c.title).toMatch(/^Unlocks at level [45]: /);
      }
      if (tab === 'safety') {
        expect(lvl.length).toBe(1); // helipad
        const prereq = cards.find((c) => c.title.startsWith('Locked: Needs'))!;
        expect(prereq.classList.contains('lvl')).toBe(false);
        expect(prereq.querySelector('.lk')!.textContent).toBe('🔒');
      } else expect(lvl.length).toBe(1); // altiport
    }
  });

  it('only a few cards are locked in the Lifts drawer; clicking a locked kind shows the popover (with the reason) instead of starting the tool', () => {
    const { dock, lifts } = mountDock();
    dock.show('lifts');
    const cards = qa(dock, '.grid .card');
    expect(cards.length).toBe(Object.keys(LIFTS).length);
    const locked = cards.filter((c) => c.classList.contains('locked'));
    expect(locked.length).toBe(2); expect(locked.length).toBeLessThan(cards.length / 2);
    expect(locked.map((c) => c.querySelector('.lk')!.textContent)).toEqual(['🔒 L2', '🔒 L5']);
    locked[0]!.click();
    expect(lifts).toEqual([]);
    expect((q(dock, '.info') as HTMLElement).hidden).toBe(false);
    expect(q(dock, '.info')!.textContent).toContain('Unlocks at level 2: Local favourite');
    cards.find((c) => !c.classList.contains('locked'))!.click();
    expect(lifts.length).toBe(1);
  });

  it('showItem opens the right drawer + tab and points at the card', () => {
    const { dock } = mountDock();
    dock.showItem('lift', 'gondola6');
    expect(dock.openDrawer).toBe('lifts');
    expect((q(dock, '.info') as HTMLElement).hidden).toBe(false);
    dock.showItem('building', 'helipad');
    expect(dock.openDrawer).toBe('buildings');
    expect(q(dock, '.info')!.textContent).toContain('Helipad');
    dock.showItem('campaign', 'vip');
    expect(dock.openDrawer).toBe('marketing');
  });
});

const model = (level = 4): UnlockCardModel => ({ level, name: 'Alpine destination', items: unlocksAt(level).map((u) => ({ kind: u.kind, id: u.id, name: unlockName(u.kind, u.id), icon: unlockIcon(u.kind, u.id) })) });

describe('st-recap: level-up card', () => {
  const mk = () => { const r = el('st-recap'); document.body.append(r); const shown: string[] = []; r.bind({ openFinance: () => {}, showItem: (k, id) => shown.push(`${k}:${id}`) }); return { r, shown }; };

  it('lists what is new with a Show me per item; fixed height, never full-screen, host ignores the pointer', () => {
    const { r, shown } = mk();
    expect(r.showUnlock(model(4))).toBe(true);
    expect(r.currentMode).toBe('unlock');
    const card = q(r, '.card')!;
    expect(card.textContent).toContain('Level 4 · Alpine destination');
    const rows = qa(r, '.it');
    expect(rows.length).toBe(unlocksAt(4).length);
    expect(rows.map((x) => x.dataset.unlock)).toEqual(unlocksAt(4).map((u) => `${u.kind}:${u.id}`));
    expect(card.textContent).toContain('Helipad');
    const css = (r as unknown as { css(): string }).css();
    expect(css).toContain(`.card.unlock{height:${UNLOCK_H}px`);
    expect(css).toMatch(/:host\{[^}]*pointer-events:none/);
    expect(UNLOCK_H).toBeLessThanOrEqual(280); // inside the top-card zone
    (rows[0]!.querySelector('button') as HTMLButtonElement).click();
    expect(shown).toEqual([`${unlocksAt(4)[0]!.kind}:${unlocksAt(4)[0]!.id}`]);
    expect(r.showing).toBe(false); // Show me dismisses it
  });

  it('caps the list and sums up the rest; an empty level-up says so; one at a time (same key never repeats), auto-dismisses', () => {
    const { r } = mk();
    const many: UnlockCardModel = { level: 5, name: 'X', items: Array.from({ length: UNLOCK_ROWS + 2 }, (_, i) => ({ kind: 'lift' as const, id: `l${i}`, name: `Lift ${i}`, icon: '🚡' })) };
    r.showUnlock(many);
    expect(qa(r, '.it').length).toBe(UNLOCK_ROWS);
    expect(q(r, '.card')!.textContent).toContain('+2 more');
    r.dismiss();
    expect(r.showUnlock(many)).toBe(false); // limiter: same level key within the window
    expect(r.showUnlock({ level: 6, name: 'Top', items: [] })).toBe(true);
    expect(q(r, '.card')!.textContent).toContain('Nothing new to unlock');
    vi.useFakeTimers();
    r.showUnlock(model(2), performance.now() + 10 * 60_000);
    vi.advanceTimersByTime(UNLOCK_CARD_MS + 10);
    expect(r.showing).toBe(false);
  });

  it('has priority over the month card, yields to the welcome-back recap, and is suppressed during the tutorial', () => {
    const { r } = mk();
    const month = { title: 'Month', income: { label: 'Income', text: '$1' }, expense: { label: 'Exp', text: '$1' }, net: { label: 'Net', text: '$0', tone: 'neutral' as const }, guests: '1 guest', rating: null, highlight: '' };
    expect(r.showMonth(month as never, 'm1')).toBe(true);
    expect(r.showUnlock(model(2))).toBe(true); // replaces the month card
    expect(r.showMonth(month as never, 'm2')).toBe(false); // a month card never replaces a level-up card
    r.dismiss();
    r.suppress(true);
    expect(r.showUnlock(model(3))).toBe(false);
  });
});

const gv = (): GoalsView => ({ chapter: { id: 's1', title: 'Season 1: Open for business', index: 1, count: 4, done: 1, total: 4 }, active: [{ id: 'a', title: 'Goal A', flavour: 'f', todo: 't', progress: 0.5, reward: 1000 }], completed: 1, total: 20, finished: false, granted: 0 });
const pv = (o: Partial<ProgressView> = {}): ProgressView => ({
  mode: 'career', level: 2, name: 'Local favourite', max: false, next: { level: 3, name: 'Regional name' }, progress: 0.6,
  criteria: [{ id: 'guests', label: '1,500 guests in total', have: 700, need: 1500, met: false, progress: 0.47 }, { id: 'profitMonths', label: '2 months in profit', have: 1, need: 2, met: false, progress: 0.5 }, { id: 'stars', label: '3★ rating', have: 3, need: 3, met: true, progress: 1 }],
  nextUnlocks: unlocksAt(3), ...o,
});

describe('st-goals: level chip and progress view', () => {
  const setup = (p: () => ProgressView | undefined) => {
    const bus = new EventBus<GameEvents>(); const g = el('st-goals'); document.body.append(g);
    g.bind(bus, { view: gv, show: () => {}, ...(p() ? { progress: p as () => ProgressView } : {}) });
    return { g, bus };
  };
  it('shows "L2" in the header with a tooltip; no chip without a progress source', () => {
    const { g } = setup(() => pv());
    const chip = q(g, 'button.chip')!;
    expect(chip.hidden).toBe(false); expect(chip.textContent).toBe('L2'); expect(chip.title).toContain('Level 2 · Local favourite');
    document.body.replaceChildren();
    const b = setup(() => undefined);
    expect(q(b.g, 'button.chip')!.hidden).toBe(true);
  });
  it('clicking the chip swaps the body to the level panel: bar, the missing criteria only, and the next unlocks; click again returns to the goals', () => {
    const { g } = setup(() => pv());
    expect(qa(g, '.goal').length).toBe(1);
    (q(g, 'button.chip') as HTMLButtonElement).click();
    expect(qa(g, '.goal').length).toBe(0);
    const panel = q(g, '[data-level-panel]')!;
    expect(panel.textContent).toContain('Level 2 · Local favourite');
    expect(panel.textContent).toContain('Next: level 3 · Regional name');
    expect(qa(g, '.lv .cr').map((r) => r.textContent)).toEqual(['1,500 guests in total700 / 1,500', '2 months in profit1 / 2']); // met criteria are not listed
    expect(q(g, '.lv .bar')!.getAttribute('aria-valuenow')).toBe('60');
    expect(panel.textContent).toContain(`Unlocks: ${unlocksAt(3).map((u) => unlockName(u.kind, u.id)).join(', ')}`);
    expect(qa(g, '.lv .cr').length).toBeLessThanOrEqual(3);
    (q(g, 'button.chip') as HTMLButtonElement).click();
    expect(qa(g, '.goal').length).toBe(1);
  });
  it('Sandbox: chip says Sandbox and the panel explains that everything is unlocked; max level says so', () => {
    const { g } = setup(() => pv({ mode: 'sandbox' }));
    expect(q(g, 'button.chip')!.textContent).toBe('Sandbox');
    (q(g, 'button.chip') as HTMLButtonElement).click();
    expect(q(g, '[data-level-panel]')!.textContent).toContain('Everything is available');
    document.body.replaceChildren(); localStorage.clear(); // the chosen view is remembered
    const m = setup(() => pv({ level: 6, name: 'World-class destination', max: true, next: null, criteria: [], nextUnlocks: [] }));
    (q(m.g, 'button.chip') as HTMLButtonElement).click();
    expect(q(m.g, '[data-level-panel]')!.textContent).toContain('Top level reached');
  });
  it('refreshes on a milestone event (level-up) with the new level', () => {
    let level = 1;
    const { g, bus } = setup(() => pv({ level }));
    level = 3; bus.emit('milestone', { id: 'level:3', title: 'Level 3', major: true });
    expect(q(g, 'button.chip')!.textContent).toBe('L3');
  });
});

describe('st-new-game: game mode', () => {
  it('Career is preselected with a short description and tooltips; picking Sandbox changes the config; the start config carries the mode', () => {
    const g = el('st-new-game'); document.body.append(g);
    const started: Array<{ mode: string }> = [];
    g.bind({ start: (c) => started.push(c), random: () => 0.5 });
    g.open();
    const radios = qa(g, '[role=radio]');
    expect(radios.map((r) => r.dataset.mode)).toEqual(['career', 'sandbox']);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true'); expect(radios[1]!.getAttribute('aria-checked')).toBe('false');
    expect(radios.every((r) => r.title.length > 20)).toBe(true);
    expect(g.shadowRoot!.textContent).toContain('Grow from a small hill');
    expect(g.config.mode).toBe(DEFAULT_CONFIG.mode);
    radios[1]!.click();
    expect(g.config.mode).toBe('sandbox');
    expect(qa(g, '[role=radio]')[1]!.getAttribute('aria-checked')).toBe('true');
    expect(g.shadowRoot!.textContent).toContain('Everything is available');
    g.submit();
    expect(started[0]!.mode).toBe('sandbox');
  });
});

describe('st-marketing: Career lock', () => {
  it('a locked campaign card is marked, shows the level reason on its (disabled) button and never starts', async () => {
    const { Marketing } = await import('../../src/sim/Marketing');
    const { Economy } = await import('../../src/sim/Economy');
    const { buildMarketingView } = await import('../../src/ui/marketingFormat');
    const date = { year: 0, day: 250 };
    const m = new Marketing({ economy: new Economy({ money: 90000 }), date: () => date, gate: { locked: (k, id) => (k === 'campaign' && id === 'vip' ? lockedReason(5) : null) }, ctx: { season: () => 'winter', stars: () => 4, has: () => true, met: () => true, dayPassRatio: () => 1.2 } });
    const p = el('st-marketing'); document.body.append(p);
    const start = vi.fn((id: string) => m.start(id));
    p.bind({ view: () => buildMarketingView(m, 90000), start });
    const card = qa(p, '.card').find((c) => c.textContent!.includes('VIP'))!;
    expect(card.classList.contains('locked')).toBe(true);
    expect(card.textContent).toContain('🔒');
    const btn = card.querySelector('button')!;
    expect(btn.disabled).toBe(true); expect(btn.textContent).toBe('Unlocks at level 5: International resort'); expect(btn.title).toBe(btn.textContent);
    btn.click(); expect(start).not.toHaveBeenCalled();
    expect(qa(p, '.card.locked').length).toBe(1);
  });
});

describe('st-hud: level tooltip', () => {
  it('the whole card carries "Career · Level N · Name" and refreshes on milestone / day events', () => {
    const bus = new EventBus<GameEvents>(); const h = el('st-hud'); document.body.append(h);
    let t = 'Career · Level 1 · Open for business';
    h.bindLevel(bus, () => t);
    expect(q(h, '.panel')!.title).toBe(t);
    t = 'Career · Level 2 · Local favourite'; bus.emit('milestone', { id: 'level:2', title: 'x', major: true });
    expect(q(h, '.panel')!.title).toBe(t);
  });
});

describe('layout: level-up card anchor', () => {
  it('the level-up card (M5.3) lives in the same zone: 320 wide, no taller than the zone, and the goals card footprint (level chip + level view) did not grow', () => {
    for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700]] as const) {
      const z = zoneRect('top-card', vw, vh)!, g = zoneRect('right-goals', vw, vh)!;
      expect(RECAP_W).toBe(z.w);
      expect(UNLOCK_H).toBeLessThanOrEqual(z.h);
      expect(g.h).toBe(GOALS_CARD_H);
      expect(intersects({ x: z.x, y: z.y, w: RECAP_W, h: UNLOCK_H }, g)).toBe(false);
    }
  });
  it('st-recap stays a transient top-card panel', () => { expect(PANELS.find((p) => p.tag === 'st-recap')).toMatchObject({ zone: 'top-card', alwaysVisible: false }); });
});
