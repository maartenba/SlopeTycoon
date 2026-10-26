// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import type { GoalsView } from '../../src/sim/goals/Goals';
import type { GoalsApi } from '../../src/ui/components/StGoals';

registerComponents();

const view = (o: Partial<GoalsView> = {}): GoalsView => ({
  chapter: { id: 'local', title: 'Local favourite', index: 2, count: 4, done: 1, total: 5 },
  active: [
    { id: 'stars3', title: 'Reach a 3-star rating', flavour: 'Guests start recommending you.', todo: 'Keep queues short.', progress: 0.5, reward: 2000 },
    { id: 'guests80', title: 'Welcome 80 guests in a day', flavour: 'Busy car park.', todo: 'More lifts.', progress: 0.25, reward: 2500 },
    { id: 'skiSchool', title: 'Run a ski school', flavour: 'Tomorrow\u2019s regulars.', todo: 'Build a Ski School HQ.', progress: 0, reward: 2500 },
  ],
  completed: 5, total: 20, finished: false, granted: 5000, ...o,
});
const setup = (v: () => GoalsView): { g: ReturnType<typeof el<'st-goals'>>; bus: EventBus<GameEvents>; shown: string[] } => {
  const bus = new EventBus<GameEvents>(), shown: string[] = [];
  const g = el('st-goals');
  document.body.append(g);
  g.bind(bus, { view: v, show: (id) => shown.push(id) } satisfies GoalsApi);
  return { g, bus, shown };
};
const q = (g: HTMLElement, sel: string): HTMLElement[] => Array.from(g.shadowRoot!.querySelectorAll<HTMLElement>(sel));

describe('st-goals', () => {
  it('createElement adds no attributes or children; connect / disconnect / reconnect are safe', () => {
    const e = document.createElement('st-goals');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
    document.body.append(e); e.remove();
    expect(() => { document.body.append(e); e.remove(); }).not.toThrow();
  });

  it('shows the chapter title, the count and one row per active goal with a progress bar and the reward', () => {
    const { g } = setup(() => view());
    expect(q(g, '.head .t')[0]!.textContent).toBe('Local favourite');
    expect(q(g, '.head .n')[0]!.textContent).toBe('5/20');
    const rows = q(g, '.goal');
    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelector('.name')!.textContent).toBe('Reach a 3-star rating');
    expect(rows[0]!.title).toContain('recommending');
    const bar = rows[0]!.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect((bar.querySelector('i') as HTMLElement).style.width).toBe('50%');
    expect(rows[1]!.querySelector('.rw')!.textContent).toContain('2,500');
    g.remove();
  });

  it('"Show me" calls back with the goal id', () => {
    const { g, shown } = setup(() => view());
    (q(g, '.goal')[1]!.querySelector('button.show') as HTMLButtonElement).click();
    expect(shown).toEqual(['guests80']);
    g.remove();
  });

  it('collapses and expands (header button) and remembers the choice', () => {
    const { g } = setup(() => view());
    const head = q(g, 'button.head')[0] as HTMLButtonElement;
    head.click();
    expect(q(g, '.goal').length).toBe(0);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    g.remove();
    const again = setup(() => view());
    expect(q(again.g, '.goal').length).toBe(0); // stays collapsed
    (q(again.g, 'button.head')[0] as HTMLButtonElement).click();
    expect(q(again.g, '.goal').length).toBe(3);
    again.g.remove();
  });

  it('refreshes on time:hour and milestone events', () => {
    let v = view();
    const { g, bus } = setup(() => v);
    v = view({ chapter: { id: 'regional', title: 'Regional name', index: 3, count: 4, done: 0, total: 5 }, completed: 9 });
    bus.emit('milestone', { id: 'chapter:local', title: 'x', major: true });
    expect(q(g, '.head .t')[0]!.textContent).toBe('Regional name');
    v = view({ completed: 10 });
    bus.emit('time:hour', { hour: 3 });
    expect(q(g, '.head .n')[0]!.textContent).toBe('10/20');
    g.remove();
  });

  it('is hidden while suppressed (tutorial running) and back afterwards; a finished chain says so', () => {
    const { g } = setup(() => view());
    g.suppress(true); expect(g.hidden).toBe(true);
    g.suppress(false); expect(g.hidden).toBe(false);
    g.remove();
    const done = setup(() => view({ finished: true, chapter: null, active: [], completed: 20 }));
    expect(q(done.g, '.head .t')[0]!.textContent).toBe('Career complete');
    expect(q(done.g, '.done').length).toBe(1);
    done.g.remove();
  });
});
