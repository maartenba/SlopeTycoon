// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { ASSISTANT_CSS, avatarSvg, type AssistantApi } from '../../src/ui/components/StAssistant';
import { SPOTLIGHT_CSS } from '../../src/ui/components/StSpotlight';
import { STEPS } from '../../src/tutorial/steps';
import { stepKey, t } from '../../src/tutorial/strings';
import type { EngineView } from '../../src/tutorial/TutorialEngine';

registerComponents();
(window as unknown as { innerWidth: number }).innerWidth = 1280; // wide window: bubble starts open (narrow < 1100 starts minimised)

const view = (o: Partial<EngineView> = {}, step: Partial<NonNullable<EngineView['step']>> = {}): EngineView => ({
  status: 'active',
  step: { id: 'parking', title: 'Build a parking lot', text: 'Open **Buildings** and press `Q`.', index: 4, total: 31, expr: 'point', canNext: false, canSkip: true, ack: false, doLabel: 'default', price: 3150, canDo: true, ...step },
  ui: null, map: null, note: null, message: null, minimised: false, goals: null, completedCount: 3, ...o,
});
const api = (): AssistantApi & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, show: () => calls.push('show'), doIt: () => calls.push('do'), skip: () => calls.push('skip'), next: () => calls.push('next'), prev: () => calls.push('prev'), minimise: (m) => calls.push(`min:${m}`), exit: () => calls.push('exit') };
};
const shadowButtons = (e: HTMLElement): HTMLButtonElement[] => Array.from(e.shadowRoot!.querySelectorAll('button'));
const btn = (e: HTMLElement, text: string): HTMLButtonElement => shadowButtons(e).find((b) => (b.textContent ?? '').includes(text))!;

describe('st-assistant', () => {
  it('createElement adds no attributes or children; connect / disconnect / reconnect are safe', () => {
    const a = document.createElement('st-assistant');
    expect(a.attributes.length).toBe(0);
    expect(a.childNodes.length).toBe(0);
    document.body.append(a);
    a.remove();
    expect(() => { document.body.append(a); a.remove(); }).not.toThrow();
  });

  it('INPUT SAFETY: the host and wrapper are pointer-events:none, no full-screen box, only small boxes accept clicks', () => {
    const a = el('st-assistant');
    document.body.append(a);
    expect(a.style.pointerEvents).toBe('none');
    const wrap = a.shadowRoot!.querySelector('.wrap') as HTMLElement;
    expect(wrap.style.pointerEvents).toBe('none');
    expect((a.shadowRoot!.querySelector('.goals') as HTMLElement).style.pointerEvents).toBe('none');
    const host = /:host\{([^}]*)\}/.exec(ASSISTANT_CSS)![1]!;
    expect(host).toContain('pointer-events:none');
    expect(host).not.toMatch(/inset|100vw|100vh|width:100%|height:100%/);
    expect(ASSISTANT_CSS).not.toMatch(/inset\s*:\s*0/);
    // every selector that re-enables events is a small control
    const autos = [...ASSISTANT_CSS.matchAll(/([^{}]+)\{[^}]*pointer-events:auto[^}]*\}/g)].map((m) => m[1]!.trim());
    expect(autos.length).toBeGreaterThan(0);
    for (const sel of autos) expect(sel, sel).toMatch(/^(\.bubble,\.hintb|\.avatar|\.advbadge|\.advice)$/);
    a.remove();
  });

  it('the global stylesheet keeps both overlay hosts click-through (outer `#ui > *` rule would otherwise win)', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/#ui > st-spotlight, #ui > st-assistant \{ pointer-events: none; \}/);
  });

  it('renders the lesson: title, rich text, progress, price; buttons call the API', () => {
    const a = el('st-assistant');
    const x = api();
    a.bind(x);
    document.body.append(a);
    a.render(view());
    const root = a.shadowRoot!;
    expect(root.querySelector('.title')!.textContent).toBe('Build a parking lot');
    expect(root.querySelector('.text b')!.textContent).toBe('Buildings');
    expect(root.querySelector('.text kbd')!.textContent).toBe('Q');
    expect(root.querySelector('.dots')!.textContent).toContain('Step 4 of 31');
    expect(root.querySelectorAll('.dot').length).toBe(31);
    expect(btn(a, 'Do it for me').textContent).toContain('$3,150');
    for (const [label, call] of [['Show me', 'show'], ['Do it for me', 'do'], ['Skip step', 'skip'], ['Hide', 'min:true']] as const) { btn(a, label).click(); expect(x.calls.pop()).toBe(call); }
    btn(a, 'Back').click(); expect(x.calls.pop()).toBe('prev');
    a.remove();
  });

  it('information steps show Got it instead of Do it / Skip; the Do button is disabled when no plan exists', () => {
    const a = el('st-assistant');
    const x = api(); a.bind(x);
    document.body.append(a);
    a.render(view({}, { ack: true, canNext: true, canDo: false, price: null }));
    expect(btn(a, 'Got it').hidden).toBe(false);
    btn(a, 'Got it').click();
    expect(x.calls).toEqual(['next']);
    expect(btn(a, 'Do it for me').hidden).toBe(true);
    a.render(view({}, { canDo: false, price: null }));
    expect((btn(a, 'Do it for me') as HTMLButtonElement).disabled).toBe(true);
    a.remove();
  });

  it('Exit asks for confirmation; Keep going cancels, Exit confirms', () => {
    const a = el('st-assistant');
    const x = api(); a.bind(x);
    document.body.append(a);
    a.render(view());
    btn(a, 'Exit tutorial').click();
    expect(a.exitConfirmVisible).toBe(true);
    expect(x.calls).toEqual([]);
    btn(a, 'Keep going').click();
    expect(a.exitConfirmVisible).toBe(false);
    btn(a, 'Exit tutorial').click();
    shadowButtons(a).find((b) => b.textContent === 'Exit')!.click();
    expect(x.calls).toEqual(['exit']);
    a.remove();
  });

  it('minimised: only the avatar badge shows and clicking it restores the bubble', () => {
    const a = el('st-assistant');
    const x = api(); a.bind(x);
    document.body.append(a);
    a.render(view({ minimised: true }));
    expect(a.minimised).toBe(true);
    (a.shadowRoot!.querySelector('.avatar') as HTMLButtonElement).click();
    expect(x.calls).toEqual(['min:false']);
    a.render(view({ minimised: false }));
    expect(a.minimised).toBe(false);
    a.remove();
  });

  it('goals panel is shown with progress and never takes input; messages and notes render', () => {
    const a = el('st-assistant');
    a.bind(api());
    document.body.append(a);
    a.render(view({ message: 'Done! That cost $3,150.', note: 'Flat spot near the road.', goals: { guests: { done: false, have: 12, need: 200 }, stars: { done: true, have: 4, need: 4 }, profit: { done: false } } }));
    const root = a.shadowRoot!;
    expect(root.querySelector('.msg')!.textContent).toContain('Done!');
    expect(root.querySelector('.note')!.textContent).toContain('Flat spot');
    const goals = root.querySelector('.goals') as HTMLElement;
    expect(goals.hidden).toBe(false);
    expect(goals.textContent).toContain('200');
    expect(goals.querySelectorAll('.done').length).toBe(1);
    expect(goals.style.pointerEvents).toBe('none');
    a.remove();
  });

  it('the avatar has six expressions drawn as inline SVG (no assets)', () => {
    const faces = (['idle', 'point', 'cheer', 'worried', 'think', 'wave'] as const).map((e) => avatarSvg(e).outerHTML);
    expect(new Set(faces).size).toBe(6);
    for (const f of faces) { expect(f).toContain('<svg'); expect(f).toContain('aria-label="Ranger Rudi"'); expect(f).toContain('class="eyes"'); }
  });

  it('one-shot hint bubble: shows, dismisses and auto-hides (UI timer only)', () => {
    vi.useFakeTimers();
    const a = el('st-assistant');
    document.body.append(a);
    a.hint('Pistes are turning **icy**.', 1000);
    expect(a.hintVisible).toBe(true);
    expect(a.shadowRoot!.querySelector('.hintb')!.textContent).toContain('icy');
    vi.advanceTimersByTime(1100);
    expect(a.hintVisible).toBe(false);
    a.hint('Again', 0);
    expect(a.hintVisible).toBe(true);
    (a.shadowRoot!.querySelector('.hintb button') as HTMLButtonElement).click();
    expect(a.hintVisible).toBe(false);
    a.remove();
    vi.useRealTimers();
  });

  it('finished / blocked tutorials show a closing state without lesson buttons', () => {
    const a = el('st-assistant');
    a.bind(api());
    document.body.append(a);
    a.render({ ...view(), status: 'complete', step: null, message: 'Tutorial finished.' });
    expect(a.visible).toBe(true);
    expect(btn(a, 'Show me').hidden).toBe(true);
    a.render({ ...view(), status: 'off', step: null });
    expect(a.visible).toBe(false);
    a.remove();
  });
});

describe('st-spotlight', () => {
  it('createElement adds no attributes or children; connect / disconnect are safe', () => {
    const s = document.createElement('st-spotlight');
    expect(s.attributes.length).toBe(0);
    expect(s.childNodes.length).toBe(0);
    document.body.append(s);
    s.remove();
    expect(() => { document.body.append(s); s.remove(); }).not.toThrow();
  });

  it('INPUT SAFETY: zero-sized host, every overlay element pointer-events:none, dimming only via box-shadow', () => {
    const s = el('st-spotlight');
    document.body.append(s);
    expect(s.style.pointerEvents).toBe('none');
    const host = /:host\{([^}]*)\}/.exec(SPOTLIGHT_CSS)![1]!;
    expect(host).toContain('pointer-events:none');
    expect(host).toContain('width:0');
    expect(host).toContain('height:0');
    expect(SPOTLIGHT_CSS).not.toMatch(/inset\s*:\s*0/);
    expect(SPOTLIGHT_CSS).not.toMatch(/pointer-events\s*:\s*auto/);
    for (const e of Array.from(s.shadowRoot!.querySelectorAll('.ring,.arrow')) as HTMLElement[]) expect(e.style.pointerEvents).toBe('none');
    expect(SPOTLIGHT_CSS).toMatch(/\.ring\.dim\{[^}]*box-shadow:[^}]*100vmax/);
    s.remove();
  });

  it('draws the ring around the resolved element (rect tracked), hides when it is gone, and follows moves', () => {
    const s = el('st-spotlight');
    const target = document.createElement('button');
    let rect = { left: 100, top: 200, width: 80, height: 40 };
    target.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) });
    let present = true;
    const resolve = vi.fn((chain: readonly string[]) => (chain.length && present ? target : null));
    s.bind({ resolve });
    document.body.append(s);
    s.setTarget(['dock:buildings', 'drawer:item:parking']);
    expect(resolve).toHaveBeenCalledWith(['dock:buildings', 'drawer:item:parking']);
    const ring = s.shadowRoot!.querySelector('.ring') as HTMLElement;
    expect(s.visible).toBe(true);
    expect(ring.style.left).toBe('96px');
    expect(ring.style.top).toBe('196px');
    expect(ring.style.width).toBe('88px');
    rect = { left: 300, top: 50, width: 60, height: 30 };
    s.tick(true);
    expect(ring.style.left).toBe('296px');
    present = false;
    s.tick(true);
    expect(s.visible).toBe(false);
    s.setTarget(null);
    expect(s.active).toBe(false);
    s.remove();
  });
});

describe('st-assistant narrow windows', () => {
  it('starts minimised once under 1100 px wide', () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1000;
    const a = document.createElement('st-assistant') as unknown as { bind(x: AssistantApi): void; render(v: EngineView): void } & HTMLElement;
    document.body.append(a);
    const x = api(); a.bind(x); a.render(view());
    expect(x.calls).toContain('min:true');
    (window as unknown as { innerWidth: number }).innerWidth = 1280;
    a.remove();
  });

  it('before the first render() the bubble and its buttons are hidden; a hint() alone shows only the hint (no blank dialog)', () => {
    const a = el('st-assistant');
    document.body.append(a);
    const r = a.shadowRoot!;
    expect((r.querySelector('.bubble') as HTMLElement).hidden).toBe(true);
    a.hint('Pistes are turning **icy**.', 0);
    expect((r.querySelector('.wrap') as HTMLElement).hidden).toBe(false);
    expect((r.querySelector('.bubble') as HTMLElement).hidden).toBe(true);
    for (const b of r.querySelectorAll('.btns button')) expect((b as HTMLElement).hidden, b.textContent ?? '').toBe(true);
    a.remove();
  });

  it('EVERY tutorial step renders a non-empty title, text and dots; the text colour is not a CSS variable', () => {
    const a = el('st-assistant');
    document.body.append(a);
    const r = a.shadowRoot!;
    for (const [i, st] of STEPS.entries()) {
      const title = t(stepKey(st.id, 'title')), text = t(stepKey(st.id, 'text'));
      expect(title, st.id).not.toBe(stepKey(st.id, 'title'));
      expect(text, st.id).not.toBe(stepKey(st.id, 'text'));
      a.render(view({}, { id: st.id, title, text, index: i + 1, total: STEPS.length, ack: !!st.ack, canNext: !!st.ack }));
      expect((r.querySelector('.bubble') as HTMLElement).hidden, st.id).toBe(false);
      expect(r.querySelector('.title')!.textContent!.trim().length, st.id).toBeGreaterThan(0);
      expect(r.querySelector('.text')!.textContent!.trim().length, st.id).toBeGreaterThan(0);
      expect(r.querySelectorAll('.dot').length, st.id).toBe(STEPS.length);
      expect(btn(a, t('ui.next')).hidden, st.id).toBe(!st.ack); // 'Got it' only for acknowledge steps
    }
    expect(ASSISTANT_CSS).not.toMatch(/var\(--/);
    expect(ASSISTANT_CSS).toMatch(/:host\{[^}]*color:#fff/);
    a.remove();
  });
});
