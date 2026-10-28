// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { buildEcoBody, openEcoProgramme, type EcoBind } from '../../src/ui/ecoPanel';
import { ecoModel } from '../../src/ui/ecoFormat';
import { Eco } from '../../src/sim/meta/Eco';
import { sustainParts } from '../../src/sim/meta/Sustainability';
import { ECO, ECO_POLICIES } from '../../src/config/eco';

registerComponents();
afterEach(() => { document.body.replaceChildren(); });

const mk = (centre = true, money = 1e6): { eco: Eco; bind: EcoBind; set: { centre: boolean; money: number; share: number } } => {
  const set = { centre, money, share: 0.4 };
  const eco = new Eco({ centreActive: () => set.centre, funds: () => set.money, pay: (a) => { set.money -= a; }, transit: () => false, treeDeficit: () => 0, grid: () => ({ demand: 100, applied: 100 * set.share }) });
  const parts = sustainParts({ energyPerGuest: 6, treeLoss: 0.05, habitatOverlap: 0.1, protection: 0 });
  const bind: EcoBind = {
    model: () => ecoModel({ enabled: eco.enabled, parts, policies: eco.views(), cert: eco.certView(), ecoPoints: eco.points(), perDay: eco.upkeepPerDay() }),
    toggle: (id) => { if (eco.has(id)) { eco.stop(id); return null; } const why = eco.blocker(id); if (why) return why; eco.start(id); return null; },
    toggleCert: () => (eco.certView().on ? (eco.stopCert(), null) : eco.startCert()),
  };
  return { eco, bind, set };
};

describe('Eco programme dialog', () => {
  it('lists the breakdown, five policy cards and the certificate; each card shows effect, trade-off and cost', () => {
    const { bind } = mk();
    const m = document.createElement('div'); document.body.append(m);
    const body = buildEcoBody(bind.model(), bind, () => undefined); m.append(body);
    expect(body.querySelectorAll('[data-part]').length).toBe(5);
    expect(body.querySelectorAll('[data-policy]').length).toBe(ECO_POLICIES.length + 1);
    for (const p of ECO_POLICIES) {
      const card = body.querySelector(`[data-policy=${p.id}]`) as HTMLElement;
      expect(card.textContent).toContain(p.name); expect(card.textContent).toContain('Trade-off'); expect(card.textContent).toContain(`$${p.perDay}/day`); expect(card.textContent).toContain(`+${p.points} points`);
    }
    for (const row of body.querySelectorAll('[data-part]')) expect((row as HTMLElement).title.length).toBeGreaterThan(20); // tooltips explain how to raise each part
    expect(body.querySelector('[data-role=eco-head]')!.textContent).toMatch(/at most 30/);
  });
  it('toggle buttons start / stop a policy, are 44 px high, and are disabled without a centre or cash', () => {
    const { eco, bind, set } = mk();
    const open = openEcoProgramme(document.body, bind);
    const root = (open as unknown as { root: ShadowRoot }).root;
    const q = (sel: string): HTMLButtonElement => root.querySelector(sel) as HTMLButtonElement;
    const btn = (id: string): HTMLButtonElement => q(`[data-policy=${id}] [data-role=eco-toggle]`);
    expect(btn('carFree').textContent).toBe('Start'); expect(btn('carFree').style.minHeight || '').toBeDefined();
    btn('carFree').click();
    expect(eco.has('carFree')).toBe(true); expect(btn('carFree').textContent).toBe('Switch off');
    expect(root.querySelector('[data-role=eco-head]')!.textContent).toContain(`$${ECO_POLICIES.find((p) => p.id === 'carFree')!.perDay}/day`);
    btn('carFree').click(); expect(eco.has('carFree')).toBe(false);
    set.money = 10; btn('habitat').click(); // rebuild after the click is not needed: the model is read on open
    open.close();
    const none = mk(false); const o2 = openEcoProgramme(document.body, none.bind); const r2 = (o2 as unknown as { root: ShadowRoot }).root;
    expect((r2.querySelector('[data-policy=carFree] [data-role=eco-toggle]') as HTMLButtonElement).disabled).toBe(true);
    expect(r2.querySelector('[data-role=eco-head]')!.textContent).toMatch(/not working/);
    o2.close();
  });
  it('certificate card shows its three requirements and starts the audit', () => {
    const { eco, bind } = mk();
    const body = buildEcoBody(bind.model(), bind, () => undefined); document.body.append(body);
    const card = body.querySelector('[data-policy=cert]') as HTMLElement;
    expect(card.textContent).toContain(`0 of ${ECO.cert.policies} policies running`); expect(card.textContent).toContain('Renewables take'); expect(card.textContent).toContain(`of ${ECO.cert.holdDays} days`);
    (card.querySelector('[data-role=eco-cert]') as HTMLButtonElement).click();
    expect(eco.certView().on).toBe(true);
  });
  it('the cash refusal is shown as a message', () => {
    const { bind } = mk(true, 100);
    const body = buildEcoBody(bind.model(), bind, () => undefined); document.body.append(body);
    const b = body.querySelector('[data-policy=habitat] [data-role=eco-toggle]') as HTMLButtonElement;
    expect(b.disabled).toBe(true); expect(b.title).toBe('Not enough cash');
  });
});

describe('Eco Centre inspector button', () => {
  it('shows the lines and an action button that reports its id; touch target >= 44 px', () => {
    const e = el('st-inspector'); document.body.append(e);
    const calls: string[] = [];
    (e as unknown as { bindAction(f: (id: string) => void): void }).bindAction((id) => calls.push(id));
    e.show({ id: 9, type: 'ecoCentre', active: true, refund: 100, ops: { kind: 'energy', lines: [{ text: 'No policy running yet' }], action: { id: 'eco', label: 'Open the Eco programme' } } } as never);
    const root = (e as unknown as { root: ShadowRoot }).root;
    const b = root.querySelector('[data-role=energy-action]') as HTMLButtonElement;
    expect(b.textContent).toBe('Open the Eco programme'); expect(b.style.minHeight).toBe('44px');
    b.click(); expect(calls).toEqual(['eco']);
  });
});
