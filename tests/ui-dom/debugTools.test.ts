// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARM_MS, armedButton, buildDebugTools, reportLines } from '../../src/ui/debugTools';
import type { DemoReport } from '../../src/game/demoResort';

afterEach(() => { vi.useRealTimers(); });

describe('debug tools section', () => {
  it('a cheat button needs two clicks and disarms after a timeout', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const b = armedButton('Populate demo resort (cheats)', run);
    b.click();
    expect(run).not.toHaveBeenCalled();
    expect(b.textContent).toBe('Confirm: Populate demo resort (cheats)');
    vi.advanceTimersByTime(ARM_MS + 10);
    expect(b.textContent).toBe('Populate demo resort (cheats)');
    b.click(); expect(run).not.toHaveBeenCalled(); // disarmed again: first click only arms
    b.click(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('lists built counts and failures', () => {
    const r: DemoReport = { level: 'medium', placed: { chalet: 2, shop: 1 }, lifts: [{ id: 1, kind: 'tbar' }], pisteTiles: 120, pisteMids: [], hikeTiles: 30, mtbTiles: 25, failures: ['only 0/1 apartment'], log: [] };
    const lines = reportLines(r);
    expect(lines[0]).toMatch(/1 lifts \(tbar\), 120 piste tiles/);
    expect(lines[1]).toContain('✓ chalet ×2');
    expect(lines[2]).toBe('✗ only 0/1 apartment');
  });
  it('the section wires populate (after confirm), bear and animal buttons', () => {
    const api = { populate: vi.fn(() => ({ level: 'medium', placed: {}, lifts: [], pisteTiles: 0, pisteMids: [], hikeTiles: 0, mtbTiles: 0, failures: [], log: [] }) as DemoReport), spawnGuests: vi.fn(() => 5), findBear: vi.fn(() => 'bear!'), spawnBear: vi.fn(() => 'spawned'), findAnimal: vi.fn(() => 'deer') };
    const box = buildDebugTools(api);
    const btn = (t: string): HTMLButtonElement => [...box.querySelectorAll('button')].find((b) => b.textContent === t)!;
    expect(box.textContent).toContain('Debug tools');
    btn('Populate demo resort (cheats)').click();
    expect(api.populate).not.toHaveBeenCalled();
    btn('Confirm: Populate demo resort (cheats)').click();
    expect(api.populate).toHaveBeenCalledWith('medium');
    btn('Find bear').click(); expect(api.findBear).toHaveBeenCalled();
    btn('Spawn bear').click(); expect(api.spawnBear).toHaveBeenCalledWith(false);
    btn('Spawn bear near camera').click(); expect(api.spawnBear).toHaveBeenCalledWith(true);
    btn('Find deer').click(); expect(api.findAnimal).toHaveBeenCalledWith('deer');
    expect(box.querySelector('pre')!.textContent).toBe('deer');
  });
  it('town section: archetype select with Random, seed + dice, two-click Build town, checklist, reset', () => {
    const build = vi.fn((id: string, seed?: number) => ({ archetype: id, seed: seed ?? 0, placed: { chalet: 3 }, lifts: [{ kind: 'tbar' }], pisteTiles: 90, hikeTiles: 5, mtbTiles: 4, failures: ['only 0/1 altiport'], score: 0.81 }));
    const reset = vi.fn();
    const town = { list: [{ id: 'alpine', name: 'Alpine Village', tagline: 'Compact chalets' }, { id: 'rescue', name: 'Rescue Base', tagline: 'Heli pad' }], mapSize: 128, seed: 7, quickSeeds: () => [11, 12, 13], build, reset };
    const box = buildDebugTools({ populate: vi.fn(), spawnGuests: vi.fn(() => 0), findBear: vi.fn(() => ''), spawnBear: vi.fn(() => ''), findAnimal: vi.fn(() => ''), town } as never);
    const sel = box.querySelector('select[aria-label="Town archetype"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Random nice town', 'Alpine Village', 'Rescue Base']);
    const seed = box.querySelector('input[aria-label="Town seed"]') as HTMLInputElement;
    expect(seed.value).toBe('7');
    sel.value = 'rescue'; sel.dispatchEvent(new Event('change'));
    expect([11, 12, 13]).toContain(Number(seed.value)); // a vetted seed is rolled on archetype change
    expect(box.textContent).toContain('Heli pad');
    (box.querySelector('button[aria-label="Random seed"]') as HTMLButtonElement).click();
    seed.value = '42';
    const btn = (t: string): HTMLButtonElement => [...box.querySelectorAll('button')].find((b) => b.textContent === t)!;
    btn('Build town (cheats)').click();
    expect(build).not.toHaveBeenCalled();
    btn('Confirm: Build town (cheats)').click();
    expect(build).toHaveBeenCalledWith('rescue', 42);
    const text = box.querySelector('pre')!.textContent!;
    expect(text).toContain('Rescue Base (seed 42)');
    expect(text).toContain('✓ chalet ×3');
    expect(text).toContain('✗ only 0/1 altiport');
    btn('Reset map (reload)').click(); btn('Confirm: Reset map (reload)').click();
    expect(reset).toHaveBeenCalled();
    sel.value = 'random'; sel.dispatchEvent(new Event('change'));
    btn('Build town (cheats)').click(); btn('Confirm: Build town (cheats)').click();
    expect(['alpine', 'rescue']).toContain(build.mock.calls.at(-1)![0]);
    expect(box.textContent).toContain('Level'); // the level select + 'Populate demo resort' are retained
  });
});
