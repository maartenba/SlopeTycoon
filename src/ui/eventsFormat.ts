import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../config/balance';
import { BOOKABLE_FESTIVALS, FESTIVAL_BY_ID, type FestivalDef, type FestivalId } from '../config/festivals';
import type { EventCalendar } from '../sim/events/EventCalendar';
import type { RaceDay } from '../sim/race/RaceDay';
import type { CourseInfo } from '../sim/race/RaceCourse';
import { fmtTime } from '../sim/race/RaceCourse';
import { RACE_DAY, reasonText } from '../config/race';
import { weekdayOf } from '../sim/Clock';

import { SIM_MONTHS_SHORT, REAL_MONTHS_SHORT, SEASON_OF_REAL_MONTH, dayOfYearLabel, formatGameDate, realMonthOfDay } from '../sim/calendar';
import type { SeasonId } from '../core/events';
const MONTHS = SIM_MONTHS_SHORT;

/** Absolute day -> 'Dec 3' (the year is added when it is not `todayYear`). */
export function dayLabel(abs: number, todayYear?: number): string {
  const year = Math.floor(abs / DAYS_PER_YEAR), doy = ((abs % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const base = `${MONTHS[Math.floor(doy / DAYS_PER_MONTH)]} ${(doy % DAYS_PER_MONTH) + 1}`;
  return todayYear !== undefined && year !== todayYear ? `${base}, year ${year}` : base;
}
export const rangeLabel = (start: number, end: number, todayYear?: number): string => (end - start <= 1 ? dayLabel(start, todayYear) : `${dayLabel(start, todayYear)} – ${dayLabel(end - 1, todayYear)}`);

export interface EventsRow { id: string; name: string; icon: string; when: string; note: string; booked: boolean; start: number; cancellable: boolean; /** The running event has a stage the camera can go to. */ stage?: boolean }
export interface FestivalCard {
  def: FestivalDef;
  /** Start days offered (a few per window) with the reason each cannot be booked (null = bookable). */
  options: Array<{ start: number; label: string; blocker: string | null }>;
  /** First blocker that applies regardless of the date (level / stars / lodge / piste / cash); null = none. */
  general: string | null;
  affordable: boolean;
  /** Start window on the calendar, 'Dec 1 – Dec 9'. */
  window: string;
  /** Next possible start as a full date (`formatGameDate`), e.g. 'Sun 1 Mar · Winter · Year 1' (null = none in the next year). */
  next: string | null;
}
/** 'today' / 'tomorrow' / 'in 12 days'. */
export const countdown = (days: number): string => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
/** One month of the strip (real order January..December): season, whether today is in it and the events that start in it. */
export interface MonthStripCell { month: string; season: SeasonId; today: boolean; events: Array<{ id: FestivalId; icon: string; name: string }> }

/** Club Race card (0.8.1): one date list per race course, with the reason a date cannot be booked. */
export interface RaceDayCard {
  cost: number;
  /** Level gate etc. regardless of the date / course; null = none. */
  general: string | null;
  courses: Array<{ id: number; name: string; difficulty: number; valid: boolean; reason: string | null; sponsor: string | null; last: string | null }>;
  options: Record<number, Array<{ start: number; label: string; blocker: string | null }>>;
}
export interface RaceDayInfo { raceDay: RaceDay; courses: readonly CourseInfo[]; courseName(c: CourseInfo): string }
const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface EventsView {
  raceDayCard?: RaceDayCard;
  todayLabel: string;
  /** Persistent-style date, 'Sat 14 Feb · Winter · Year 1'. */
  todayChip: string;
  /** Twelve cells January..December with event markers (running, booked, automatic) for the next 12 months. */
  strip: MonthStripCell[];
  running: EventsRow[];
  /** Optional note row (e.g. 'Mountain buzz +10 % visitors'); the caller adds it. */
  buzz?: { text: string };
  upcoming: EventsRow[];
  cards: FestivalCard[];
  review: { score: number; when: string } | null;
  nextCritic: string | null;
}

/** Pure view model of the calendar for the Events panel. */
export function buildEventsView(cal: EventCalendar, today: number, funds: number, race?: RaceDayInfo): EventsView {
  const year = Math.floor(today / DAYS_PER_YEAR);
  const running: EventsRow[] = cal.active(today).filter((e) => e.id !== 'critic').map((e) => ({
    id: e.id, name: e.def.name, icon: e.def.icon, when: rangeLabel(e.start, e.end, year), note: e.days > 1 ? `day ${e.dayIndex + 1} of ${e.days}` : 'today', booked: !e.auto, start: e.start, cancellable: false, ...(e.def.dressing?.stage ? { stage: true } : {}),
  }));
  const upcoming: EventsRow[] = cal.upcoming().filter((u) => u.start > today).map((u) => ({
    id: u.id, name: u.def.name, icon: u.def.icon, when: rangeLabel(u.start, u.end, year), note: countdown(u.daysAway), booked: u.booked, start: u.start, cancellable: u.booked,
  }));
  let raceDayCard: RaceDayCard | undefined;
  if (race) {
    const rd = race.raceDay;
    const s = rd.session;
    if (s) running.push({ id: `raceDay:${s.course}`, name: `${s.kind === 'club' ? (s.mtb ? 'Downhill Race' : 'Club Race') : 'World Cup Race'} · ${s.name}`, icon: '🏁', when: dayLabel(s.day, year), note: `${s.field} ${s.mtb ? 'riders' : 'racers'} · ${s.spectators.length} watching · until ${RACE_DAY.to}:00`, booked: s.kind === 'club', start: s.day, cancellable: false });
    for (const b of rd.bookings) { const c = race.courses.find((x) => x.id === b.course); upcoming.push({ id: `raceDay:${b.course}`, name: `${c?.mtb ? 'Downhill Race' : 'Club Race'}${c ? ` · ${race.courseName(c)}` : ''}`, icon: '🏁', when: dayLabel(b.day, year), note: countdown(b.day - today), booked: true, start: b.day, cancellable: b.day > today }); }
    upcoming.sort((a, b) => a.start - b.start);
    const marked = race.courses;
    const options: RaceDayCard['options'] = {};
    for (const c of marked) {
      const o: Array<{ start: number; label: string; blocker: string | null }> = [];
      for (let k = RACE_DAY.leadDays; k < 60 && o.length < 12; k++) { const d = today + k, wd = weekdayOf({ year: 0, day: d }); if (!RACE_DAY.weekdays.includes(wd)) continue; { const bl = rd.blocker(c.id, d); if (bl === 'Only in winter' || bl === 'Only in summer') continue; } o.push({ start: d, label: `${WEEKDAY[wd]} ${dayLabel(d, year)}`, blocker: rd.blocker(c.id, d) }); }
      options[c.id] = o;
    }
    raceDayCard = {
      cost: RACE_DAY.cost, general: marked.length ? rd.requirement() : 'Mark a run as a race course first (Operations > Runs)',
      courses: marked.map((c) => { const r = rd.lastResult(c.id), sp = rd.sponsorOf(c.id); return { id: c.id, name: race.courseName(c), difficulty: c.run.difficulty, valid: c.valid, reason: c.reason ? reasonText(c.reason, c.mtb) : null, sponsor: sp?.name ?? null, last: r ? `${r.winner} ${fmtTime(r.winnerMs)}` : null }; }),
      options,
    };
  }
  const cards = BOOKABLE_FESTIVALS.map((def): FestivalCard => {
    const opts = cal.startOptions(def.id, Math.max(1, Math.floor(def.days / 2)));
    const options = opts.slice(0, 40).map((start) => ({ start, label: dayLabel(start, year), blocker: cal.blocker(def.id, start) }));
    const bookable = options.find((o) => !o.blocker);
    const first = options[0];
    const general = cal.requirement(def.id) ?? (bookable || !first ? null : first.blocker);
    const w = def.startWindow;
    const nx = (bookable ?? first)?.start;
    return { def, options, general, affordable: funds >= def.cost, window: w ? `${dayOfYearLabel(w[0])} – ${dayOfYearLabel(w[1])}` : '', next: nx === undefined ? null : formatGameDate({ year: Math.floor(nx / DAYS_PER_YEAR), day: ((nx % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR }).chip };
  });
  const date = { year, day: ((today % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR };
  const f = formatGameDate(date);
  const strip: MonthStripCell[] = REAL_MONTHS_SHORT.map((month, m) => ({ month, season: SEASON_OF_REAL_MONTH[m]!, today: realMonthOfDay(date.day) === m, events: [] }));
  const mark = (id: FestivalId, def: FestivalDef, start: number): void => { const c = strip[realMonthOfDay(((start % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR)]!; if (!c.events.some((e) => e.id === id)) c.events.push({ id, icon: def.icon, name: def.name }); };
  for (const e of cal.active(today)) if (e.id !== 'critic') mark(e.id, e.def, today);
  for (const u of cal.upcoming(DAYS_PER_YEAR)) if (u.id !== 'critic') mark(u.id, u.def, u.start);
  return {
    ...(raceDayCard ? { raceDayCard } : {}),
    todayLabel: f.chip, todayChip: f.chip, strip, running, upcoming, cards,
    review: cal.lastReview ? { score: cal.lastReview.score, when: dayLabel(cal.lastReview.day, year) } : null,
    nextCritic: null,
  };
}

export { FESTIVAL_BY_ID };
