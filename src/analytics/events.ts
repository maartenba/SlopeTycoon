/**
 * Typed analytics events + the parameter whitelist (docs/analytics.md). Only the events and parameters listed here can ever leave the page:
 * no free text, no save contents, no names, no seeds, no coordinates, no precise money. Strings must look like ids (short, [a-z0-9_.:-]).
 */
export type ParamSpec =
  | { t: 'enum'; values: readonly string[]; req?: boolean }
  | { t: 'id'; req?: boolean }
  | { t: 'num'; min: number; max: number; req?: boolean };

const yn = ['yes', 'no'] as const;
export const EVENT_SPECS = {
  app_start: { version: { t: 'id', req: true }, page: { t: 'enum', values: ['menu', 'game'], req: true }, display: { t: 'enum', values: ['standalone', 'browser'] }, touch: { t: 'enum', values: yn }, viewport: { t: 'enum', values: ['phone', 'tablet', 'desktop'] } },
  game_start: { mode: { t: 'enum', values: ['career', 'sandbox'] }, size: { t: 'num', min: 0, max: 512 }, scenario: { t: 'id' }, difficulty: { t: 'id' }, season: { t: 'enum', values: ['spring', 'summer', 'autumn', 'winter'] }, tutorial: { t: 'enum', values: yn } },
  game_load: { mode: { t: 'enum', values: ['career', 'sandbox'] }, size: { t: 'num', min: 0, max: 512 } },
  level_up: { level: { t: 'num', min: 0, max: 50, req: true } },
  goal_done: { id: { t: 'id', req: true } },
  scenario_result: { id: { t: 'id', req: true }, result: { t: 'enum', values: ['won', 'lost'], req: true }, medal: { t: 'enum', values: ['none', 'bronze', 'silver', 'gold'] } },
  year_end: { year: { t: 'num', min: 0, max: 60, req: true }, stars: { t: 'num', min: 0, max: 5 }, profit: { t: 'enum', values: ['loss', 'small', 'medium', 'large'] } },
  achievement: { id: { t: 'id', req: true } },
  festival_booked: { id: { t: 'id', req: true } },
  staff_upgrade: { id: { t: 'id', req: true } },
  view_mode_used: { mode: { t: 'enum', values: ['ride', 'walk', 'photo'], req: true } },
  feature_first_use: { feature: { t: 'enum', values: ['stats', 'touch', 'landscape', 'trophies'], req: true } },
  error: { kind: { t: 'enum', values: ['error', 'unhandledrejection'], req: true } },
  engaged: { minutes: { t: 'num', min: 0, max: 600, req: true } },
} as const satisfies Record<string, Record<string, ParamSpec>>;

export type AnalyticsEventName = keyof typeof EVENT_SPECS;
export type AnalyticsParams = Record<string, string | number>;
export const EVENT_NAMES = Object.keys(EVENT_SPECS) as AnalyticsEventName[];

/** Per-event caps per session (default 40), on top of the global cap. */
export const EVENT_CAPS: Partial<Record<AnalyticsEventName, number>> = { error: 5, view_mode_used: 3, feature_first_use: 6, engaged: 24, app_start: 3, game_start: 5, game_load: 5, year_end: 20, level_up: 20 };
export const DEFAULT_EVENT_CAP = 40;

const ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,39}$/i;

/** Returns only whitelisted, well-formed parameters, or null when the event is unknown or a required parameter is missing / invalid. */
export function sanitizeEvent(name: string, params: Record<string, unknown> = {}): { name: AnalyticsEventName; params: AnalyticsParams } | null {
  if (!Object.prototype.hasOwnProperty.call(EVENT_SPECS, name)) return null;
  const spec = EVENT_SPECS[name as AnalyticsEventName] as Record<string, ParamSpec>;
  const out: AnalyticsParams = {};
  for (const [k, s] of Object.entries(spec)) {
    const v = params[k];
    let ok: string | number | null = null;
    if (s.t === 'num') { if (typeof v === 'number' && Number.isFinite(v)) ok = Math.min(s.max, Math.max(s.min, Math.round(v))); }
    else if (s.t === 'enum') { if (typeof v === 'string' && s.values.includes(v)) ok = v; }
    else if (typeof v === 'string' && ID_RE.test(v)) ok = v.toLowerCase();
    if (ok === null) { if (s.req) return null; continue; }
    out[k] = ok;
  }
  return { name: name as AnalyticsEventName, params: out };
}
