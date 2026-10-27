/**
 * Advisor wording (M5.1 Task 4): every string Ranger Rudi shows lives here. Voice (D4): warnings are plain, factual sim text; Rudi only adds a
 * short friendly line (`FRIENDLY`) on positive notes. Names reach the player through `displayName` / `sentence` (no raw ids).
 */
import { displayName, sentence } from '../../ui/text';

export const RANGER_NAME = 'Ranger Rudi';

export const ADVISOR_UI = {
  badge: 'Advice',
  title: 'What should I do next?',
  show: 'Show me',
  dismiss: 'Dismiss',
  empty: 'Nothing needs attention right now.',
  emptyFriendly: 'The resort looks in good shape. Nice work!',
  snoozeNote: 'Dismissed advice returns after 30 days if it still applies.',
  more: 'More advice is waiting. Deal with these first.',
  close: 'Close',
  noTarget: 'Nothing to look at yet.',
} as const;

/** Short friendly lines for positive notes only (never on warnings). */
export const FRIENDLY: readonly string[] = ['Nice work so far!', 'You are on a good track.', 'Almost there!'];

export interface Text { title: string; why: string }
const S = sentence;
const B = displayName;

export const TEXT = {
  queue: (lift: string, mins: number): Text => ({ title: S('Long lift queue'), why: S(`Guests wait about ${mins} min at ${lift}. Build a second lift or raise capacity (a faster lift type).`) }),
  groomingNone: (): Text => ({ title: S(`No grooming on your pistes`), why: S(`Pistes wear out without grooming. Build a ${B('groomerGarage')} near the lodge, then a ${B('snowcatOutpost')} beside the pistes: the outpost is what reaches them.`) }),
  groomingGap: (pct: number): Text => ({ title: S('Grooming gap'), why: S(`${pct}% of piste tiles are outside grooming coverage. A ${B('snowcatOutpost')} beside them would reach them.`) }),
  icyRun: (name: string, pct: number): Text => ({ title: S(`${name} is icy`), why: S(`${pct}% of ${name} is icy: groom it first (select it and choose Groom first) or add snowmaking.`) }),
  icy: (pct: number): Text => ({ title: S('Icy pistes'), why: S(`${pct}% of open piste tiles are icy. Groom more often or add snowmaking.`) }),
  patrolNone: (): Text => ({ title: S('No ski patrol'), why: S(`Injured guests wait for help. Build a ${B('patrolHub')}.`) }),
  aidGap: (pct: number): Text => ({ title: S('First aid gap'), why: S(`${pct}% of piste tiles have no first-aid or patrol cover. Build a ${B('firstAid')} beside them.`) }),
  school: (families: number): Text => ({ title: S('No ski school'), why: S(`${families} families are visiting. A ${B('skiSchoolHQ')} gives them lessons and keeps them longer.`) }),
  almabtriebFarm: (): Text => ({ title: S('Almabtrieb in autumn'), why: S(`Build an ${B('alpineFarm')} to see the Almabtrieb in autumn: decorated cows come down from the alpine pasture, the road is dressed with bunting and a few more guests turn up.`) }),
  almabtriebSoon: (days: number): Text => (days > 0
    ? { title: S(`Almabtrieb in ${days} day${days === 1 ? '' : 's'}`), why: S('The cows come down from the alpine pasture. Bunting and a procession will line the road by the base station: have a look.') }
    : { title: S('Almabtrieb is on'), why: S('The decorated cows are coming down from the alpine pasture. Bunting and a procession line the road by the base station.') }),
  parking: (): Text => ({ title: S('No parking'), why: S(`Guests need a way to arrive. Build ${B('parking')} next to the road.`) }),
  notWorking: (name: string, reason: string, link: { kind: 'road' | 'footpath'; near: string } | null): Text => ({
    title: S(`${name} is not working`),
    why: S(`Your ${name} is not working: ${reason.replace(/\.$/, '')}.${link ? ` Draw a ${link.kind} to it from the nearest ${link.kind === 'road' ? 'road' : 'road or footpath'} end ${link.near}.` : ' Select it to see what is missing.'}`),
  }),
  debt: (amount: string, support = false): Text => ({ title: S('In debt'), why: S(`You owe ${amount}. Raise prices or open more lifts, and pause new construction until the books recover.${support ? ' The Tourism Board offers an interest-free off-season support loan: see Loans.' : ''}`) }),
  runway: (days: number): Text => ({ title: S('Low cash'), why: S(`Cash covers about ${days} days of upkeep. Hold off construction and check prices.`) }),
  winterComing: (days: number, hasReservoir: boolean): Text => ({ title: S('Winter is coming'), why: S(`Winter starts in ${days} days. ${hasReservoir ? `Add a ${B('snowCannon')} on your main piste.` : `Build a ${B('reservoir')} first, then ${B('snowCannon')}s.`}`) }),
  summerComing: (days: number): Text => ({ title: S('Summer is coming'), why: S(`Summer starts in ${days} days and there are no bike or hike trails. Paint a trail and set the summer lift schedule.`) }),
  summerBuffer: (days: number, save: string, have: string, runwayDays: number): Text => ({ title: S('Summer is coming: save up'), why: S(`Summer starts in ${days} days and income drops without snow. Cash covers about ${runwayDays} days of upkeep (${have}). Aim for ${save}, add summer attractions, or rest the lifts you will not need.`) }),
  snowGaps: (tiles: number): Text => ({ title: S('Snow gaps on your pistes'), why: S(`${tiles} piste tiles are out of reach of any ${B('snowCannon')}. Place a cannon beside the bare stretch (it throws about 10 tiles) within pipe range of a ${B('reservoir')}.`) }),
  snowWaste: (lineM: number): Text => ({ title: S('Snowmaking is wasting money'), why: S(`The snowline (${lineM.toLocaleString('en-US')} m) is above your pistes: snowmaking is wasting money. Switch to Auto or turn the cannons off in Operations.`) }),
  snowCold: (): Text => ({ title: S('Cold snap: turn snowmaking on'), why: S('It is cold enough to make snow on your pistes again. Turn snowmaking on (Operations) to build a base.') }),
  storm: (): Text => ({ title: S('Storm warning'), why: S(`A storm is passing and you have no ${B('warningSign')}. Signs cut hiker and off-piste incidents.`) }),
  rating: (label: string, hint: string, score: number): Text => ({ title: S(`Improve ${label.toLowerCase()}`), why: S(`${hint.replace(/\.$/, '')}. Weakest rating area: ${Math.round(score)} of 100.`) }),
  idleLift: (lift: string): Text => ({ title: S(`${lift} is barely used`), why: S('Guests ignore it. Check that a piste ends at its bottom station and starts at its top.') }),
  pisteDisconnected: (piste: string): Text => ({ title: S(`${piste} is not connected`), why: S('No lift reaches it. Link it to a lift station so guests can ski it.') }),
  buildingInactive: (name: string, reason: string): Text => ({ title: S(`${name} is inactive`), why: S(reason) }),
  hikersHungry: (pct: number): Text => ({ title: S('Hikers are going hungry'), why: S(`${pct}% of recent hikers and bikers left starving. Add a ${B('mountainHut')} or ${B('cafe')} near the trails so they can eat on the way.`) }),
  bear: (): Text => ({ title: S('Bears near your resort'), why: S(`Bears are awake and scare guests. Build a ${B('rangerStation')}.`) }),
  liftService: (n: number, first: string, days: number, cost: string): Text => ({ title: S(n === 1 ? `${first} is overdue for service` : `${n} lifts are overdue for service`), why: S(`Peak season is close and ${n === 1 ? 'it has' : 'they have'} skipped the yearly service, so breakdowns are more likely (and worse in a storm). A service closes a lift for about ${days} days and costs ${cost}. Run it now, or let the Auto policy handle it next April.`) }),
  liftWorn: (lift: string, pct: number, workshop: boolean): Text => ({ title: S(`${lift} is worn (${pct}%)`), why: S(workshop ? 'Order an inspection or overhaul before it breaks down.' : `Build a ${B('liftWorkshop')} so repairs are faster and cheaper.`) }),
  priceHigh: (pct: number): Text => ({ title: S('Day pass is expensive'), why: S(`The day pass is ${pct}% above fair value. Guests leave unhappy and fewer arrive.`) }),
  priceLow: (pct: number): Text => ({ title: S('Day pass is cheap'), why: S(`The day pass is ${pct}% below fair value. You could earn more per guest.`) }),
  marketing: (name: string): Text => ({ title: S('A campaign is available'), why: S(`${name} meets its requirements. Campaigns bring extra guests for a fee.`) }),
  goal: (title: string, todo: string): Text => ({ title: S(`Next goal: ${title}`), why: S(todo) }),
  goalClose: (title: string): Text => ({ title: S(`Close to a goal: ${title}`), why: S('One more step completes it.') }),
} as const;
