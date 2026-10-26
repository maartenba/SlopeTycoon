/**
 * Story guests (M5.4 Task 22): wish definitions, names and the resolution wording. Data only (no sim imports).
 * A story guest is an ordinary guest with a name and ONE wish. The sim never steers them: a wish is picked from what the resort can currently offer,
 * and resolves from what the guest does anyway. Voice: plain, short, past tense. About one in eight success lines has a light touch; failures never do.
 */
export type WishKind = 'runs' | 'black' | 'meal' | 'apres' | 'lesson' | 'excursion' | 'shortQueue' | 'happyDay';
/** What the resort must have for a wish to be offered ('' = nothing). */
export type WishNeed = 'black' | 'meal' | 'apres' | 'school' | 'trail';

export interface WishDef {
  kind: WishKind;
  /** Relative pick weight. */
  weight: number;
  needs?: WishNeed;
  /** Success tip in dollars (further capped per day by STORY.tipCapPerDay). */
  tip: number;
  /** Inspector line: "Wants to {goal}". `{n}` is filled from the story. */
  goal: string;
  /** Progress label, e.g. "3 / 5 runs"; null = no counter. */
  counter: string | null;
  /** Resolution wording. `{name}`, `{n}`. */
  win: { plain: readonly string[]; light: readonly string[] };
  lose: readonly string[];
  /** Review text of the mild review left on failure (3 stars when the guest was content, else 2). */
  review: readonly string[];
}

export const STORY = {
  /** Share of arrivals that become a story guest, and the most that can be active at once. */
  rate: 0.015, maxActive: 8,
  /** Probability that a success line is a light one. */
  lightShare: 0.125,
  /** Daily cap on tips (all stories together) and the happiness lift for the guest on success. */
  tipCapPerDay: 150, happyLift: 0.08,
  /** shortQueue fails when a queue wait is longer than this (minutes) and needs this many runs. */
  queueLimitMin: 6, queueRuns: 3,
  /** happyDay: happiness needed when the guest heads home. */
  happyAtLeast: 0.7,
  /** Resolved stories kept for the log. */
  logMax: 12,
} as const;

export const WISHES: readonly WishDef[] = [
  {
    kind: 'runs', weight: 3, tip: 40, goal: 'ski {n} runs', counter: '{p} / {n} runs',
    win: { plain: ['{name} skied {n} runs today.', '{name} got in {n} runs and went home pleased.'], light: ['{name} skied {n} runs and is already planning the next {n}.'] },
    lose: ['{name} left after only a few runs.', '{name} went home before reaching {n} runs.'],
    review: ['Hoped for {n} runs, did not get there.', 'Fewer runs than hoped for.'],
  },
  {
    kind: 'black', weight: 2, needs: 'black', tip: 80, goal: 'ski a black run', counter: null,
    win: { plain: ['{name} skied a black run.', '{name} tackled a black run and made it down.'], light: ['{name} skied a black run. The knees will have an opinion tomorrow.'] },
    lose: ['{name} left without trying a black run.', '{name} never got to a black run.'],
    review: ['Wanted a black run, never got to one.', 'Did not manage a black run.'],
  },
  {
    kind: 'meal', weight: 2, needs: 'meal', tip: 30, goal: 'have a proper meal', counter: null,
    win: { plain: ['{name} had a proper meal on the mountain.', '{name} stopped for lunch and was glad of it.'], light: ['{name} had a proper meal and says the soup was worth the queue.'] },
    lose: ['{name} went home hungry.', '{name} left without a proper meal.'],
    review: ['Missed out on a meal.', 'No time or place for a proper meal.'],
  },
  {
    kind: 'apres', weight: 1.5, needs: 'apres', tip: 40, goal: 'stop at the après bar', counter: null,
    win: { plain: ['{name} stopped at the après bar.', '{name} had a drink at the après bar after skiing.'], light: ['{name} stopped at the après bar and stayed for the second round.'] },
    lose: ['{name} left before the après bar.', '{name} skipped the après bar.'],
    review: ['Never made it to the après bar.', 'Wanted an après drink and did not get one.'],
  },
  {
    kind: 'lesson', weight: 2, needs: 'school', tip: 40, goal: 'take a ski lesson', counter: null,
    win: { plain: ['{name} took a ski lesson.', '{name} finished a lesson at the ski school.'], light: ['{name} took a ski lesson and is now teaching the parents.'] },
    lose: ['{name} did not get a lesson.', '{name} left without a ski lesson.'],
    review: ['No lesson today. The ski school was full or closed.', 'Wanted a lesson and did not get one.'],
  },
  {
    kind: 'excursion', weight: 1.5, needs: 'trail', tip: 50, goal: 'go on a trail excursion', counter: null,
    win: { plain: ['{name} went on a trail excursion.', '{name} walked out on the trails and enjoyed the view.'], light: ['{name} walked the trails and took far too many photos.'] },
    lose: ['{name} did not get out on the trails.', '{name} left without an excursion.'],
    review: ['Hoped to get out on the trails. Never did.', 'No time on the trails.'],
  },
  {
    kind: 'shortQueue', weight: 2, tip: 40, goal: 'ski {n} runs without a long wait', counter: '{p} / {n} runs',
    win: { plain: ['{name} skied {n} runs without a long wait.', '{name} got round {n} runs with short queues.'], light: ['{name} skied {n} runs and barely stopped moving.'] },
    lose: ['{name} spent too long in a lift queue.', '{name} waited too long for a lift.'],
    review: ['Too long in the lift queue.', 'Queue was longer than it should be.'],
  },
  {
    kind: 'happyDay', weight: 2, tip: 30, goal: 'go home happy', counter: null,
    win: { plain: ['{name} went home happy.', '{name} had a good day and said so.'], light: ['{name} went home happy and is telling everyone.'] },
    lose: ['{name} went home unhappy.', '{name} left in a poor mood.'],
    review: ['Not the day I hoped for.', 'Left a bit let down.'],
  },
];
export const WISH_BY_KIND: Record<WishKind, WishDef> = Object.fromEntries(WISHES.map((w) => [w.kind, w])) as Record<WishKind, WishDef>;

export const FIRST_NAMES: readonly string[] = [
  'Anna', 'Lukas', 'Marta', 'Jonas', 'Elena', 'Tomas', 'Sofia', 'Karl', 'Ines', 'Matteo', 'Greta', 'Felix', 'Clara', 'Pavel', 'Hanna', 'Luca',
  'Maja', 'Oskar', 'Nora', 'Viktor', 'Lena', 'Erik', 'Mira', 'Jakob', 'Petra', 'Stefan', 'Ida', 'Bruno', 'Katja', 'Milan',
];
export const TOWNS: readonly string[] = [
  'Linz', 'Graz', 'Bolzano', 'Munich', 'Zurich', 'Brno', 'Verona', 'Salzburg', 'Lyon', 'Ljubljana', 'Basel', 'Turin', 'Innsbruck', 'Bergamo', 'Lucerne',
];
