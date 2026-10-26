import { registerComponents, el } from './index';
import { logoSvg } from './logo';
import { rudiMarkup, RUDI_EXPRESSIONS } from './components/rudiAvatar';
import { makeSelect } from './components/StSelect';
import { confirmDialog, showModal } from './components/StModal';
import { COLORS, FONTS, TOKENS } from './tokens';


/** Ranger Rudi comparison sheet: every expression at 120 / 56 / 24 px on dark and light. */
function rudiSheet(): string {
  const ring = (px: number, e: (typeof RUDI_EXPRESSIONS)[number], mini = false): string => `<div style="width:${px}px;height:${px}px;border-radius:50%;border:${px > 60 ? 3 : 2}px solid #ffd070;overflow:hidden;box-sizing:border-box;background:#2a3a52;flex:none">${rudiMarkup(e, mini).replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div>`;
  const row = (bg: string): string => `<div style="background:${bg};padding:14px;border-radius:10px;display:flex;flex-direction:column;gap:12px">`
    + [[120, false], [56, false], [24, true]].map(([px, mini]) => `<div style="display:flex;gap:14px;align-items:center">${RUDI_EXPRESSIONS.map((e) => ring(px as number, e, mini as boolean)).join('')}</div>`).join('') + '</div>';
  return `<div id="rudi-sheet" style="display:flex;flex-direction:column;gap:14px"><div style="font:16px sans-serif;color:#ffd070">Ranger Rudi: ${RUDI_EXPRESSIONS.join(' / ')}</div>${row('#18263a')}${row('#e8f1fa')}</div>`;
}

/** Dev page `?uikit=1`: every control + token + logo on one screen for screenshot review (docs/ui-kit.md). */
export function mountUiKit(ui: HTMLElement, mode = '1'): HTMLElement {
  registerComponents();
  if (mode.startsWith('logo')) { // one large logo for the candidate sketches in docs/img
    const light = mode === 'logo-light', variant = (light ? 'full' : mode.slice(5)) as 'full' | 'badge' | 'wordmark' | 'mark';
    const p = document.createElement('div');
    p.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:${light ? '#e8f1fa' : 'radial-gradient(ellipse at 50% 40%,#2a4a73,#0e1827)'}`;
    p.innerHTML = logoSvg({ variant, theme: light ? 'light' : 'dark', height: variant === 'wordmark' ? 220 : 420 });
    ui.append(p);
    return p;
  }
  if (mode === 'rudi') {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0e1520';
    p.innerHTML = rudiSheet();
    ui.append(p);
    return p;
  }
  const page = document.createElement('div');
  page.id = 'uikit';
  page.style.cssText = 'position:absolute;inset:0;overflow:auto;background:linear-gradient(#18263a,#0e1520);color:#fff;font:13px/1.4 ' + FONTS.ui + ';padding:20px 28px;box-sizing:border-box';
  const host = el('st-modal'); // shadow root with the shared kit css to render the sample controls in
  page.append(host);
  const demo = document.createElement('div');
  demo.innerHTML = `
  <style>
    #uikit h1{font:400 28px ${FONTS.display};margin:0 0 4px} #uikit h3{font:400 16px ${FONTS.display};color:#ffd070;margin:18px 0 6px}
    #uikit .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0} #uikit .sw{width:56px;height:34px;border-radius:6px;border:1px solid #fff3;font-size:10px;display:flex;align-items:flex-end;padding:2px}
    #uikit .lg{background:#14202f;padding:14px;border-radius:10px;border:1px solid #fff2} #uikit .lg.l{background:#e8f1fa}
  </style>
  <h1>Slope Tycoon UI kit</h1><div style="color:#9fb4cc">Nunito (UI) · Lilita One (display) · self-hosted</div>
  <h3>Logo</h3><div class="row"><div class="lg" id="k-full">${logoSvg({ variant: 'full', height: 150 })}</div><div class="lg l">${logoSvg({ variant: 'full', theme: 'light', height: 150 })}</div>
  <div class="lg">${logoSvg({ variant: 'badge', height: 150 })}</div><div class="lg">${logoSvg({ variant: 'wordmark', height: 70 })}</div>
  <div class="lg">${logoSvg({ variant: 'mark', height: 64 })} ${logoSvg({ variant: 'mark', height: 32 })} ${logoSvg({ variant: 'mark', height: 16 })}</div></div>
  <h3>Ranger Rudi</h3>${rudiSheet()}
  <h3>Typography</h3><div style="font:400 28px ${FONTS.display}">Display: Slope Tycoon $1,234,567</div><div style="font-size:16px">UI Nunito 16: The quick brown fox jumps over the lazy dog · <b>Bold</b> · <span style="font-variant-numeric:tabular-nums">0123456789 $ 12:45</span></div>
  <h3>Palette</h3><div class="row">${Object.entries(COLORS).map(([k, v]) => `<div class="sw" style="background:${v};color:#000" title="${k}">${k}</div>`).join('')}</div>
  <div style="color:#9fb4cc">spacing ${[TOKENS.sp1, TOKENS.sp2, TOKENS.sp3, TOKENS.sp4, TOKENS.sp5].join('/')} · radii ${TOKENS.rSm}/${TOKENS.rMd}/${TOKENS.rLg}</div>`;
  page.append(demo);
  // controls rendered inside a shadow root so they get the kit css (BASE_CSS)
  const sh = document.createElement('div'); sh.id = 'kit-controls';
  const shadow = sh.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${(host.constructor as unknown as { kitCss?: string }).kitCss ?? ''}</style>`;
  page.append(sh);
  void import('./components/StElement').then(({ BASE_CSS }) => {
    const st = document.createElement('style');
    st.textContent = BASE_CSS + ':host{display:block;font:var(--fs-md)/1.3 var(--font-ui)}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}h3{font:400 16px var(--font-display);color:#ffd070;margin:18px 0 6px}';
    shadow.prepend(st);
    const box = document.createElement('div');
    box.innerHTML = `<h3>Buttons</h3><div class="row"><button>Default</button><button class="primary">Primary</button><button class="danger">Danger</button><button class="ghost">Ghost</button><button class="active">Active</button><button disabled>Disabled</button><button class="icon" data-tip="Icon button tooltip">⚙</button><button data-tip="Custom tooltip">Hover me</button></div>
    <h3>Fields</h3><div class="row"><input type="text" value="Alpine-Fox-1234"><input type="number" value="12" style="width:70px"><input type="text" placeholder="placeholder"><input type="checkbox" checked> <input type="checkbox"> <input type="checkbox" class="toggle" checked> <input type="checkbox" class="toggle"><input type="range" value="60"><select><option>Native select (restyled)</option><option>Two</option></select><span id="k-sel"></span><span id="k-sel2"></span></div>
    <h3>Tabs</h3><div class="tabs"><button class="tab active">Save</button><button class="tab">Load</button><button class="tab">Other</button></div>
    <h3>Dialogs</h3><div class="row"><button id="k-confirm">Confirm dialog</button><button id="k-info" class="primary">Info dialog (sm)</button><button id="k-lg">Large dialog</button><kbd>Ctrl</kbd>+<kbd>S</kbd></div>`;
    shadow.append(box);
    const s1 = makeSelect([{ value: 'a', label: 'Winter' }, { value: 'b', label: 'Spring' }, { value: 'c', label: 'Summer' }, { value: 'd', label: 'Autumn' }], 'a', 'Season');
    const s2 = makeSelect([{ value: 'x', label: 'Auto (daylight)' }, { value: 'y', label: 'Open' }, { value: 'z', label: 'Closed', disabled: true }], 'y', 'Mode');
    shadow.getElementById('k-sel')!.append(s1); shadow.getElementById('k-sel2')!.append(s2);
    shadow.getElementById('k-confirm')!.addEventListener('click', () => { void confirmDialog(ui, { title: 'Delete save?', message: 'Delete “My Resort”? This cannot be undone.', confirm: 'Delete', danger: true }); });
    shadow.getElementById('k-info')!.addEventListener('click', () => { showModal(ui, { title: 'Info', icon: 'ℹ', body: 'A small dialog (420 px).', actions: [{ label: 'OK', kind: 'primary' }] }); });
    shadow.getElementById('k-lg')!.addEventListener('click', () => { showModal(ui, { title: 'Large dialog', icon: '📋', size: 'lg', body: 'A large dialog (920 px) with a scrolling body.\n'.repeat(40), actions: [{ label: 'Close', kind: 'primary' }] }); });
  });
  ui.append(page);
  return page;
}
