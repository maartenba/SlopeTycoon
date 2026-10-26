import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../config/balance';
import { BOOKABLE_FESTIVALS, FESTIVAL_BY_ID, type FestivalDef, type FestivalId } from '../config/festivals';
import type { EventCalendar } from '../sim/events/EventCalendar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Absolute day -> 'Dec 3' (the year is added when it is not `todayYear`). */
export function dayLabel(abs: number, todayYear?: number): string {
  const year = Math.floor(abs / DAYS_PER_YEAR), doy = ((abs % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const base = `${MONTHS[Math.floor(doy / DAYS_PER_MONTH)]} ${(doy % DAYS_PER_MONTH) + 1}`;
  return todayYear !== undefined && year !== todayYear ? `${base}, year ${year + 1}` : base;
}
export const rangeLabel = (start: number, end: number, todayYear?: number): string => (end - start <= 1 ? dayLabel(start, todayYear) : `${dayLabel(start, todayYear)} – ${dayLabel(end - 1, todayYear)}`);

export interface EventsRow { id: FestivalId; name: string; icon: string; when: string; note: string; booked: boolean; start: number; cancellable: boolean }
export interface FestivalCard {
  def: FestivalDef;
  /** Start days offered (a few per window) with the reason each cannot be booked (null = bookable). */
  options: Array<{ start: number; label: string; blocker: string | null }>;
  /** First blocker that applies regardless of the date (level / stars / lodge / piste / cash); null = none. */
  general: string | null;
  affordable: boolean;
}
export interface EventsView {
  todayLabel: string;
  running: EventsRow[];
  upcoming: EventsRow[];
  cards: FestivalCard[];
  review: { score: number; when: string } | null;
  nextCritic: string | null;
}

/** Pure view model of the calendar for the Events panel. */
export function buildEventsView(cal: EventCalendar, today: number, funds: number): EventsView {
  const year = Math.floor(today / DAYS_PER_YEAR);
  const running: EventsRow[] = cal.active(today).filter((e) => e.id !== 'critic').map((e) => ({
    id: e.id, name: e.def.name, icon: e.def.icon, when: rangeLabel(e.start, e.end, year), note: e.days > 1 ? `day ${e.dayIndex + 1} of ${e.days}` : 'today', booked: !e.auto, start: e.start, cancellable: false,
  }));
  const upcoming: EventsRow[] = cal.upcoming().filter((u) => u.start > today).map((u) => ({
    id: u.id, name: u.def.name, icon: u.def.icon, when: rangeLabel(u.start, u.end, year), note: u.id === 'critic' ? `in ${u.daysAway} days` : `in ${u.daysAway} days`, booked: u.booked, start: u.start, cancellable: u.booked,
  }));
  const cards = BOOKABLE_FESTIVALS.map((def): FestivalCard => {
    const opts = cal.startOptions(def.id, Math.max(1, Math.floor(def.days / 2)));
    const options = opts.slice(0, 40).map((start) => ({ start, label: dayLabel(start, year), blocker: cal.blocker(def.id, start) }));
    const bookable = options.find((o) => !o.blocker);
    const first = options[0];
    const general = cal.requirement(def.id) ?? (bookable || !first ? null : first.blocker);
    return { def, options, general, affordable: funds >= def.cost };
  });
  return {
    todayLabel: dayLabel(today, year), running, upcoming, cards,
    review: cal.lastReview ? { score: cal.lastReview.score, when: dayLabel(cal.lastReview.day, year) } : null,
    nextCritic: null,
  };
}

export { FESTIVAL_BY_ID };
