import type { EventBus } from '@/core/EventBus';
import { scaledFontsCss, tokensCss } from '../tokens';
import { motionSheet } from '../motionSheet';

/** Shared UI kit (docs/ui-kit.md): buttons, fields, checkbox/toggle, range, tabs, scrollbars, tooltips, focus rings and the dialog frame. Every st-* shadow root gets it. */
export const KIT_CSS = `
button, select, input, textarea { font: inherit; }
button { min-height: var(--touch-min, 0px); min-width: var(--touch-min, 0px); background: linear-gradient(#3b4f69, #31435b); color: #fff; border: 1px solid #4f6684; border-radius: var(--r-sm); padding: 3px var(--sp-3); cursor: pointer; font-weight: 600; transition: background .12s, border-color .12s, transform .05s; }
button:hover:not(:disabled) { background: linear-gradient(#4a6483, #3c5472); border-color: #6f8bb0; }
button:active:not(:disabled) { transform: translateY(1px); }
button:disabled { opacity: .45; cursor: default; }
button.active { background: linear-gradient(#f0b040, #e0a030); border-color: var(--c-accent-text); color: #1a1208; }
button.primary { background: linear-gradient(#f2b43e, #dc9526); border-color: #ffd070; color: #1a1208; font-weight: 800; }
button.primary:hover:not(:disabled) { background: linear-gradient(#ffc454, #eaa22e); border-color: #ffe29a; }
button.danger { background: linear-gradient(#d0534a, #b13d34); border-color: #e87a6e; }
button.danger:hover:not(:disabled) { background: linear-gradient(#e0665c, #c24a40); }
button.ghost { background: transparent; border-color: transparent; color: var(--c-muted); }
button.ghost:hover:not(:disabled) { background: rgba(255,255,255,.08); border-color: transparent; color: #fff; }
button.icon { padding: 2px 7px; min-width: max(26px, var(--touch-min, 0px)); }
:focus-visible { outline: 2px solid var(--c-accent-text); outline-offset: 1px; }
input[type=text], input[type=number], input[type=search], input:not([type]), textarea, select { background: var(--c-field); color: #fff; border: 1px solid var(--c-field-border); border-radius: var(--r-sm); padding: 3px 7px; box-sizing: border-box; }
input[type=text], input[type=number], input[type=search], input:not([type]), textarea, select { min-height: var(--touch-min, 0px); }
label:has(> input[type=checkbox]), label:has(> input[type=radio]) { min-height: var(--touch-min, 0px); }
input[type=text]:hover, input[type=number]:hover, select:hover { border-color: #5f7798; }
input::placeholder { color: #7d8fa6; }
input[type=number] { font-variant-numeric: tabular-nums; }
select { appearance: none; -webkit-appearance: none; padding-right: 22px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23b9c6d8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 7px center; }
select option { background: #141c28; color: #fff; }
input[type=checkbox] { appearance: none; -webkit-appearance: none; width: max(16px, calc(var(--touch-min, 0px) * .55)); height: max(16px, calc(var(--touch-min, 0px) * .55)); margin: 0; flex: none; vertical-align: middle; background: var(--c-field); border: 1px solid #5f7798; border-radius: 4px; cursor: pointer; display: inline-grid; place-content: center; }
/* touch: the hit area of a checkbox / toggle grows to --touch-min through an invisible ::before (the control keeps its look) */
input[type=checkbox] { position: relative; }
input[type=checkbox]::before { content: ""; position: absolute; inset: calc(var(--touch-min, 0px) * -.25); }
input[type=checkbox].toggle::before { inset: calc(var(--touch-min, 0px) * -.32) calc(var(--touch-min, 0px) * -.16); }
input[type=checkbox]::after { content: ""; width: 9px; height: 5px; border-left: 2.5px solid #1a1208; border-bottom: 2.5px solid #1a1208; transform: rotate(-45deg) scale(0); margin-top: -2px; transition: transform .1s; }
input[type=checkbox]:checked { background: var(--c-accent); border-color: var(--c-accent-text); }
input[type=checkbox]:checked::after { transform: rotate(-45deg) scale(1); }
input[type=checkbox].toggle { width: 34px; height: 18px; border-radius: 9px; background: #2a3a50; border-color: #4f6684; position: relative; display: inline-block; }
input[type=checkbox].toggle::after { content: ""; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; margin: 0; border: 0; border-radius: 50%; background: #b9c6d8; transform: none; transition: left .12s, background .12s; }
input[type=checkbox].toggle:checked { background: #b9811f; border-color: var(--c-accent-text); }
input[type=checkbox].toggle:checked::after { left: 18px; background: #fff; transform: none; }
input[type=range] { appearance: none; -webkit-appearance: none; background: transparent; height: max(18px, var(--touch-min, 0px)); margin: 0; cursor: pointer; accent-color: var(--c-accent); }
input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(#1d2a3b, #2b3d54); border: 1px solid #40536d; }
input[type=range]::-moz-range-track { height: 6px; border-radius: 3px; background: #2b3d54; border: 1px solid #40536d; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffe29a, #e0a030); border: 1px solid #fff3; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #e0a030; border: 1px solid #fff3; }
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--c-border-soft); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tabs > * { flex: none; white-space: nowrap; }
.tab, button.tab { background: transparent; border: 1px solid transparent; border-bottom: 0; border-radius: var(--r-md) var(--r-md) 0 0; padding: 5px 14px; color: var(--c-muted); font-weight: 700; margin-bottom: -1px; }
.tab:hover:not(:disabled) { background: rgba(255,255,255,.06); color: #fff; border-color: transparent; }
.tab.active, button.tab.active { background: rgba(255,255,255,.08); color: var(--c-accent-text); border-color: var(--c-border-soft); border-bottom: 1px solid #1a2331; }
[data-tip] { position: relative; }
[data-tip]:hover::after, [data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%); z-index: 50; white-space: nowrap; background: #0c121b; color: #fff; border: 1px solid var(--c-border-soft); border-radius: var(--r-sm); padding: 3px 8px; font-size: var(--fs-sm); font-weight: 600; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,.5); }
a { color: var(--c-ice); }
kbd { font: 700 var(--fs-sm)/1 var(--font-ui); background: #0f1722; border: 1px solid #40536d; border-bottom-width: 2px; border-radius: 4px; padding: 2px 5px; color: var(--c-accent-text); }
.num, .money { font-variant-numeric: tabular-nums; }
.sep { width: 1px; align-self: stretch; background: var(--c-border); }
.muted { color: var(--c-muted); }
* { scrollbar-width: thin; scrollbar-color: #5a7090 transparent; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #4a607c; border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: #6682a6; background-clip: content-box; }
.layer { display: none; position: fixed; inset: 0; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; pointer-events: auto; }
.layer.open { display: flex; }
.layer > .bd { position: absolute; inset: 0; background: rgba(6,10,16,.62); }
.dlg { position: relative; display: flex; flex-direction: column; width: min(var(--w, 640px), 100%); max-height: 100%; box-sizing: border-box; background: linear-gradient(#1c2635, #151d29); border: 1px solid #4a6080; border-radius: var(--r-lg); box-shadow: 0 18px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.07); overflow: hidden; }
.dlg.sm { --w: var(--modal-sm); } .dlg.md { --w: var(--modal-md); } .dlg.lg { --w: var(--modal-lg); }
.dlg > header { display: flex; align-items: center; gap: var(--sp-3); padding: 10px 12px 10px 16px; background: linear-gradient(#26354a, #1f2c3e); border-bottom: 1px solid #34465e; }
.dlg > header .ic { font-size: 18px; line-height: 1; }
.dlg > header h2 { flex: 1; margin: 0; font: 400 var(--fs-xl)/1.1 var(--font-display); letter-spacing: .4px; color: #fff; }
.dlg > header .x { padding: 2px 8px; font-size: 14px; }
.dlg > .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.dlg > footer { display: flex; gap: var(--sp-3); justify-content: flex-end; align-items: center; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid #34465e; background: rgba(0,0,0,.18); }
.dlg > footer:empty { display: none; }
.field { display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap; }
.field > label, .field > .lbl { min-width: 120px; color: #cfe0f5; font-weight: 700; }
.section { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid #2f4057; border-radius: var(--r-md); background: rgba(255,255,255,.03); }
.section > h3 { margin: 0 0 2px; font: 400 var(--fs-lg)/1.2 var(--font-display); color: var(--c-accent-text); letter-spacing: .3px; }
.hint { color: #9fb4cc; font-size: var(--fs-sm); }
`;

export const BASE_CSS = `
:host { ${tokensCss()}; ${scaledFontsCss()}; pointer-events: auto; font: var(--fs-md)/1.3 var(--font-ui); color: var(--c-text); }
.panel { background: var(--c-panel); border: 1px solid rgba(90,112,144,.35); border-radius: var(--r-md); padding: var(--sp-2) var(--sp-3); display: flex; gap: var(--sp-2); align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,.28); }
:host([hidden]), [hidden] { display: none !important; }
${KIT_CSS}`;

/** Base class: shadow root, adopted stylesheet (fallback <style>), auto-unsubscribing bus bindings. */
export abstract class StElement extends HTMLElement {
  protected readonly root: ShadowRoot;
  private unsubs: Array<() => void> = [];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    const css = BASE_CSS + this.css();
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in this.root) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        const rm = motionSheet();
        this.root.adoptedStyleSheets = rm ? [sheet, rm] : [sheet];
        return;
      } catch { /* fall through to <style> */ }
    }
    const style = document.createElement('style');
    style.textContent = css;
    this.root.appendChild(style);
  }

  protected css(): string { return ''; }

  /** Subscribe to a bus; automatically removed on disconnect. */
  protected listen<E extends { [K in keyof E]: unknown }, K extends keyof E>(
    bus: EventBus<E>, type: K, h: (p: E[K]) => void,
  ): void {
    this.unsubs.push(bus.on(type, h));
  }

  protected track(unsub: () => void): void { this.unsubs.push(unsub); }

  disconnectedCallback(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
