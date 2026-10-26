import type { DemoLevel, DemoReport } from '../game/demoResort';

/** Callbacks the 'Debug tools' section needs (wired in main.ts; keeps this file DOM-only and unit-testable). */
export interface DebugToolsApi {
  populate(level: DemoLevel): DemoReport;
  spawnGuests(n: number, mix: 'mixed' | 'skiers' | 'hikers'): number;
  findBear(): string;
  spawnBear(near: boolean): string;
  findAnimal(species: string | null): string;
  /** Demo towns (archetypes): optional so older hosts / tests keep working. */
  town?: {
    list: ReadonlyArray<{ id: string; name: string; tagline: string }>;
    mapSize: number;
    seed: number;
    /** Vetted seeds for this archetype on the current map size (may be empty). */
    quickSeeds(id: string): readonly number[];
    build(id: string, seed?: number): TownLike;
    /** Throw the map away (reload with the same URL). */
    reset(): void;
  };
}

/** What the town checklist needs from a build. */
export interface TownLike { archetype: string; seed: number; placed: Record<string, number>; lifts: Array<{ kind: string }>; pisteTiles: number; hikeTiles: number; mtbTiles: number; failures: string[]; score: number }

/** Checklist lines of a built town: what was built (✓) and what failed (✗). */
export function townLines(r: TownLike, name = r.archetype): string[] {
  const out = [`Built ${name} (seed ${r.seed}): niceness ${r.score.toFixed(2)}, ${r.lifts.length} lifts (${r.lifts.map((l) => l.kind).join(', ') || 'none'}), ${r.pisteTiles} piste tiles, ${r.hikeTiles} hike / ${r.mtbTiles} MTB trail tiles`];
  const placed = Object.entries(r.placed).sort(([a], [b]) => a.localeCompare(b));
  out.push(placed.length ? placed.map(([k, v]) => `✓ ${k} ×${v}`).join('  ') : '(nothing new placed)');
  for (const f of r.failures) out.push(`✗ ${f}`);
  return out;
}

/** How long the first click of a cheat button stays armed. */
export const ARM_MS = 4000;

/** Two-step button: the first click arms it ('Confirm: <label>'), the second within ARM_MS runs `run`. Prevents accidental triggers. */
export function armedButton(label: string, run: () => void, doc: Document = document): HTMLButtonElement {
  const b = doc.createElement('button');
  b.textContent = label;
  let timer = 0;
  b.addEventListener('click', () => {
    if (b.dataset.armed === '1') { window.clearTimeout(timer); b.dataset.armed = ''; b.textContent = label; run(); return; }
    b.dataset.armed = '1'; b.textContent = `Confirm: ${label}`;
    timer = window.setTimeout(() => { b.dataset.armed = ''; b.textContent = label; }, ARM_MS);
  });
  return b;
}

/** Plain-text checklist of a demo report (shown under the button; also logged). */
export function reportLines(r: DemoReport): string[] {
  const out = [`Built level "${r.level}": ${r.lifts.length} lifts (${r.lifts.map((l) => l.kind).join(', ') || 'none'}), ${r.pisteTiles} piste tiles, ${r.hikeTiles} hike / ${r.mtbTiles} MTB trail tiles`];
  const placed = Object.entries(r.placed).sort(([a], [b]) => a.localeCompare(b));
  out.push(placed.length ? placed.map(([k, v]) => `✓ ${k} ×${v}`).join('  ') : '(nothing new placed)');
  for (const f of r.failures) out.push(`✗ ${f}`);
  return out;
}

/** The F3 'Debug tools' section: demo-resort builder, guest spawner, bear / animal finders. */
export function buildDebugTools(api: DebugToolsApi, doc: Document = document): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'debug-tools';
  box.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:4px;border:1px dashed #c04040;border-radius:4px;font-size:12px';
  const title = doc.createElement('div');
  title.textContent = 'Debug tools (cheats: free, ignore costs)';
  title.style.cssText = 'font-weight:700;color:#c04040';
  const out = doc.createElement('pre');
  out.style.cssText = 'margin:0;font-size:10px;white-space:pre-wrap;max-height:160px;overflow:auto';
  out.setAttribute('aria-live', 'polite');
  const say = (t: string): void => { out.textContent = t; };

  const level = doc.createElement('select');
  level.setAttribute('aria-label', 'Demo resort level');
  for (const [v, l] of [['starter', 'Starter'], ['medium', 'Medium'], ['large', 'Large']] as const) { const o = doc.createElement('option'); o.value = v; o.textContent = l; level.appendChild(o); }
  level.value = 'medium';
  const lrow = doc.createElement('label');
  lrow.append('Level ', level);
  const pop = armedButton('Populate demo resort (cheats)', () => say(reportLines(api.populate(level.value as DemoLevel)).join('\n')), doc);

  const mix = doc.createElement('select');
  mix.setAttribute('aria-label', 'Guest mix');
  for (const m of ['mixed', 'skiers', 'hikers']) { const o = doc.createElement('option'); o.value = m; o.textContent = m; mix.appendChild(o); }
  const n = doc.createElement('input');
  n.type = 'number'; n.min = '1'; n.max = '400'; n.value = '50'; n.style.width = '56px';
  const spawn = armedButton('Spawn guests (cheats)', () => say(`Spawned ${api.spawnGuests(Math.max(1, Math.min(400, Number(n.value) || 50)), mix.value as 'mixed')} guests`), doc);
  const grow = doc.createElement('label');
  grow.append('N ', n, ' ', mix);

  const bearRow = doc.createElement('div');
  bearRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
  const fb = doc.createElement('button'); fb.textContent = 'Find bear'; fb.addEventListener('click', () => say(api.findBear()));
  const sb = doc.createElement('button'); sb.textContent = 'Spawn bear'; sb.addEventListener('click', () => say(api.spawnBear(false)));
  const sn = doc.createElement('button'); sn.textContent = 'Spawn bear near camera'; sn.addEventListener('click', () => say(api.spawnBear(true)));
  const fd = doc.createElement('button'); fd.textContent = 'Find deer'; fd.addEventListener('click', () => say(api.findAnimal('deer')));
  const fa = doc.createElement('button'); fa.textContent = 'Find animals'; fa.addEventListener('click', () => say(api.findAnimal(null)));
  bearRow.append(fb, sb, sn, fd, fa);
  const t = api.town;
  if (t) {
    const sel = doc.createElement('select');
    sel.setAttribute('aria-label', 'Town archetype');
    for (const [v, l] of [['random', 'Random nice town'], ...t.list.map((a) => [a.id, a.name] as const)] as const) { const o = doc.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
    const tag = doc.createElement('div');
    tag.style.cssText = 'font-size:10px;opacity:.8';
    const seed = doc.createElement('input');
    seed.type = 'number'; seed.min = '1'; seed.value = String(t.seed); seed.style.width = '70px'; seed.setAttribute('aria-label', 'Town seed');
    const dice = doc.createElement('button');
    dice.textContent = '🎲'; dice.title = 'Pick a vetted seed for this town on this map size'; dice.setAttribute('aria-label', 'Random seed');
    const rollSeed = (): void => {
      const id = sel.value === 'random' ? t.list[Math.floor(Math.random() * t.list.length)]!.id : sel.value;
      const q = t.quickSeeds(id);
      seed.value = String(q.length ? q[Math.floor(Math.random() * q.length)]! : 1 + Math.floor(Math.random() * 999));
    };
    dice.addEventListener('click', rollSeed);
    const sync = (): void => { tag.textContent = t.list.find((a) => a.id === sel.value)?.tagline ?? 'A random archetype with a vetted seed for this map size'; };
    sel.addEventListener('change', () => { sync(); rollSeed(); });
    sync();
    const trow = doc.createElement('label');
    trow.append('Town ', sel);
    const srow = doc.createElement('label');
    srow.append('Seed ', seed, ' ', dice);
    const build = armedButton('Build town (cheats)', () => {
      const id = sel.value === 'random' ? t.list[Math.floor(Math.random() * t.list.length)]!.id : sel.value;
      const r = t.build(id, Math.max(1, Math.floor(Number(seed.value) || 1)));
      say(townLines(r, t.list.find((a) => a.id === id)?.name).join('\n'));
    }, doc);
    const reset = armedButton('Reset map (reload)', () => t.reset(), doc);
    box.append(title, trow, tag, srow, build, reset, lrow, pop, grow, spawn, bearRow, out);
    return box;
  }
  box.append(title, lrow, pop, grow, spawn, bearRow, out);
  return box;
}
