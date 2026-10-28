/**
 * Guest review templates (M5.1). Tone is mostly 'plain' (informative); 'light' templates carry a gentle joke about the
 * weather, food, queues or the guest themselves. Never about the player, no sarcasm, no meme-speak. The mix is enforced in
 * sim/guests/Reviews.ts (a light template is chosen for at most ~15% of reviews; the hard cap is 20%).
 * Tokens: {on} = 'on Blue Run 3' / 'at Chairlift 1' (only offered when a place is known), {name} = 'Blue Run 3'.
 */
export type ReviewDriver = 'queue' | 'piste' | 'price' | 'hunger' | 'tired' | 'weather' | 'crowd' | 'injury' | 'comfort' | 'general';
export type ReviewSentiment = 'pos' | 'neg';
export type ReviewTone = 'plain' | 'light';
export const REVIEW_DRIVERS: readonly ReviewDriver[] = ['queue', 'piste', 'price', 'hunger', 'tired', 'weather', 'crowd', 'injury', 'comfort', 'general'];

export interface ReviewTemplate { id: string; driver: ReviewDriver; sentiment: ReviewSentiment; tone: ReviewTone; text: string; needsPlace: boolean }

const P = 'plain', L = 'light';
type Row = [ReviewTone, string];
const RAW: Record<string, Row[]> = {
  'queue.neg': [
    [P, 'Long waits for the lifts today. I spent more time in line than skiing.'], [P, 'The queue {on} was slow. Worth planning around the busy hours.'],
    [P, 'Waited a long time to get uphill. The runs were fine, the line was not.'], [L, 'Spent so long in the lift line that I made three new friends. Would prefer more skiing.'],
    [L, 'My skis grew roots in that queue. Great runs once I finally got moving.'],
  ],
  'queue.pos': [
    [P, 'Barely any waiting at the lifts. Straight on and up.'], [P, 'Lifts ran smoothly and the queues stayed short. More laps than expected.'],
    [L, 'Queued for about as long as it took to zip up my jacket. Lovely.'],
  ],
  'piste.pos': [
    [P, 'Well-prepared pistes today. Smooth snow from top to bottom.'], [P, 'Great runs {on}. The surface was in good shape.'],
    [P, 'Plenty of variety in the pistes and good conditions on all of them.'], [L, 'The snow {on} was so smooth I briefly believed I was a good skier.'],
    [P, 'Nice grooming and good snow cover. Would ski here again.'],
  ],
  'piste.neg': [
    [P, 'Pistes were patchy and icy in places. Needs more grooming.'], [P, 'The surface {on} was rough and worn by the afternoon.'],
    [P, 'Thin snow cover in spots. Hard to enjoy the runs.'], [L, 'Found every bare patch on the mountain. A personal best.'],
    [P, 'Not many runs suited my level, and the ones I found were bumpy.'],
  ],
  'price.neg': [
    [P, 'Ran out of budget faster than expected. Prices add up over a day.'], [P, 'Tickets and food together cost more than I planned for.'],
    [P, 'Left early because the money ran out. A cheaper option would help.'], [L, 'My wallet got more of a workout than my legs.'],
  ],
  'price.pos': [
    [P, 'Good value for money. Fair ticket price and decent food.'], [P, 'Prices felt reasonable for what is on offer.'],
    [L, 'Spent less than I feared and skied more than I planned. Happy wallet.'],
  ],
  'hunger.neg': [
    [P, 'Could not find food when I was hungry. More places to eat would help.'], [P, 'Hungry for most of the afternoon. The food spots were too far away.'],
    [L, 'Running on fumes and one cereal bar. A snack stop would have been lovely.'], [L, 'My stomach was louder than the lifts.'],
  ],
  'hunger.pos': [
    [P, 'Good meal on the mountain, then back out for more runs.'], [P, 'Food was easy to find and tasted great.'],
    [L, 'Hot chocolate fixed everything. Highly recommend.'],
  ],
  'tired.neg': [
    [P, 'Worn out by mid-afternoon. A place to sit and rest would help.'], [P, 'Too many long walks between lifts. My legs gave up first.'],
    [L, 'My legs filed a formal complaint around three o\'clock.'],
  ],
  'tired.pos': [
    [P, 'A full day on the slopes. Tired in a good way.'], [P, 'Skied until closing and loved it.'],
    [L, 'Tired legs, happy head. Perfect.'],
  ],
  'weather.neg': [
    [P, 'The weather turned bad today. Visibility was poor and it was cold.'], [P, 'Rain and wind made the day hard work.'],
    [L, 'Today\'s forecast was "wet". The forecast was right.'], [P, 'Storm conditions {on}. I headed home early.'],
  ],
  'weather.pos': [
    [P, 'Lovely weather: fresh snow and clear views.'], [P, 'Snowfall overnight made the runs a pleasure.'],
    [L, 'Fresh snow and blue sky. Hard to complain, though I tried.'],
  ],
  'crowd.neg': [
    [P, 'It felt crowded today. Hard to find space on the pistes.'], [P, 'Busy around {name}. Lots of people in one spot.'],
    [L, 'So many people on the run that I had to ski in a polite line.'],
  ],
  'crowd.pos': [
    [P, 'Lively atmosphere without being too busy.'], [P, 'Plenty of people around but still room to ski.'],
    [L, 'Busy enough to feel lively, quiet enough to avoid a snow jam.'],
  ],
  'comfort.neg': [
    [P, 'Could not find a toilet when I needed one. A few more along the pistes and in the village would help.'], [P, 'Too far to the nearest toilet. Please add some near the busy runs.'],
    [L, 'Nature called. The nearest toilet was in another valley.'],
  ],
  'injury.neg': [
    [P, 'Took a fall {on} and had to end my day early. Hoping for a quick recovery.'], [P, 'Got hurt on the slopes. The patrol helped, but the day was over.'],
    [P, 'A bad fall cut my trip short.'], [L, 'The mountain and I disagreed about who should be on top. It won.'],
  ],
  'general.pos': [
    [P, 'A great day out. Would come back.'], [P, 'Good resort with a bit of everything. Enjoyed it.'],
    [P, 'Had a really good time {on}. Thanks for a fun day.'], [L, 'Came for one run, stayed for ten. No regrets.'],
    [P, 'Smooth day overall. Nothing to complain about.'], [L, 'Ten out of ten snowflakes.'],
  ],
  'general.neg': [
    [P, 'Not my best day. Several small things added up.'], [P, 'It was fine, but I expected more.'],
    [P, 'Left feeling a bit disappointed. Maybe next time.'], [L, 'Today I mostly learned what I do not like. Still glad I came.'],
  ],
};

export const REVIEW_TEMPLATES: readonly ReviewTemplate[] = Object.entries(RAW).flatMap(([k, rows]) => {
  const [driver, sentiment] = k.split('.') as [ReviewDriver, ReviewSentiment];
  return rows.map(([tone, text], i) => ({ id: `${k}.${i}`, driver, sentiment, tone, text, needsPlace: /\{(on|name)\}/.test(text) }));
});
