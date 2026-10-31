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
  debt: (amount: string, support = false): Text => ({ title: S('In debt'), why: S(`You owe ${amount}. Options: take a Starter or Small loan (Finance > Loans), raise ticket prices a little (Pricing), rest lifts you do not need, and pause new construction until the books recover.${support ? ' The Tourism Board also offers an interest-free off-season support loan: see Loans.' : ''}`) }),
  cashTips: (have: string): Text => ({ title: S('Cash tips'), why: S(`Cash is thin (${have}). Build lifts and a lodge first, then one new building at a time. A Starter loan (Finance > Loans) is cheap money; check the ticket price; pause building when cash is under about $5,000. More in the guide: Money tips.`) }),
  runway: (days: number): Text => ({ title: S('Low cash'), why: S(`Cash covers about ${days} days of upkeep. Hold off construction and check prices.`) }),
  winterComing: (days: number, hasReservoir: boolean): Text => ({ title: S('Winter is coming'), why: S(`Winter starts in ${days} days. ${hasReservoir ? `Add a ${B('snowCannon')} on your main piste.` : `Build a ${B('reservoir')} first, then ${B('snowCannon')}s.`}`) }),
  summerComing: (days: number): Text => ({ title: S('Summer is coming'), why: S(`Summer starts in ${days} days and there are no bike or hike trails. Paint a trail and set the summer lift schedule.`) }),
  vipLodging: (): Text => ({ title: S('VIPs need luxury lodging'), why: S(`Rich guests book the best rooms first. A ${B('luxuryHotel')} (30 suites, a heated pool that steams in the cold) beside a road is where they stay; a ${B('smallHotel')} adds 40 standard rooms and a restaurant. Solar and wind power can pay for the pool heating.`) }),
  summerCamp: (needsToilets: boolean): Text => needsToilets
    ? ({ title: S('Campers want toilets'), why: S(`Your ${B('campground')} has no ${B('toilets')} within 10 tiles. Campers enjoy the evening fire more with toilets nearby.`) })
    : ({ title: S('Summer nights: a campground'), why: S(`Summer is the quiet season. A ${B('campground')} beside a footpath sells cheap nights to budget and adventure guests, and its campfire cheers everybody up. A ${B('viewpoint')} on high ground gives hikers a reason to climb.`) }),
  overfished: (names: string[], pct: number): Text => ({ title: S('Overfished'), why: S(`${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} down to ${pct}% fish. Anglers are getting fewer bites. Set the ${B('tackleHut')} to Catch & release and give the water time to recover, or open another lake or river.`) }),
  summerBuffer: (days: number, save: string, have: string, runwayDays: number): Text => ({ title: S('Summer is coming: save up'), why: S(`Summer starts in ${days} days and income drops without snow. Cash covers about ${runwayDays} days of upkeep (${have}). Aim for ${save}, add summer attractions, or rest the lifts you will not need.`) }),
  snowGaps: (tiles: number): Text => ({ title: S('Snow gaps on your pistes'), why: S(`${tiles} piste tiles are out of reach of any ${B('snowCannon')}. Place a cannon beside the bare stretch (it throws about 10 tiles) within pipe range of a ${B('reservoir')}.`) }),
  snowWaste: (lineM: number): Text => ({ title: S('Snowmaking is wasting money'), why: S(`The snowline (${lineM.toLocaleString('en-US')} m) is above your pistes: snowmaking is wasting money. Switch to Auto or turn the cannons off in Operations.`) }),
  snowCold: (): Text => ({ title: S('Cold snap: turn snowmaking on'), why: S('It is cold enough to make snow on your pistes again. Turn snowmaking on (Operations) to build a base.') }),
  storm: (): Text => ({ title: S('Storm warning'), why: S(`A storm is passing and you have no ${B('warningSign')}. Signs cut hiker and off-piste incidents.`) }),
  rating: (label: string, hint: string, score: number): Text => ({ title: S(`Improve ${label.toLowerCase()}`), why: S(`${hint.replace(/\.$/, '')}. Weakest rating area: ${Math.round(score)} of 100.`) }),
  idleLift: (lift: string): Text => ({ title: S(`${lift} is barely used`), why: S('Guests ignore it. Check that a piste ends at its bottom station and starts at its top.') }),
  pisteDisconnected: (piste: string): Text => ({ title: S(`${piste} is not connected`), why: S('No lift reaches it. Link it to a lift station so guests can ski it.') }),
  buildingInactive: (name: string, reason: string): Text => ({ title: S(`${name} is inactive`), why: S(reason) }),
  crossingWaits: (hours: number): Text => ({ title: S('Guests wait long at the level crossing'), why: S(`Yesterday guests spent about ${hours} guest-hours waiting for trains. Draw a footpath across the rail with Cross rails set to Bridge: a footbridge never makes anyone wait.`) }),
  hikersHungry: (pct: number): Text => ({ title: S('Hikers are going hungry'), why: S(`${pct}% of recent hikers and bikers left starving. Add a ${B('mountainHut')} or ${B('cafe')} near the trails so they can eat on the way.`) }),
  energyGreen: (perGuest: string): Text => ({ title: S('Energy is your weakest green spot'), why: S(`Lifts and snow cannons cost about ${perGuest} in energy per guest. A ${B('solarArray')} cuts the grid bill (wind and hydro help too); a nursery and recycling add small sustainability gains.`) }),
  ecoCentre: (score: number): Text => ({ title: S('Sustainability is your weakest area'), why: S(`Your sustainability score is ${Math.round(score)}. An ${B('ecoCentre')} unlocks bigger measures: electric groomers, a car-free village, habitat corridors and more. They cost running money every day, so pick the ones that fit.`) }),
  toiletsNone: (missing: boolean, pct: number): Text => ({ title: S(missing ? 'No toilets' : 'Guests are desperate for a toilet'), why: S(missing ? `Guests get caught short and their mood drops. Build ${B('toilets')} beside the village footpath and near the busiest piste.` : `${pct}% of guests need a toilet badly. Add more ${B('toilets')} near the busy pistes and the village; they are cheap and free to use.`) }),
  waterTours: (): Text => ({ title: S('You have a river with rapids'), why: S(`A ${B('raftingBase')} within 3 tiles of it would run guided summer raft rides downstream. Quiet, and the rapids thrill your guests.`) }),
  backcountryNoPatrol: (n: number): Text => ({ title: S(n === 1 ? 'A backcountry route is outside patrol cover' : `${n} backcountry routes are outside patrol cover`), why: S(`Skiers on an open route can be caught by a slide, and without a ${B('patrolHub')} nearby nobody controls the slopes or digs them out quickly. Build a ${B('patrolHub')} within reach of the route, or close it.`) }),
  backcountryRisky: (level: number): Text => ({ title: S(`A backcountry route is open at danger ${level}`), why: S('You overrode the automatic closure. Guests can be caught in a slide and patrol is required; they are rescued and treated for injuries. Close the route in its inspector, or wait for the danger to fall.') }),
  winterTours: (): Text => ({ title: S('Winter idea: off-piste fun'), why: S(`Not everyone skis. A ${B('sleighStable')} beside a road offers quiet horse sleigh rides for couples and families; a ${B('snowshoeHut')} walks guests along a hiking trail, and a ${B('snowscooterBase')} adds loud, wildlife-scaring thrills.`) }),
  quadTours: (): Text => ({ title: S('Summer idea: quad tours'), why: S(`Adventure guests pay for guided rides. A ${B('quadBase')} next to a road runs summer tours on it; the engines scare wildlife and cost a little sustainability.`) }),
  bear: (): Text => ({ title: S('Bears near your resort'), why: S(`Bears are awake and scare guests. Build a ${B('rangerStation')}.`) }),
  liftService: (n: number, first: string, days: number, cost: string): Text => ({ title: S(n === 1 ? `${first} is overdue for service` : `${n} lifts are overdue for service`), why: S(`Peak season is close and ${n === 1 ? 'it has' : 'they have'} skipped the yearly service, so breakdowns are more likely (and worse in a storm). A service closes a lift for about ${days} days and costs ${cost}. Run it now, or let the Auto policy handle it next April.`) }),
  liftWorn: (lift: string, pct: number, workshop: boolean): Text => ({ title: S(`${lift} is worn (${pct}%)`), why: S(workshop ? 'Order an inspection or overhaul before it breaks down.' : `Build a ${B('liftWorkshop')} so repairs are faster and cheaper.`) }),
  priceHigh: (pct: number): Text => ({ title: S('Day pass is expensive'), why: S(`The day pass is ${pct}% above fair value. Guests leave unhappy and fewer arrive.`) }),
  priceLow: (pct: number): Text => ({ title: S('Day pass is cheap'), why: S(`The day pass is ${pct}% below fair value. You could earn more per guest.`) }),
  marketing: (name: string): Text => ({ title: S('A campaign is available'), why: S(`${name} meets its requirements. Campaigns bring extra guests for a fee.`) }),
  trainIdle: (pct: number): Text => ({ title: S('Train station idle: try the Come by Train campaign'), why: S(`Only ${pct}% of recent guests arrived by train. A Come by Train campaign puts more of them on the rail, which also eases the car park and helps sustainability.`) }),
  summerCampReady: (): Text => ({ title: S('A Campground is ready: try Family Summer Camp'), why: S(`Your ${B('campground')} and its kids attractions are open. A Family Summer Camp campaign brings families for a summer holiday (no Ski School needed; keep the day pass cheap).`) }),
  anglersCampaign: (): Text => ({ title: S('Anglers need a campaign: Angler\'s Paradise'), why: S(`Your ${B('tackleHut')} has fish to catch. An Angler's Paradise campaign (Lakeside Escape) tells anglers and couples about it. Keep an eye on the fish stock: overfished water ends the fun.`) }),
  wellnessCampaign: (): Text => ({ title: S('Seniors and couples would love a Wellness & Views campaign'), why: S(`Your village has a pool or viewpoints, somewhere to eat and ${B('toilets')}. A Wellness & Views campaign invites seniors and couples for quiet breaks (keep the day pass at a premium price).`) }),
  schoolCampaign: (): Text => ({ title: S('Quiet weekdays: try the School Trips campaign'), why: S(`With a ${B('skiSchoolHQ')}, a kids area and cheap beds you can host school classes on weekdays in the low season and in summer. They spend little, but they fill the quiet weeks (keep the day pass cheap).`) }),
  powderCampaign: (): Text => ({ title: S('Fresh snow and an open route: try Powder Hounds'), why: S(`A backcountry route is open, your ${B('patrolHub')} is on duty and there is somewhere to eat. A Powder Hounds campaign calls ski tourers and riders, and works best on a powder day. It pauses while every route is closed for avalanche danger.`) }),
  parkJamReady: (): Text => ({ title: S('Snowboarders love your park: try the Snowboard Park Jam'), why: S(`Your ${B('stuntPark')} and ${B('rental')} are open. A Snowboard Park Jam campaign tells the board crowd about it.`) }),
  parkingFull: (): Text => ({ title: S('Parking is full: try the Come by Train campaign'), why: S('The car park is at its limit and guests are being turned away, but the train station has room. A Come by Train campaign moves arrivals from the roads onto the rail.') }),
  goal: (title: string, todo: string): Text => ({ title: S(`Next goal: ${title}`), why: S(todo) }),
  goalClose: (title: string): Text => ({ title: S(`Close to a goal: ${title}`), why: S('One more step completes it.') }),
} as const;
