import type { GameBus } from '../core/events';
import type { Analytics } from './Analytics';

type Tracker = Pick<Analytics, 'track'>;
export type ProfitBucket = 'loss' | 'small' | 'medium' | 'large';
export const profitBucket = (net: number): ProfitBucket => (net < 0 ? 'loss' : net < 50_000 ? 'small' : net < 500_000 ? 'medium' : 'large');

export interface GameplayOptions {
  /** Current resort rating in stars (read at year end). */
  stars?: () => number;
}
/**
 * The single gameplay subscriber. OBSERVER ONLY: it reads typed bus events and calls `analytics.track`; it never writes sim state, never uses the
 * sim Rng, keeps nothing that is saved, so `stateHash` is identical with and without it (tests/analytics/gameplay.test.ts). Returns an unsubscribe.
 */
export function attachGameplayAnalytics(bus: GameBus, a: Tracker, o: GameplayOptions = {}): () => void {
  const off: Array<() => void> = [];
  const netByYear = new Map<number, number>();
  off.push(bus.on('milestone', (e) => {
    const m = /^(level|goal):(.+)$/.exec(e.id);
    if (!m) return;
    if (m[1] === 'level') { const level = Number(m[2]); if (Number.isFinite(level)) a.track('level_up', { level }); } else a.track('goal_done', { id: m[2] });
  }));
  off.push(bus.on('scenario:finished', (e) => { a.track('scenario_result', { id: e.id, result: e.result, medal: e.medal }); }));
  off.push(bus.on('finance:monthClosed', (e) => { netByYear.set(e.year, (netByYear.get(e.year) ?? 0) + e.net); }));
  off.push(bus.on('year:report', (e) => {
    const net = netByYear.get(e.year);
    a.track('year_end', { year: e.year, ...(o.stars ? { stars: Math.floor(o.stars()) } : {}), ...(net !== undefined ? { profit: profitBucket(net) } : {}) });
    netByYear.delete(e.year);
  }));
  return () => { for (const f of off) f(); };
}

/** Once-per-session guard for first-use style events. */
export function onceTracker(a: Tracker): (name: 'view_mode_used' | 'feature_first_use', params: Record<string, string>) => boolean {
  const seen = new Set<string>();
  return (name, params) => {
    const key = `${name}:${Object.values(params).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return a.track(name, params);
  };
}

export interface HeartbeatEnv { visible(): boolean; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }
/** Engaged-time heartbeat: counts 1-minute ticks while the tab is visible; emits `engaged` every 5 engaged minutes (max one per 5 min). Returns a stop function. */
export function startHeartbeat(a: Tracker, env: HeartbeatEnv): () => void {
  let visibleMinutes = 0;
  const h = env.setInterval(() => {
    if (!env.visible()) return;
    visibleMinutes++;
    if (visibleMinutes % 5 === 0) a.track('engaged', { minutes: visibleMinutes });
  }, 60_000);
  return () => env.clearInterval(h);
}

export interface PageFacts { version: string; page: 'menu' | 'game'; standalone: boolean; touch: boolean; width: number }
export const viewportClass = (w: number): 'phone' | 'tablet' | 'desktop' => (w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'desktop');
export function appStartParams(f: PageFacts): Record<string, string> {
  return { version: f.version, page: f.page, display: f.standalone ? 'standalone' : 'browser', touch: f.touch ? 'yes' : 'no', viewport: viewportClass(f.width) };
}
