import { icon } from '../icons';
import { StElement } from './StElement';

export interface ViewHudModel {
  /** "Guest #12" */
  title: string;
  /** What the guest is doing ("Skiing", "Riding a lift" ...). */
  activity: string;
  kmh: number;
  /** Altitude in metres. */
  altitude: number;
  /** "Paused" / "1x" / "2x" / "3x". */
  speed: string;
  /** Cabin interior (gondola, cable car, funicular): draws a window frame. */
  interior: boolean;
}

export interface WalkHudModel {
  /** 'Near Lodge 1' */
  location: string;
  altitude: number;
  /** 'NE' */
  compass: string;
  /** Context prompt: 'E: Board Chairlift 1' ('' = none). */
  prompt: string;
  /** Compact info popover (after E on a building / guest / lift). */
  card: { title: string; lines: string[] } | null;
  /** Set while riding a lift cosmetically: 'Riding Chairlift 1' + 0..1 progress. */
  riding?: { name: string; progress: number };
  speed: string;
  hint: string;
}

export interface ViewHudApi { exit(): void; next(): void }

/**
 * Minimal HUD of the ride-along view (M5.2): guest, activity, speed, altitude, sim speed and the exit / next buttons. While it is shown, main.ts
 * puts `view-ride` on the body, which hides the rest of the UI (dock, drawers, goals, advisor, news) and shrinks the toasts. The host is a 0x0
 * box and the cabin frame is a pointer-events:none layer, so the canvas stays the drag-look surface.
 */
export class StViewHud extends StElement {
  private api: ViewHudApi | null = null;
  private readonly card = document.createElement('div');
  private readonly heading = document.createElement('div');
  private readonly activity = document.createElement('div');
  private readonly stats = document.createElement('div');
  private readonly frame = document.createElement('div');
  private shown = false;
  private readonly walk = document.createElement('div');
  private readonly walkLoc = document.createElement('div');
  private readonly walkMeta = document.createElement('div');
  private readonly walkHint = document.createElement('div');
  private readonly dot = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly info = document.createElement('div');

  protected css(): string {
    return `:host{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:40}
.card{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;pointer-events:auto;padding:8px 12px;max-width:calc(100vw - 24px);box-sizing:border-box}
.who{display:flex;flex-direction:column;min-width:0}.title{font-weight:800;color:#ffd070;white-space:nowrap}.activity{color:#dbe6f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats{display:flex;gap:14px;font-variant-numeric:tabular-nums}.stats b{font-size:18px;color:#fff}.stats span{color:var(--c-muted);font-size:var(--fs-sm)}
.stat{display:flex;flex-direction:column;align-items:center;line-height:1.1}
.keys{display:flex;align-items:center;gap:6px;color:var(--c-muted);font-size:var(--fs-sm);white-space:nowrap}
button{display:inline-flex;align-items:center;gap:5px}
.frame{position:fixed;inset:0;pointer-events:none;display:none;box-shadow:inset 0 0 0 22px rgba(24,28,36,.92),inset 0 0 90px 30px rgba(0,0,0,.35);border-radius:6px}
.frame.on{display:block}
.walk{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:auto;padding:6px 14px;max-width:calc(100vw - 24px);box-sizing:border-box;text-align:center}
.walk .loc{font-weight:800;color:#ffd070}.walk .meta{color:#dbe6f6;font-variant-numeric:tabular-nums;font-size:var(--fs-sm)}.walk .hint{color:var(--c-muted);font-size:var(--fs-sm)}
.dot{position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 1px rgba(0,0,0,.55);pointer-events:none}
.prompt{position:fixed;left:50%;top:calc(50% + 26px);transform:translateX(-50%);padding:4px 10px;border-radius:6px;background:rgba(20,26,36,.78);color:#fff;font-weight:700;pointer-events:none;white-space:nowrap}
.info{position:fixed;left:calc(50% + 40px);top:calc(50% - 20px);max-width:min(300px,calc(50vw - 56px));padding:8px 12px;pointer-events:none}
.info b{color:#ffd070;display:block}.info div{color:#dbe6f6;font-size:var(--fs-sm)}
[hidden]{display:none!important}
@media (max-width:760px){.keys .k2{display:none}}`;
  }

  constructor() {
    super();
    this.card.className = 'panel card';
    this.card.setAttribute('role', 'group');
    this.card.setAttribute('aria-label', 'Ride-along');
    const who = document.createElement('div'); who.className = 'who';
    this.heading.className = 'title'; this.activity.className = 'activity';
    who.append(this.heading, this.activity);
    this.stats.className = 'stats';
    const keys = document.createElement('div'); keys.className = 'keys';
    const next = document.createElement('button'); next.className = 'next'; next.title = 'Next guest (N)';
    next.append(icon('next', 13), document.createTextNode('Next guest'));
    next.addEventListener('click', () => this.api?.next());
    const exit = document.createElement('button'); exit.className = 'exit primary'; exit.title = 'Exit ride-along (Esc)';
    exit.append(icon('exit', 12), document.createTextNode('Exit'));
    exit.addEventListener('click', () => this.api?.exit());
    const hint = document.createElement('span'); hint.className = 'k2'; hint.textContent = 'Esc exit · N next · drag to look';
    keys.append(hint, next, exit);
    this.card.append(icon('eye', 18), who, this.stats, keys);
    this.frame.className = 'frame';
    // walk variant (Task 12)
    this.walk.className = 'panel walk'; this.walk.setAttribute('role', 'group'); this.walk.setAttribute('aria-label', 'Walk mode');
    this.walkLoc.className = 'loc'; this.walkMeta.className = 'meta'; this.walkHint.className = 'hint';
    const wexit = document.createElement('button'); wexit.className = 'exit primary'; wexit.title = 'Exit walk mode (Esc)';
    wexit.append(icon('exit', 12), document.createTextNode('Exit'));
    wexit.addEventListener('click', () => this.api?.exit());
    this.walk.append(this.walkLoc, this.walkMeta, this.walkHint, wexit);
    this.dot.className = 'dot'; this.prompt.className = 'prompt'; this.info.className = 'panel info';
    this.root.append(this.card, this.frame, this.walk, this.dot, this.prompt, this.info);
    this.card.hidden = true; this.walk.hidden = true; this.dot.hidden = true; this.prompt.hidden = true; this.info.hidden = true;
  }

  /** Host attributes may not be set in the constructor (document.createElement forbids it). */
  connectedCallback(): void { this.hidden = !this.shown; }

  bind(api: ViewHudApi): void { this.api = api; }

  get visible(): boolean { return this.shown; }
  get walkVisible(): boolean { return !this.walk.hidden; }
  get promptText(): string { return this.prompt.hidden ? '' : (this.prompt.textContent ?? ''); }
  get infoVisible(): boolean { return !this.info.hidden; }

  /** Walk-mode HUD: location, altitude, compass, hint, crosshair dot, context prompt and info popover. `null` hides it (and the ride card too). */
  renderWalk(m: WalkHudModel | null): void {
    if (!m) { this.walk.hidden = true; this.dot.hidden = true; this.prompt.hidden = true; this.info.hidden = true; if (this.card.hidden) { this.shown = false; this.hidden = true; } return; }
    this.shown = true; this.hidden = false; this.card.hidden = true; this.frame.classList.remove('on');
    this.walk.hidden = false;
    this.walkLoc.textContent = m.riding ? `Riding ${m.riding.name} · ${Math.round(m.riding.progress * 100)}%` : m.location;
    this.walkMeta.textContent = `${Math.round(m.altitude)} m · ${m.compass} · ${m.speed}`;
    this.walkHint.textContent = m.hint;
    this.dot.hidden = !!m.riding;
    this.prompt.hidden = !m.prompt; this.prompt.textContent = m.prompt;
    this.info.hidden = !m.card;
    if (m.card) {
      const t = document.createElement('b'); t.textContent = m.card.title;
      this.info.replaceChildren(t, ...m.card.lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })));
    }
  }
  get frameOn(): boolean { return this.frame.classList.contains('on'); }

  /** `null` hides the HUD. Cheap enough to call every few frames. */
  render(m: ViewHudModel | null): void {
    if (!m) { this.shown = false; this.hidden = true; this.card.hidden = true; this.frame.classList.remove('on'); this.renderWalk(null); return; }
    this.shown = true; this.hidden = false; this.card.hidden = false;
    this.heading.textContent = m.title;
    this.activity.textContent = m.activity;
    this.frame.classList.toggle('on', m.interior);
    const stat = (v: string, unit: string): HTMLElement => { const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('b'); b.textContent = v; const u = document.createElement('span'); u.textContent = unit; d.append(b, u); return d; };
    this.stats.replaceChildren(stat(String(m.kmh), 'km/h'), stat(String(Math.round(m.altitude)), 'm alt'), stat(m.speed, 'game speed'));
  }
}
