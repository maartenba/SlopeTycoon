// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { StaffApi, StaffPoolRow, StaffUpgradeRow } from '../../src/ui/components/StOperations';

registerComponents();
const pools: StaffPoolRow[] = (['instructors', 'patrol', 'groomers', 'liftOps'] as const).map((id, i) => ({ id, label: id, icon: '·', auto: id !== 'liftOps', count: 2 + i, need: 3, fill: id === 'liftOps' ? 0.5 : 1, slows: 'x' }));
const ups = (): StaffUpgradeRow[] => ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: `Up ${id}`, icon: '·', effect: 'fx', cost: 1000, days: 5, upkeep: 10, state: i === 0 ? 'available' : i === 1 ? 'locked' : 'busy', daysLeft: 0, reason: i === 1 ? 'Unlocks at level 3: Regional name' : 'Another course is running' }));

const make = () => {
  const staff: StaffApi = {
    pools: () => pools, setAuto: vi.fn(), setCount: vi.fn(), wage: () => 'normal', setWage: vi.fn(),
    morale: () => ({ value: 0.7, label: 'Content', breakdownFactor: 1 }), billPerDay: () => 100, upgrades: ups, train: vi.fn(() => null),
  };
  const p = el('st-operations'); document.body.append(p);
  p.bind({ rows: () => [], setMode: vi.fn(), setHours: vi.fn(), setEco: vi.fn(), setSeason: vi.fn(), keepOnly: vi.fn(), projected: () => 0, staff });
  return { p, staff, root: (p as unknown as { root: ShadowRoot }).root };
};

describe('Staff tab (StOperations)', () => {
  it('has Lifts / Staff tabs; Lifts is the default', () => {
    const { root } = make();
    expect([...root.querySelectorAll('button.tab')].map((b) => b.textContent)).toEqual(['Lifts', 'Staff']);
    expect(root.textContent).toMatch(/No lifts yet/);
  });
  it('Staff tab: one row + Auto toggle per pool, a headcount only when overridden, six upgrade rows', () => {
    const { root, staff } = make();
    (root.querySelector('button[data-tab=staff]') as HTMLButtonElement).click();
    const boxes = [...root.querySelectorAll('input[data-pool]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, false]);
    const nums = [...root.querySelectorAll('.pool input[type=number]')] as HTMLInputElement[];
    expect(nums.map((n) => n.disabled)).toEqual([true, true, true, false]);
    expect(root.querySelectorAll('.ups .u')).toHaveLength(6);
    boxes[3]!.checked = true; boxes[3]!.dispatchEvent(new Event('change'));
    expect(staff.setAuto).toHaveBeenCalledWith('liftOps', true);
    nums[3]!.value = '5'; nums[3]!.dispatchEvent(new Event('change'));
    expect(staff.setCount).toHaveBeenCalledWith('liftOps', 5);
  });
  it('Train is enabled only for available courses; locked ones show their level', () => {
    const { root, staff } = make();
    (root.querySelector('button[data-tab=staff]') as HTMLButtonElement).click();
    const btns = [...root.querySelectorAll('button[data-upgrade]')] as HTMLButtonElement[];
    expect(btns.map((b) => b.disabled)).toEqual([false, true, true, true, true].slice(0, btns.length).map((v, i) => (i === 0 ? false : true)));
    btns[0]!.click();
    expect(staff.train).toHaveBeenCalledWith('a');
    expect(root.textContent).toMatch(/Level 3/);
  });
});
