/**
 * Per-run player settings (docs/runs.md), keyed by the PERSISTENT run id (`Names.pisteId`): manual open / close and the grooming priority.
 * Weekly traffic history lives next to it but is saved in an observer module (`runStats`): it never feeds back into the simulation.
 */
export type GroomMode = 'auto' | 'first' | 'skip';
export const GROOM_MODES: readonly GroomMode[] = ['auto', 'first', 'skip'];
export const GROOM_MODE_LABEL: Record<GroomMode, string> = { auto: 'Auto', first: 'Groom first', skip: 'Do not groom' };

export interface RunSettingsData { closed: number[]; groom: Array<[number, GroomMode]> }

export class RunSettings {
  private closedSet = new Set<number>();
  private groomMap = new Map<number, GroomMode>();
  /** Bumps on every change (caches). */
  version = 0;
  /** Daily peak passes of the last 7 days per run id (oldest first). Observer-only. */
  private history = new Map<number, number[]>();
  private todayPeak = new Map<number, number>();
  private lastGroomed = new Map<number, number>();
  noteGroomed(id: number, absDay: number): void { this.lastGroomed.set(id, absDay); }
  /** Absolute day a snowcat last groomed any tile of the run (undefined: never). */
  lastGroomedDay(id: number): number | undefined { return this.lastGroomed.get(id); }

  isClosed(id: number): boolean { return this.closedSet.has(id); }
  setClosed(id: number, closed: boolean): boolean {
    if (closed === this.closedSet.has(id)) return false;
    if (closed) this.closedSet.add(id); else this.closedSet.delete(id);
    this.version++;
    return true;
  }
  groomMode(id: number): GroomMode { return this.groomMap.get(id) ?? 'auto'; }
  setGroomMode(id: number, m: GroomMode): boolean {
    if (m === this.groomMode(id)) return false;
    if (m === 'auto') this.groomMap.delete(id); else this.groomMap.set(id, m);
    this.version++;
    return true;
  }
  /** Forget settings of runs that no longer exist. Returns true when something was dropped. */
  prune(live: ReadonlySet<number>): boolean {
    let changed = false;
    for (const id of [...this.closedSet]) if (!live.has(id)) { this.closedSet.delete(id); changed = true; }
    for (const id of [...this.groomMap.keys()]) if (!live.has(id)) { this.groomMap.delete(id); changed = true; }
    for (const id of [...this.history.keys()]) if (!live.has(id)) this.history.delete(id);
    for (const id of [...this.lastGroomed.keys()]) if (!live.has(id)) this.lastGroomed.delete(id);
    if (changed) this.version++;
    return changed;
  }

  /** Record today's running peak for a run (call as often as you like; the day's value is the maximum). */
  notePasses(id: number, passes: number): void { if (passes > (this.todayPeak.get(id) ?? 0)) this.todayPeak.set(id, passes); }
  /** Day boundary: push today's peak into the 7-day ring. */
  rollDay(live: Iterable<number>): void {
    for (const id of live) {
      const h = this.history.get(id) ?? [];
      h.push(this.todayPeak.get(id) ?? 0);
      while (h.length > 7) h.shift();
      this.history.set(id, h);
    }
    this.todayPeak.clear();
  }
  /** Passes over the last 7 completed days (sum of daily peaks). */
  passesWeek(id: number): number { let s = 0; for (const v of this.history.get(id) ?? []) s += v; return s; }

  serialize(): RunSettingsData { return { closed: [...this.closedSet].sort((a, b) => a - b), groom: [...this.groomMap].sort((a, b) => a[0] - b[0]) }; }
  load(d: Partial<RunSettingsData> | undefined): void {
    this.closedSet = new Set(d?.closed ?? []);
    this.groomMap = new Map((d?.groom ?? []).filter(([, m]) => GROOM_MODES.includes(m)));
    this.version++;
  }
  serializeStats(): { history: Array<[number, number[]]>; today: Array<[number, number]>; groomed: Array<[number, number]> } { return { history: [...this.history].sort((a, b) => a[0] - b[0]), today: [...this.todayPeak].sort((a, b) => a[0] - b[0]), groomed: [...this.lastGroomed].sort((a, b) => a[0] - b[0]) }; }
  loadStats(d: { history?: Array<[number, number[]]>; today?: Array<[number, number]>; groomed?: Array<[number, number]> } | undefined): void {
    this.history = new Map(d?.history ?? []); this.todayPeak = new Map(d?.today ?? []); this.lastGroomed = new Map(d?.groomed ?? []);
  }
  reset(): void { this.load(undefined); this.loadStats(undefined); }
}
