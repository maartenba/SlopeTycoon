/** "What's new" data + pure logic for the update card and the after-reload card (docs/pwa.md "Update card"). The list itself is generated from CHANGELOG.md. */
import { WHATS_NEW } from './whatsNew.generated';

export interface WhatsNewEntry { version: string; date: string; highlights: string[] }
export { WHATS_NEW };
export const SEEN_VERSION_KEY = 'slope.seenVersion';
export const UPDATE_REMIND_KEY = 'slope.updateRemindAt';
export const UPDATE_REMIND_MS = 60 * 60 * 1000;
export const WHATS_NEW_URL = './whats-new.json';

/** Numeric x.y.z -> tuple; null for anything else ('dev'). */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** <0, 0, >0; unparsable versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
/** Entries newer than `from` (running version) and not newer than `to` (when given), newest first. */
export function entriesBetween(entries: readonly WhatsNewEntry[], from: string, to?: string): WhatsNewEntry[] {
  return entries.filter((e) => compareVersions(e.version, from) > 0 && (!to || compareVersions(e.version, to) <= 0)).sort((a, b) => compareVersions(b.version, a.version));
}
export interface UpdateCardModel { title: string; version: string | null; sections: WhatsNewEntry[]; fallback: boolean }
/** What the update card says. `fetched` = entries from the NEW build's whats-new.json (null when offline / failed). */
export function buildUpdateCard(running: string, fetched: readonly WhatsNewEntry[] | null): UpdateCardModel {
  if (!fetched || !fetched.length) return { title: 'A new version is ready', version: null, sections: [], fallback: true };
  const newest = [...fetched].sort((a, b) => compareVersions(b.version, a.version))[0]!;
  const sections = entriesBetween(fetched, running, newest.version);
  if (compareVersions(newest.version, running) <= 0 || !sections.length) return { title: 'A new version is ready', version: null, sections: [], fallback: true };
  return { title: `A new version is available: ${newest.version}`, version: newest.version, sections, fallback: false };
}
/** "Later" reminder throttle: at most one card per hour (stored timestamp survives sessions). */
export function updateReminderDue(lastShownMs: number | null, nowMs: number, gapMs = UPDATE_REMIND_MS): boolean {
  return lastShownMs === null || !Number.isFinite(lastShownMs) || nowMs - lastShownMs >= gapMs || nowMs < lastShownMs;
}
/** Validate the JSON from the network (never trust it): only plain strings, bounded sizes. */
export function parseWhatsNewJson(data: unknown): WhatsNewEntry[] | null {
  const list = (data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) return null;
  const out: WhatsNewEntry[] = [];
  for (const e of list.slice(0, 10)) {
    const o = e as Partial<WhatsNewEntry> | null;
    if (!o || typeof o.version !== 'string' || !parseVersion(o.version) || !Array.isArray(o.highlights)) continue;
    out.push({ version: o.version, date: typeof o.date === 'string' ? o.date.slice(0, 10) : '', highlights: o.highlights.filter((h): h is string => typeof h === 'string').slice(0, 6).map((h) => h.slice(0, 200)) });
  }
  return out.length ? out : null;
}
export interface FetchEnv { online: boolean; fetch(url: string, init: { cache: 'no-store' }): Promise<{ ok: boolean; json(): Promise<unknown> }> }
/** Same-origin, cache-busted fetch of the new build's highlights; null on offline / any failure. */
export async function fetchWhatsNew(env: FetchEnv, url = WHATS_NEW_URL): Promise<WhatsNewEntry[] | null> {
  if (!env.online) return null;
  try { const r = await env.fetch(url, { cache: 'no-store' }); return r.ok ? parseWhatsNewJson(await r.json()) : null; } catch { return null; }
}
/** After-reload card decision. First ever launch (nothing stored) only records the version; no card for new players. */
export function whatsNewOnLaunch(seen: string | null, current: string, entries: readonly WhatsNewEntry[] = WHATS_NEW): { show: WhatsNewEntry[]; store: string | null } {
  if (!parseVersion(current)) return { show: [], store: null };
  if (seen === null) return { show: [], store: current };
  if (compareVersions(current, seen) <= 0) return { show: [], store: null };
  const show = entriesBetween(entries, seen, current);
  return { show, store: current };
}
