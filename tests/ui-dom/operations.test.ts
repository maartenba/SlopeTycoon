// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { Economy } from '../../src/sim/Economy';

registerComponents();
const rows = [
  { id: 1, name: 'T-Bar', kind: 'tbar', mode: 'auto' as const, from: 8.5, to: 16.5, eco: false, seasons: { winter: true, shoulder: false, summer: false }, energyPerDay: 40, carriesBikes: false, condition: 90, status: 'open' },
  { id: 2, name: 'Chairlift', kind: 'chair4', mode: 'auto' as const, from: 8.5, to: 16.5, eco: false, seasons: { winter: true, shoulder: true, summer: true }, energyPerDay: 80, carriesBikes: true, condition: 70, status: 'open' },
];

describe('operations panel', () => {
  it('renders one row per lift with season toggles and quick actions', () => {
    const p = el('st-operations'); document.body.append(p);
    const keepOnly = vi.fn(), setSeason = vi.fn();
    p.bind({ rows: () => rows, setMode: vi.fn(), setHours: vi.fn(), setEco: vi.fn(), setSeason, keepOnly, projected: (pr) => (pr === 'winter' ? 120 : 80) });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.querySelectorAll('tr').length).toBe(3);
    expect(root.textContent).toMatch(/saves/);
    const btn = [...root.querySelectorAll('button')].find((b) => /bike-capable lifts only/.test(b.textContent ?? ''))!;
    btn.click();
    expect(keepOnly).toHaveBeenCalledWith('summer', [2]);
    (root.querySelectorAll('input[type=checkbox]')[2] as HTMLInputElement).click();
    expect(setSeason).toHaveBeenCalled();
  });
});

describe('finance panel: declare bankruptcy', () => {
  it('shows a debt banner and asks for confirmation before declaring', () => {
    const p = el('st-finance'); document.body.append(p);
    const declare = vi.fn();
    const economy = new Economy({ money: -500 });
    p.bind({ economy, debt: () => 0, status: () => ({ status: 'debt', negDays: 12 }), declare });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toMatch(/In debt for 12 days/);
    const b = [...root.querySelectorAll('button')].find((x) => /Declare bankruptcy/.test(x.textContent ?? ''))!;
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false); b.click(); expect(declare).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true); b.click(); expect(declare).toHaveBeenCalledTimes(1);
  });
});

describe('lift inspector with operations', () => {
  it('shows condition, controls and a breakdown status', () => {
    const p = el('st-lift-inspector'); document.body.append(p);
    const api = { setOpen: vi.fn(), setSpeed: vi.fn(), demolish: vi.fn(), repair: vi.fn(), inspectNow: vi.fn(), setMode: vi.fn() };
    p.bind(api);
    p.show({
      id: 1, kind: 'chair6b', open: false, speed: 1, lengthM: 400, rideTimeS: 120, throughputPerHour: 3000, upkeepPerDay: 50, refund: 1000,
      ops: { mode: 'auto', from: 8.5, to: 16.5, eco: false, seasons: { winter: true, shoulder: true, summer: true }, inspection: 'basic', condition: 42, hold: 'fault', fault: { kind: 'breakdown' }, repairEtaHours: 3.5, stranded: 4, lastInspectionDaysAgo: 5, nextInspectionDays: 15, riskPerDay: 0.02, hasWorkshop: false, energyPerHour: 9, queue: 0 },
    });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toMatch(/BROKEN DOWN/);
    expect(root.textContent).toMatch(/4 guests stranded/);
    expect(root.textContent).toMatch(/Condition 42%/);
    expect(root.textContent).toMatch(/Workshop/i);
    [...root.querySelectorAll('button')].find((x) => /Rush repair/.test(x.textContent ?? ''))!.click();
    expect(api.repair).toHaveBeenCalledWith(1);
  });
});

describe('ranger station inspector section', () => {
  it('shows rangers +/- , bear-proof bins toggle and the monthly prevented-scares / revenue-saved line', () => {
    const p = el('st-inspector'); document.body.append(p);
    const onOps = vi.fn(), onBins = vi.fn();
    p.bind(vi.fn()); p.bindOps(onOps); p.bindBins(onBins);
    p.show({
      id: 7, type: 'rangerStation', active: true, refund: 100,
      ops: { kind: 'ranger', staff: 2, max: 4, bins: false, binsCost: 1500, preventedMonth: 5, savedMonth: 175, bearsInRange: 1, hazes: 3, relocations: 1, ready: 1 },
    });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toMatch(/Rangers: 2 \(1 ready\)/);
    expect(root.textContent).toMatch(/Prevented scares this month: 5 · est\. revenue saved \$175/);
    expect(root.textContent).toMatch(/Bears in range: 1 · hazed 3 · relocated 1/);
    const btns = [...root.querySelectorAll('button')];
    btns.find((b) => b.textContent === '+')!.click();
    expect(onOps).toHaveBeenCalledWith(7, 1);
    btns.find((b) => b.dataset.role === 'bins')!.click();
    expect(onBins).toHaveBeenCalledWith(7);
  });
});
