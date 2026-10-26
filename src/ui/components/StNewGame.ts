import { DIFFICULTY, DIFFICULTY_IDS, START_MONEY_RANGE, WALKING_RADIUS_RANGE, WALKING_RADIUS_TILES, type DifficultyId } from '../../config/balance';
import { DEFAULT_CONFIG, MAP_SIZES, START_SEASONS, normalizeConfig, randomSeed, seedFromText, seedName, startingMoney, type GameConfig } from '../../game/difficulty';
import { GAME_MODES, MODE_INFO } from '../../config/progression';
import { PRESET_IDS, TERRAIN_PRESETS } from '../../world/TerrainPresets';
import { formatMoney } from '../format';
import { Modal } from '../modal';
import { StElement } from './StElement';
import { makeSelect } from './StSelect';

/** Per-size hint + rough generation/load estimate (measured: docs/perf.md, terrain ~0.1 s / 0.3 s / 0.8 s, full boot a few times that). */
export const SIZE_HINTS: Record<number, string> = {
  64: '64: small & quick, great for learning. Loads in about a second.',
  128: '128: balanced (recommended). Loads in a few seconds.',
  256: '256: large, recommended for powerful devices. Generation and loading can take 10 s or more.',
};

export interface NewGameApi {
  /** Start with a validated config (the host reloads with the matching URL params). */
  start(cfg: GameConfig): void;
  cancel?(): void;
  /** The 'Scenarios' tab: close this dialog and open the scenario picker. */
  openScenarios?(): void;
  initial?: Partial<GameConfig>;
  /** Random seed source (tests inject a fixed one). */
  random?(): number;
}

/**
 * New Game dialog (shared dialog frame). Every `open()` pre-fills a FRESHLY RANDOMISED seed (shown as a readable name like Alpine-Fox-1234;
 * numbers and any text also work); the old / default seed is never reused. Closed = nothing rendered, no pointer events.
 */
export class StNewGame extends StElement {
  private api: NewGameApi | null = null;
  private cfg: GameConfig = { ...DEFAULT_CONFIG };
  private readonly dlg: Modal;
  private err = document.createElement('div');
  private progress = document.createElement('div');
  private startBtn = document.createElement('button');
  private seedInput = document.createElement('input');
  private seedLabel = document.createElement('span');
  private sizeHint = document.createElement('div');
  private moneyOut = document.createElement('span');
  private modeHint = document.createElement('div');
  private busy = false;

  protected css(): string {
    return ':host{display:block;width:0;height:0}.prog{height:6px;background:#34465e;border-radius:3px;overflow:hidden}.prog>i{display:block;height:100%;width:40%;background:#e0a030;animation:p 1s infinite linear}@keyframes p{from{margin-left:-40%}to{margin-left:100%}}' +
      '.err{color:#ff8a8a;min-height:0}.seg{display:flex;gap:4px;flex-wrap:wrap}.field>label,.field>.lbl{min-width:118px}.seed{width:210px}details{border-top:1px solid #34465e;padding-top:6px}summary{cursor:pointer;color:#cfe0f5;font-weight:700}' +
      '@media (prefers-reduced-motion:reduce){.prog>i{animation:none;width:100%}}';
  }

  constructor() {
    super();
    this.dlg = new Modal(this.root, {
      title: 'New game', icon: '⛷', size: 'md', backdropClose: true,
      beforeClose: () => !this.busy,
      onOpen: () => this.setAttribute('open', ''),
      onClose: () => { this.removeAttribute('open'); this.api?.cancel?.(); },
    });
    this.progress.hidden = true;
    this.progress.innerHTML = '<div class="hint">Generating terrain…</div><div class="prog"><i></i></div>';
  }

  bind(api: NewGameApi): void {
    this.api = api;
    this.cfg = normalizeConfig({ ...DEFAULT_CONFIG, seed: randomSeed(api.random), ...(api.initial ?? {}) });
    this.render();
  }

  get isOpen(): boolean { return this.dlg.isOpen; }
  get config(): GameConfig { return { ...this.cfg }; }
  /** Opens with a fresh random seed (never the previous one). */
  open(): void {
    this.busy = false;
    this.cfg = { ...this.cfg, seed: randomSeed(this.api?.random) };
    this.render();
    this.dlg.open();
  }
  close(): void { this.dlg.close(); }

  /** Programmatic setters (also used by tests). */
  set(part: Partial<GameConfig>): void {
    const typed = seedFromText(this.seedInput.value); if (typed !== null && !('seed' in part)) this.cfg.seed = typed;
    this.cfg = normalizeConfig({ ...this.cfg, ...part }); this.render(); }
  randomSeed(): void { this.set({ seed: randomSeed(this.api?.random) }); }
  /** Validate + start. Returns false (and shows the reason) on invalid input. */
  submit(): boolean {
    const seed = seedFromText(this.seedInput.value);
    if (seed === null) { this.err.textContent = 'Enter a seed (a number or a name like Alpine-Fox-1234), or press 🎲.'; return false; }
    this.cfg = normalizeConfig({ ...this.cfg, seed });
    this.err.textContent = '';
    this.busy = true; this.progress.hidden = false; this.startBtn.disabled = true;
    this.api?.start(this.config);
    return true;
  }

  private row(label: string, ...kids: Array<HTMLElement | string>): HTMLElement {
    const r = document.createElement('div'); r.className = 'field';
    const l = document.createElement('label'); l.textContent = label;
    r.append(l, ...kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k)));
    return r;
  }
  private seg<T extends string | number | boolean>(items: ReadonlyArray<{ v: T; text: string; title?: string }>, cur: T, on: (v: T) => void, cls = 'seg'): HTMLElement {
    const w = document.createElement('span'); w.className = 'seg';
    for (const it of items) {
      const b = document.createElement('button'); b.className = cls + (it.v === cur ? ' active' : ''); b.textContent = it.text; if (it.title) b.title = it.title;
      b.addEventListener('click', () => on(it.v)); w.append(b);
    }
    return w;
  }

  private render(): void {
    const c = this.cfg;
    this.sizeHint.className = 'hint'; this.sizeHint.textContent = SIZE_HINTS[c.size]!;
    this.seedInput.type = 'text'; this.seedInput.className = 'seed'; this.seedInput.value = seedName(c.seed); this.seedInput.setAttribute('aria-label', 'Seed'); this.seedInput.spellcheck = false;
    this.seedInput.oninput = () => { const s = seedFromText(this.seedInput.value); this.seedLabel.textContent = s === null ? '' : `Seed number ${s}`; };
    this.seedLabel.className = 'hint'; this.seedLabel.textContent = `Seed number ${c.seed}: the same seed always gives the same map.`;
    const dice = document.createElement('button'); dice.textContent = '🎲'; dice.title = 'New random seed'; dice.setAttribute('aria-label', 'Random seed'); dice.classList.add('icon'); dice.addEventListener('click', () => this.randomSeed());
    const preset = makeSelect(PRESET_IDS.map((id) => ({ value: id, label: TERRAIN_PRESETS[id].label, title: TERRAIN_PRESETS[id].blurb })), c.preset, 'Terrain preset', (v) => this.set({ preset: v as GameConfig['preset'] }));
    const presetHint = document.createElement('span'); presetHint.className = 'hint'; presetHint.textContent = TERRAIN_PRESETS[c.preset].blurb;
    const season = makeSelect(START_SEASONS.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) })), c.startSeason, 'Start season', (v) => this.set({ startSeason: v as GameConfig['startSeason'] }));
    const diff = makeSelect(DIFFICULTY_IDS.map((d) => ({ value: d, label: DIFFICULTY[d].label, title: DIFFICULTY[d].blurb })), c.difficulty, 'Difficulty', (v) => this.set({ difficulty: v as DifficultyId, money: null }));
    const diffHint = document.createElement('span'); diffHint.className = 'hint'; diffHint.textContent = DIFFICULTY[c.difficulty].blurb;
    const money = document.createElement('input'); money.type = 'range'; money.min = String(START_MONEY_RANGE.min); money.max = String(START_MONEY_RANGE.max); money.step = String(START_MONEY_RANGE.step);
    money.value = String(startingMoney(c)); money.setAttribute('aria-label', 'Starting money');
    this.moneyOut.className = 'money'; this.moneyOut.textContent = formatMoney(startingMoney(c)) + (c.money === null ? ' (difficulty default)' : '');
    money.addEventListener('input', () => { this.cfg.money = Number(money.value); this.moneyOut.textContent = formatMoney(this.cfg.money); });
    const loan = document.createElement('input'); loan.type = 'checkbox'; loan.checked = c.startLoan; loan.addEventListener('change', () => { this.cfg.startLoan = loan.checked; });
    const radius = document.createElement('input'); radius.type = 'number'; radius.min = String(WALKING_RADIUS_RANGE.min); radius.max = String(WALKING_RADIUS_RANGE.max); radius.value = String(c.radius ?? WALKING_RADIUS_TILES); radius.style.width = '64px';
    radius.addEventListener('change', () => { const v = Number(radius.value); this.cfg.radius = v === WALKING_RADIUS_TILES ? null : normalizeConfig({ radius: v }).radius; });
    const starter = this.seg([{ v: false, text: 'Empty map', title: 'Only the Base Lodge and roads' }, { v: true, text: 'Pre-built resort', title: 'Sandbox: lifts, pistes and services are already there' }], c.starterResort, (v) => this.set({ starterResort: v }));
    const hints = document.createElement('input'); hints.type = 'checkbox'; hints.className = 'toggle'; hints.checked = c.hints; hints.addEventListener('change', () => { this.cfg.hints = hints.checked; });
    // Game mode (M5.3): a real radio group (Career preselected); the blurb below follows the selection.
    const modes = document.createElement('div'); modes.className = 'seg'; modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Game mode'); modes.dataset.modes = '';
    for (const m of GAME_MODES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mode' + (m === c.mode ? ' active' : ''); b.textContent = MODE_INFO[m].label + (m === 'career' ? ' (recommended)' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(m === c.mode)); b.dataset.mode = m; b.title = MODE_INFO[m].tip;
      b.addEventListener('click', () => this.set({ mode: m })); modes.append(b);
    }
    this.modeHint.className = 'hint'; this.modeHint.textContent = MODE_INFO[c.mode].blurb;
    const adv = document.createElement('details'); const sm = document.createElement('summary'); sm.textContent = 'Advanced';
    adv.append(sm, this.row('Walking radius', radius, ' tiles (how far guests walk from the lodge)'), this.row('Start', starter));
    this.err.className = 'err'; this.err.setAttribute('role', 'alert');
    this.startBtn.className = 'primary'; this.startBtn.textContent = 'Start'; this.startBtn.disabled = this.busy; this.startBtn.dataset.autofocus = ''; this.startBtn.onclick = () => { this.submit(); };
    const cancel = document.createElement('button'); cancel.className = 'ghost'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => this.close());
    const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist');
    const tabCustom = document.createElement('button'); tabCustom.className = 'tab active'; tabCustom.textContent = 'Custom game'; tabCustom.setAttribute('role', 'tab'); tabCustom.setAttribute('aria-selected', 'true'); tabCustom.dataset.tab = 'custom';
    tabs.append(tabCustom);
    if (this.api?.openScenarios) {
      const tabScen = document.createElement('button'); tabScen.className = 'tab'; tabScen.textContent = 'Scenarios'; tabScen.setAttribute('role', 'tab'); tabScen.setAttribute('aria-selected', 'false'); tabScen.dataset.tab = 'scenarios';
      tabScen.title = 'Hand-made challenges with medals';
      tabScen.addEventListener('click', () => { if (this.busy) return; this.close(); this.api?.openScenarios?.(); });
      tabs.append(tabScen);
    }
    this.dlg.body.replaceChildren(
      tabs,
      this.row('Game mode', modes), this.modeHint,
      this.row('Map size', this.seg(MAP_SIZES.map((s) => ({ v: s as number, text: String(s) })), c.size, (v) => this.set({ size: v as GameConfig['size'] }), 'size')), this.sizeHint,
      this.row('Seed', this.seedInput, dice), this.seedLabel,
      this.row('Terrain', preset, presetHint),
      this.row('Start season', season),
      this.row('Difficulty', diff, diffHint),
      this.row('Starting money', money, this.moneyOut), this.row('Starter loan', loan, ' start with the $50,000 starter loan'),
      this.row('Show hints', hints),
      adv, this.err, this.progress,
    );
    this.dlg.footer.replaceChildren(cancel, this.startBtn);
  }
}
