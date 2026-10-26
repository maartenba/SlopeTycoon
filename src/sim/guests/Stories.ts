import { Rng } from '../../core/Rng';
import type { GameBus } from '../../core/events';
import { FIRST_NAMES, STORY, TOWNS, WISHES, WISH_BY_KIND, type WishDef, type WishKind, type WishNeed } from '../../config/storyWishes';
import { Act, FOOD } from './Decision';
import { GState, GuestType, Skill, type GuestStore } from './Guest';

/**
 * Story guests (M5.4 Task 22, docs/stories.md). About 1.5% of arrivals get a name and ONE wish. The module only OBSERVES the guest store: it never
 * steers a guest. A wish resolves from what the guest does anyway (runs, deepest piste, venues visited, lesson, excursion, queue waits, mood on the
 * way home) and the resort can only influence it by being good. Success: a small capped tip (`other` income) + a tiny mood lift + a plain news line.
 * Failure: a mild 2-3 star review and a plain news line. Own RNG stream (seed ^ 0x5707), so the sim's rng, and with it every other module, is untouched.
 * Off by default (`enabled`): headless sims / tests that do not opt in keep their old numbers; the game (main.ts) turns it on.
 */
export interface Story {
  id: number; name: string; kind: WishKind; n: number; day: number;
  runs: number; runMax: number; queueMax: number; visited: string[]; lesson: boolean; excursion: boolean;
  /** Building type the guest was last heading to + the visit counter seen last poll. */
  head: string; lastVisits: number;
  x: number; y: number; happiness: number; leaving: boolean;
}
export interface StoryLogEntry { name: string; kind: WishKind; ok: boolean; day: number; tip: number }

export interface StoryDeps {
  store: GuestStore; bus: GameBus; seed: number;
  today(): number;
  /** The resort can currently offer this (black piste, a meal venue, an après bar, a ski school, trails). */
  has(need: WishNeed): boolean;
  buildingType(id: number): string | null;
  isKid(slot: number): boolean;
  /** Pay the success tip (dollars) into the books. */
  tip(amount: number): void;
}

/** What the pure wish check sees. */
export interface WishObs {
  runs: number; runMax: number; queueMax: number; visited: readonly string[]; lesson: boolean; excursion: boolean; happiness: number; leaving: boolean;
}
export type WishState = 'pending' | 'win' | 'lose';

const BLACK = 3; // raw Networks difficulty (0 green .. 3 black), as stored in `store.runMax`

/** Pure: does the observed day satisfy the wish? `n` = run target for the counter wishes. */
export function checkWish(kind: WishKind, n: number, o: WishObs): WishState {
  switch (kind) {
    case 'runs': return o.runs >= n ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'black': return o.runMax >= BLACK ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'meal': return o.visited.some((t) => FOOD.has(t)) ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'apres': return o.visited.includes('apresBar') ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'lesson': return o.lesson ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'excursion': return o.excursion ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'shortQueue': return o.queueMax > STORY.queueLimitMin ? 'lose' : o.runs >= n ? 'win' : o.leaving ? 'lose' : 'pending';
    case 'happyDay': return o.leaving ? (o.happiness >= STORY.happyAtLeast ? 'win' : 'lose') : 'pending';
  }
}

const fill = (t: string, name: string, n: number): string => t.replace(/\{name\}/g, name).replace(/\{n\}/g, String(n));
const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class Stories {
  enabled = false;
  active: Story[] = [];
  pinned = 0;
  granted = 0; failed = 0;
  log: StoryLogEntry[] = [];
  private tipDay = -1; private tipToday = 0;
  private nextId = 1;
  private rng: Rng;

  constructor(private d: StoryDeps) { this.rng = new Rng((d.seed ^ 0x5707) >>> 0); }

  /** Called on every arrival (bus `guest:arrived`). */
  onArrived(guestId: number): void {
    if (!this.enabled) return;
    const roll = this.rng.next();
    if (roll >= STORY.rate || this.active.length >= STORY.maxActive) return;
    const s = this.d.store, slot = s.slotOf(guestId);
    if (slot < 0) return;
    const kid = this.d.isKid(slot);
    const pool = WISHES.filter((w) => (!w.needs || this.d.has(w.needs)) && (w.kind !== 'lesson' || kid) && (w.kind !== 'black' || (s.skill[slot]! >= Skill.Advanced && !kid)) && !(kid && (w.kind === 'apres' || w.kind === 'excursion')) && !(w.kind === 'apres' && s.type[slot] === GuestType.Family));
    // Draws are taken in a fixed order whether or not a wish is found, so the stream stays predictable.
    const pick = this.rng.next(), nameRoll = this.rng.next(), townRoll = this.rng.next(), nRoll = this.rng.next();
    if (!pool.length) return;
    let total = 0; for (const w of pool) total += w.weight;
    let at = pick * total, def: WishDef = pool[pool.length - 1]!;
    for (const w of pool) { at -= w.weight; if (at < 0) { def = w; break; } }
    const n = def.kind === 'runs' ? (s.skill[slot]! <= Skill.Beginner ? 3 : 4 + Math.floor(nRoll * 3)) : def.kind === 'shortQueue' ? STORY.queueRuns : 0;
    const name = `${FIRST_NAMES[Math.floor(nameRoll * FIRST_NAMES.length)]!} from ${TOWNS[Math.floor(townRoll * TOWNS.length)]!}`;
    this.active.push({
      id: guestId, name, kind: def.kind, n, day: this.d.today(), runs: 0, runMax: 0, queueMax: 0, visited: [], lesson: false, excursion: false,
      head: '', lastVisits: s.visits[slot]!, x: s.x[slot]!, y: s.y[slot]!, happiness: s.happiness[slot]!, leaving: false,
    });
    this.nextId++;
  }

  /** Poll the active story guests (call once per sim tick, after the guests moved). */
  update(tick: number): void {
    if (!this.active.length) return;
    const s = this.d.store;
    for (const st of this.active.slice()) {
      const i = s.slotOf(st.id);
      if (i < 0 || !s.alive[i]) { this.finish(st, this.verdict(st, true), null); continue; }
      st.x = s.x[i]!; st.y = s.y[i]!; st.happiness = s.happiness[i]!; st.runs = s.runs[i]!; st.runMax = Math.max(st.runMax, s.runMax[i]!);
      const state = s.state[i]!;
      if (state === GState.Queueing) st.queueMax = Math.max(st.queueMax, (tick - s.actTick[i]!) * 0.25);
      if (s.act[i] === Act.Excursion) st.excursion = true;
      if (s.act[i] === Act.ToBuilding && s.target[i]! > 0) st.head = this.d.buildingType(s.target[i]!) ?? '';
      if (state === GState.Using && s.target[i]! > 0) { const t = this.d.buildingType(s.target[i]!); if (t && !st.visited.includes(t)) st.visited.push(t); }
      if (s.visits[i]! !== st.lastVisits) { if (st.head && !st.visited.includes(st.head)) st.visited.push(st.head); st.lastVisits = s.visits[i]!; }
      if (s.act[i] !== Act.ToBuilding && state !== GState.Using) st.head = '';
      st.leaving = state === GState.Leaving;
      const v = checkWish(st.kind, st.n, st);
      if (v !== 'pending') this.finish(st, v, i);
    }
  }

  /** `lesson:started` payload kids. */
  onLesson(kids: readonly number[]): void { for (const st of this.active) if (st.kind === 'lesson' && kids.includes(st.id)) st.lesson = true; }

  /** `guest:left`: a story that is still open is judged on what the guest had done. */
  onLeft(guestId: number): void {
    const st = this.active.find((x) => x.id === guestId);
    if (st) this.finish(st, this.verdict(st, true), null);
  }

  private verdict(st: Story, leaving: boolean): 'win' | 'lose' {
    const v = checkWish(st.kind, st.n, { ...st, leaving });
    return v === 'win' ? 'win' : 'lose';
  }

  private finish(st: Story, v: WishState, slot: number | null): void {
    const k = this.active.indexOf(st);
    if (k < 0 || v === 'pending') return;
    this.active.splice(k, 1);
    if (this.pinned === st.id) this.pinned = 0;
    const def = WISH_BY_KIND[st.kind], ok = v === 'win', day = this.d.today();
    let tip = 0;
    if (ok) {
      if (this.tipDay !== day) { this.tipDay = day; this.tipToday = 0; }
      tip = Math.max(0, Math.min(def.tip, STORY.tipCapPerDay - this.tipToday));
      this.tipToday += tip;
      if (tip > 0) this.d.tip(tip);
      this.granted++;
      if (slot !== null) this.d.store.happiness[slot] = Math.min(1, this.d.store.happiness[slot]! + STORY.happyLift);
    } else this.failed++;
    const pickFrom = (a: readonly string[]): string => a[Math.floor(this.rng.next() * a.length)] ?? '';
    const light = ok && this.rng.next() < STORY.lightShare;
    const text = sentence(fill(ok ? pickFrom(light ? def.win.light : def.win.plain) : pickFrom(def.lose), st.name, st.n));
    this.log.push({ name: st.name, kind: st.kind, ok, day, tip });
    if (this.log.length > STORY.logMax) this.log.shift();
    this.d.bus.emit('story:resolved', { guestId: st.id, name: st.name, wish: st.kind, outcome: ok ? 'granted' : 'failed', text, tone: light ? 'light' : 'plain', tip, x: st.x, y: st.y });
    if (!ok) {
      const rv = sentence(fill(pickFrom(def.review), st.name, st.n));
      this.d.bus.emit('guest:review', { guestId: st.id, stars: st.happiness >= 0.5 ? 3 : 2, text: rv, tone: 'plain', driver: 'general', x: st.x, y: st.y });
    }
  }

  /** Inspector data for a guest (null = not a story guest). */
  info(guestId: number): { name: string; goal: string; progress: string | null; pinned: boolean } | null {
    const st = this.active.find((x) => x.id === guestId);
    if (!st) return null;
    const def = WISH_BY_KIND[st.kind];
    const progress = def.counter ? def.counter.replace('{p}', String(Math.min(st.runs, st.n))).replace(/\{n\}/g, String(st.n)) : null;
    return { name: st.name, goal: `Wants to ${fill(def.goal, st.name, st.n)}`, progress, pinned: this.pinned === st.id };
  }
  isStory(guestId: number): boolean { return this.active.some((x) => x.id === guestId); }
  pin(guestId: number): void { this.pinned = guestId === 0 || this.isStory(guestId) ? guestId : this.pinned; }

  reset(): void { this.active = []; this.pinned = 0; this.granted = 0; this.failed = 0; this.log = []; this.tipDay = -1; this.tipToday = 0; this.nextId = 1; this.rng = new Rng((this.d.seed ^ 0x5707) >>> 0); }
  serialize(): unknown {
    return { rng: this.rng.getState(), active: this.active.map((s) => ({ ...s, visited: [...s.visited] })), pinned: this.pinned, granted: this.granted, failed: this.failed, log: this.log.map((l) => ({ ...l })), tipDay: this.tipDay, tipToday: this.tipToday, nextId: this.nextId };
  }
  load(data: unknown): void {
    const d = data as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    this.reset();
    if (!d) return;
    this.rng.setState(d.rng);
    this.active = (d.active ?? []).map((s: Story) => ({ ...s, visited: [...(s.visited ?? [])] }));
    this.pinned = d.pinned ?? 0; this.granted = d.granted ?? 0; this.failed = d.failed ?? 0; this.log = d.log ?? []; this.tipDay = d.tipDay ?? -1; this.tipToday = d.tipToday ?? 0; this.nextId = d.nextId ?? 1;
  }
}
