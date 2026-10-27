// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import type { MaintApi, MaintRow } from '../../src/ui/components/StOperations';
import { benefitText, maintDate, windowOptions } from '../../src/ui/maintFormat';

registerComponents();
const row = (o: Partial<MaintRow> = {}): MaintRow => ({ id: 1, name: 'Chairlift', state: 'ok', window: 'auto', autoMonth: 3, nextLabel: 'Sat 1 Apr · Y2', lastLabel: null, sinceDays: 40, days: 2, cost: 430, riskMult: 1, canServiceNow: true, servicing: false, ...o });
const api = (rows: MaintRow[], o: Partial<MaintApi> = {}): MaintApi => ({ policy: () => 'auto', setPolicy: vi.fn(), rows: () => rows, setWindow: vi.fn(), scheduleAll: vi.fn(), serviceNow: vi.fn(() => true), projected: () => ({ cost: 860, count: 2 }), ...o });
const mount = (m: MaintApi) => {
  const p = el('st-operations'); document.body.append(p);
  p.bind({ rows: () => [], setMode: vi.fn(), setHours: vi.fn(), setEco: vi.fn(), setSeason: vi.fn(), keepOnly: vi.fn(), projected: () => 0, maint: m });
  const root = (p as unknown as { root: ShadowRoot }).root;
  (root.querySelector('button[data-tab=maint]') as HTMLElement).click();
  return root;
};

describe('Operations > Maintenance tab', () => {
  it('lists lifts with window, next service, cost and the 30-day projection', () => {
    const root = mount(api([row(), row({ id: 2, state: 'overdue', lastLabel: 'Mon 3 Apr · Y1', riskMult: 1.9, window: '9' })]));
    expect(root.querySelectorAll('tr[data-lift]').length).toBe(2);
    expect(root.textContent).toMatch(/Sat 1 Apr/);
    expect(root.textContent).toMatch(/overdue/i);
    expect(root.querySelector('[data-role=maint-projected]')!.textContent).toMatch(/2 lifts.*\$860/);
  });
  it('policy toggle, bulk "Schedule all in April", per-lift window and Service now call the api', () => {
    const m = api([row()]);
    const root = mount(m);
    (root.querySelector('button[data-policy=manual]') as HTMLElement).click();
    expect(m.setPolicy).toHaveBeenCalledWith('manual');
    (root.querySelector('button[data-role=sched-april]') as HTMLElement).click();
    expect(m.scheduleAll).toHaveBeenCalledWith(3);
    (root.querySelector('button[data-role=service-now]') as HTMLElement).click();
    expect(m.serviceNow).toHaveBeenCalledWith(1);
  });
  it('Service now is disabled while the lift carries riders; Manual policy hides the next date', () => {
    const root = mount(api([row({ canServiceNow: false })], { policy: () => 'manual' }));
    expect((root.querySelector('button[data-role=service-now]') as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector('tr[data-lift]')!.textContent).toMatch(/manual/);
    expect(root.querySelector('button[data-policy=manual]')!.className).toMatch(/active/);
  });
});

describe('maintenance texts use the real calendar', () => {
  it('window options carry the month names, dates read like the Events panel', () => {
    const o = windowOptions(3);
    expect(o[0]).toEqual({ value: 'auto', label: 'Auto (April)' }); expect(o.map((x) => x.label)).toContain('October'); expect(o.length).toBe(13);
    expect(maintDate(0)).toMatch(/^[A-Z][a-z]{2} 1 Apr · Y0$/);
    expect(maintDate(180 + 14)).toMatch(/15 Apr · Y1$/);
  });
  it('cost / benefit: skipping shows the risk multiplier; overdue states it now', () => {
    const plan = { days: 3, cost: 520, level: 'basic' };
    expect(benefitText({ state: 'ok', riskMult: 1, skipRiskMult: 2.1, plan })).toMatch(/Skipping service: breakdown risk x2\.1/);
    expect(benefitText({ state: 'overdue', riskMult: 1.8, skipRiskMult: 2.5, plan })).toMatch(/Overdue: breakdown risk x1\.8/);
  });
});

describe('lift inspector: service block', () => {
  it('shows last / next service, the cost text, the window select and Service now', () => {
    const p = el('st-lift-inspector'); document.body.append(p);
    const api = { setOpen: vi.fn(), setSpeed: vi.fn(), demolish: vi.fn(), serviceNow: vi.fn(), setServiceWindow: vi.fn() };
    p.bind(api);
    p.show({
      id: 4, kind: 'chair4', open: true, speed: 1, lengthM: 600, rideTimeS: 120, throughputPerHour: 2000, upkeepPerDay: 40, refund: 900,
      ops: {
        mode: 'auto', from: 8.5, to: 16.5, eco: false, seasons: { winter: true, shoulder: false, summer: false }, inspection: 'basic', condition: 77, hold: null, fault: null, repairEtaHours: 0, stranded: 0,
        lastInspectionDaysAgo: null, nextInspectionDays: null, riskPerDay: 0.01, hasWorkshop: true, energyPerHour: 5, queue: 0,
        service: { state: 'due', policy: 'auto', lastLabel: 'Sat 1 Apr · Y1', nextLabel: 'Sat 1 Apr · Y2', sinceDays: 160, window: 'auto', autoMonth: 3, plan: { days: 2, cost: 410, level: 'basic' }, riskMult: 1, skipRiskMult: 2.1, inServiceHours: 0, canServiceNow: true },
      },
    });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toMatch(/Service due soon/);
    expect(root.textContent).toMatch(/last service Sat 1 Apr · Y1/);
    expect(root.textContent).toMatch(/Next service Sat 1 Apr · Y2/);
    expect(root.textContent).toMatch(/Skipping service: breakdown risk x2\.1/);
    expect(root.textContent).toMatch(/Service window/);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Service now')!.click();
    expect(api.serviceNow).toHaveBeenCalledWith(4);
  });
  it('closed for service: status line says so and Service now is disabled', () => {
    const p = el('st-lift-inspector'); document.body.append(p); p.bind({ setOpen: vi.fn(), setSpeed: vi.fn(), demolish: vi.fn() });
    p.show({
      id: 4, kind: 'chair4', open: false, speed: 1, lengthM: 600, rideTimeS: 120, throughputPerHour: 2000, upkeepPerDay: 40, refund: 900,
      ops: {
        mode: 'auto', from: 8.5, to: 16.5, eco: false, seasons: { winter: true, shoulder: false, summer: false }, inspection: 'basic', condition: 77, hold: 'service', fault: { kind: 'service' }, repairEtaHours: 48, stranded: 0,
        lastInspectionDaysAgo: null, nextInspectionDays: null, riskPerDay: 0.01, hasWorkshop: true, energyPerHour: 5, queue: 0,
        service: { state: 'ok', policy: 'auto', lastLabel: null, nextLabel: null, sinceDays: 200, window: '3', autoMonth: 3, plan: { days: 2, cost: 410, level: 'basic' }, riskMult: 1, skipRiskMult: 1.4, inServiceHours: 48, canServiceNow: false },
      },
    });
    const root = (p as unknown as { root: ShadowRoot }).root;
    expect(root.textContent).toMatch(/Closed for annual service \(2\.0 d left\)/);
    expect((([...root.querySelectorAll('button')].find((b) => /Servicing/.test(b.textContent ?? ''))) as HTMLButtonElement).disabled).toBe(true);
  });
});
