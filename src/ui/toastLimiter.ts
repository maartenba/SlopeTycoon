import type { Severity, Tier } from './newsFormat';
import { DEFAULT_MUTED } from './newsFormat';

export interface ToastReq { key: string; text: string; severity: Severity; category?: string; /** Only critical/important tiers may toast (undefined = legacy caller, allowed). */ tier?: Tier; /** Optional button (e.g. 'Reload'); `run` is invoked on click. */ action?: { label: string; run: () => void }; /** Overrides the default ttl (e.g. sticky update toast). */ ttlMs?: number; /** Small leading icon (an `IconName`) for quiet achievement toasts. */ icon?: string }
export interface ActiveToast { key: string; text: string; severity: Severity; count: number; shownAt: number; expires: number; category?: string; icon?: string; action?: { label: string; run: () => void } }
export interface LimiterOpts { maxVisible?: number; coalesceMs?: number; ttlMs?: number; /** After a toast of a key was shown, the same key (non-critical) stays silent this long (0 = off). */ cooldownMs?: number; muted?: () => ReadonlySet<string> }
export type LimiterResult = 'shown' | 'coalesced' | 'muted' | 'dropped' | 'filtered' | 'cooldown';
const RANK: Record<Severity, number> = { info: 0, good: 1, warn: 2, bad: 3 };

/**
 * Pure toast rate limiter (time injected). Duplicate keys within `coalesceMs` merge into one toast with a count; at most `maxVisible`
 * toasts stay visible (a higher severity evicts the lowest-severity/oldest one, a lower one is dropped); muted categories never show
 * (errors are never muted).
 */
export class ToastLimiter {
  private list: ActiveToast[] = [];
  private lastShown = new Map<string, number>();
  readonly maxVisible: number; readonly coalesceMs: number; readonly ttlMs: number;
  constructor(private o: LimiterOpts = {}) { this.maxVisible = o.maxVisible ?? 4; this.coalesceMs = o.coalesceMs ?? 8000; this.ttlMs = o.ttlMs ?? 4500; }

  push(r: ToastReq, now: number): LimiterResult {
    this.expire(now);
    if (r.tier === 'info' || r.tier === 'trivial') return 'filtered';
    if (r.category && r.severity !== 'bad' && this.o.muted?.().has(r.category)) return 'muted';
    const dup = this.list.find((t) => t.key === r.key && now - t.shownAt <= this.coalesceMs);
    if (dup) { dup.count++; dup.expires = now + this.ttlMs; if (RANK[r.severity] > RANK[dup.severity]) dup.severity = r.severity; return 'coalesced'; }
    const cd = this.o.cooldownMs ?? 0, last = this.lastShown.get(r.key);
    if (cd > 0 && last !== undefined && now - last < cd && r.severity !== 'bad' && r.tier !== 'critical') return 'cooldown';
    if (this.list.length >= this.maxVisible) {
      let victim = 0;
      for (let i = 1; i < this.list.length; i++) {
        const a = this.list[i]!, b = this.list[victim]!;
        if (RANK[a.severity] < RANK[b.severity] || (RANK[a.severity] === RANK[b.severity] && a.shownAt < b.shownAt)) victim = i;
      }
      if (RANK[this.list[victim]!.severity] > RANK[r.severity]) return 'dropped';
      this.list.splice(victim, 1);
    }
    this.lastShown.set(r.key, now);
    this.list.push({ key: r.key, text: r.text, severity: r.severity, count: 1, shownAt: now, expires: now + (r.ttlMs ?? this.ttlMs), category: r.category, ...(r.icon ? { icon: r.icon } : {}), ...(r.action ? { action: r.action } : {}) });
    return 'shown';
  }
  expire(now: number): void { this.list = this.list.filter((t) => t.expires > now); }
  visible(now: number): readonly ActiveToast[] { this.expire(now); return this.list; }
}

/** Muted-category persistence (localStorage with a safe fallback). */
const MUTE_KEY = 'slopetycoon.mutedNews';
export function loadMuted(storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): Set<string> {
  try { const v = storage?.getItem(MUTE_KEY); return new Set(v ? (JSON.parse(v) as string[]) : DEFAULT_MUTED); } catch { return new Set(); }
}
export function saveMuted(m: ReadonlySet<string>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  try { storage?.setItem(MUTE_KEY, JSON.stringify([...m])); } catch { /* ignore */ }
}
