/**
 * ALL user-facing tutorial / assistant / hint strings (i18n-ready: one flat key -> text table, `{name}` placeholders).
 * Mini markup understood by the assistant bubble: `**bold**`, `` `Q` `` (keyboard key) and plain emoji icons.
 * Step keys are derived from the step id: `step.<id>.title|text|show`. Hint keys: `hint.<id>.text`.
 * tests/tutorial/strings.test.ts checks that every key used exists and every key defined is used.
 */
export const STRINGS = {
  // ---- assistant UI ----
  'ui.name': 'Ranger Robin',
  'ui.avatarLabel': 'Tutorial assistant',
  'ui.show': 'Show me',
  'ui.do': 'Do it for me',
  'ui.doPrice': 'Do it for me (≈ {price})',
  'ui.skip': 'Skip step',
  'ui.next': 'Got it',
  'ui.prev': 'Back',
  'ui.hide': 'Hide',
  'ui.unhide': 'Tutorial help',
  'ui.exit': 'Exit tutorial',
  'ui.exitConfirm': 'Exit the tutorial? You can replay it from Help.',
  'ui.exitYes': 'Exit',
  'ui.exitNo': 'Keep going',
  'ui.progress': 'Step {n} of {total}',
  'ui.goals': 'Resort goals',
  'ui.goal.guests': '{n} guests in the resort',
  'ui.goal.rating': '{n}★ resort rating',
  'ui.goal.profit': 'A profitable month',
  'ui.hintClose': 'Dismiss',
  'ui.hintTitle': 'Tip',
  'ui.replay': 'Replay tutorial',
  'ui.hintsToggle': 'Toggle hints',
  'ui.hintsOn': 'Hints: on',
  'ui.hintsOff': 'Hints: off',
  'ui.done': 'Tutorial complete',

  // ---- engine messages ----
  'msg.stepBack': 'Looks like something we built earlier is gone. Let’s put it back: {title}.',
  'msg.funding': 'Tutorial funding: +{amount} so you can finish this step.',
  'msg.noLift': 'No valid lift line found near the base: try terraforming or a different map area.',
  'msg.noSite': 'I can’t find a valid spot right now. Try clearing space near the Base Lodge, or skip this step.',
  'msg.needMoney': 'You need about {price} for this. Open Finance and take a loan, or skip the step.',
  'msg.done': 'Done! That cost {price}.',
  'msg.failed': 'That didn’t work: {reason}',
  'msg.paused': 'The game is paused. Press `Space` to let time pass.',
  'msg.waiting': 'Waiting for the sim… guests need time (and open lifts and snow) to arrive.',
  'msg.complete': 'Tutorial finished. Your goals stay on screen until you reach them.',
  'msg.exited': 'Tutorial closed. Find “Replay tutorial” in Help (?) any time.',
  'msg.goalsReached': 'All resort goals reached. Congratulations!',

  'name.piste': 'Sunny Slope',

  // ---- failure reasons shown by msg.failed ----
  'reason.funds': 'Not enough funds',
  'reason.blocked': 'Something is in the way',
  'reason.nothingPainted': 'Nothing could be painted there',
  'reason.noGuests': 'No guests yet: are a lift, snow and a ticket office in place?',
  'reason.noCannon': 'No valid cannon spot beside the piste',
  'reason.noPiste': 'No piste there',
  'reason.priceUnchanged': 'The price did not change',
  'reason.gameOver': 'The game is over',

  // ---- lessons ----
  'step.camera.title': 'Look around',
  'step.camera.text': 'Welcome to Slope Tycoon! Drag with the **middle** or **right** mouse button to pan, scroll to zoom and press `Q` / `E` (or the ⟲ ⟳ buttons) to rotate the view. Try rotating once.',
  'step.camera.show': 'The rotate buttons are in the top-left bar.',

  'step.lodge.title': 'Your Base Lodge',
  'step.lodge.text': 'Every resort grows around its **Base Lodge**, the village heart where guests arrive on foot. It is already standing in the valley, with a road reaching it.',
  'step.lodge.show': 'This is the Base Lodge (the ring marks it). If you ever demolish it, I will help you rebuild it.',

  'step.select.title': 'Select vs. tools',
  'step.select.text': 'By default you are in **select** mode: click a building to inspect it, rename or demolish it. Tools only run while a drawer item is picked; `Esc` always takes you back to select. Click the Base Lodge now.',
  'step.select.show': 'Click the highlighted Base Lodge on the map.',

  'step.parking.title': 'Build a parking lot',
  'step.parking.text': 'Guests arrive by car. Open **Buildings → Transport Hubs** and place a **Parking** lot near the road leading to the lodge. Green ghost = valid, red = blocked.',
  'step.parking.show': 'This spot is flat and next to where the road can reach it.',

  'step.parkingRoad.title': 'Connect it to the road',
  'step.parkingRoad.text': 'A building whose status says **inactive — needs a road next to it** is not connected. Parking needs a **road** to the road entry. Open **Paths & Roads → Road** and drag from the existing road to the parking lot.',
  'step.parkingRoad.show': 'A road along this line links the parking to the entry road.',

  'step.footpath.title': 'Footpaths',
  'step.footpath.text': 'Guests walk on **footpaths**. Use **Paths & Roads → Footpath** to connect the parking lot with the Base Lodge so people can stroll between them.',
  'step.footpath.show': 'A footpath here links parking and lodge.',

  'step.ticket.title': 'Ticket Office',
  'step.ticket.text': 'Lift tickets are sold at the **Ticket Office** (Buildings → Services). Put it beside a footpath near the lodge.',
  'step.ticket.show': 'Beside the footpath, close to the lodge: a good ticket office spot.',

  'step.lift.title': 'Build a ski lift',
  'step.lift.text': 'Open **Lifts** and pick a **Chairlift** (or T-Bar). Click the bottom station near the village, then the top station higher up. Auto-flatten levels the station sites; only kinds that fit the slope are valid.',
  'step.lift.show': 'Bottom station near the village (ring), top station uphill (arrow). The ghost turns green when the line is valid.',

  'step.piste.title': 'Paint a piste',
  'step.piste.text': 'Open **Pistes & Trails** and paint a run from the top station down to the bottom one. A piste must be **continuous** and touch a lift: loose pieces show as *disconnected*. Colours show difficulty (green easy, blue, red, black).',
  'step.piste.show': 'Paint along this line next to the lift, from the top down to the bottom station.',

  'step.namePiste.title': 'Name your run',
  'step.namePiste.text': 'Click your new piste (select mode) and rename it in the inspector, e.g. “Sunny Slope”. Names show up in news and reports.',
  'step.namePiste.show': 'Click anywhere on the painted piste, then edit the name field.',

  'step.school.title': 'Ski School',
  'step.school.text': 'Families want lessons. Place a **Ski School HQ** (Buildings → Ski School & Kids) next to a footpath.',
  'step.school.show': 'A flat site near a footpath and the village.',

  'step.carpet.title': 'Magic Carpet',
  'step.carpet.text': 'The **Magic Carpet** is locked until a Ski School exists (*dependency lock*), then it unlocks. Place it on a gentle slope.',
  'step.carpet.show': 'A gentle slope near the school and the foot of the piste.',

  'step.patrol.title': 'Ski Patrol Hub',
  'step.patrol.text': 'Accidents happen. Place a **Ski Patrol Hub** (Buildings → Safety & Ops) beside the road.',
  'step.patrol.show': 'Near the road and village so the patrol can reach the slopes.',

  'step.firstAid.title': 'First-Aid Hut',
  'step.firstAid.text': 'The **First-Aid Hut** needs a Patrol Hub and works best right beside a piste.',
  'step.firstAid.show': 'Next to the piste, within the patrol’s reach.',

  'step.overlay.title': 'Coverage overlays',
  'step.overlay.text': 'Press `O` (or open **View**) to cycle map overlays. The patrol / first-aid overlay shows which tiles are covered by emergency services. Cycle the overlay once.',
  'step.overlay.show': 'Open the View drawer and click an overlay, or press `O`.',

  'step.restaurant.title': 'Food and warmth',
  'step.restaurant.text': 'Hungry guests are unhappy guests. Place a **Lodge/Restaurant** near the village (or a Mountain Hut beside the piste).',
  'step.restaurant.show': 'A flat spot near the village road.',

  'step.rental.title': 'Equipment rental',
  'step.rental.text': 'Beginners need skis. A **Rental** shop (Buildings → Services) earns money and keeps guests on the slopes.',
  'step.rental.show': 'Beside the road near the lodge.',

  'step.speed.title': 'Control time',
  'step.speed.text': 'Use the speed buttons (or `Space`, `+`, `-`) to set **3×** and then **pause**. While paused you can still build and inspect. Try both, then press play again.',
  'step.speed.show': 'The speed controls are in the top-right column.',

  'step.guests.title': 'Wait for guests',
  'step.guests.text': 'Time to open up! Let the clock run (speed 1× or more) and the first guests will arrive. They need snow, an open lift and a ticket office.',
  'step.guests.show': 'Watch the guest counter in the HUD.',

  'step.daynight.title': 'Day and night',
  'step.daynight.text': 'Days are short: lifts run by day, groomers work at night. With **Fast nights** on, the clock skips the quiet night hours. You can toggle it in Settings (⚙).',
  'step.daynight.show': 'The clock and the Fast nights toggle live next to the speed buttons.',

  'step.seasons.title': 'Seasons and snowline',
  'step.seasons.text': 'The HUD shows the **season** and the **snowline**. Above it there is snow; below, lifts and pistes close (the news tells you why). Build snowmaking for the edges of winter.',
  'step.seasons.show': 'Season, weather and snowline are shown in the HUD.',

  'step.pricing.title': 'Set your prices',
  'step.pricing.text': 'Open **Pricing** and change the **day pass** price. Higher prices earn more per guest but can scare people away.',
  'step.pricing.show': 'Pricing drawer: change the day pass price.',

  'step.loan.title': 'Your first loan',
  'step.loan.text': 'Open **Finance** and take a small loan. Debt costs interest every month, so only borrow what you can repay.',
  'step.loan.show': 'Finance drawer → Loans.',

  'step.groomer.title': 'Groom the slopes',
  'step.groomer.text': 'Pistes wear down and turn icy. A **Groomer Garage** (Buildings → Safety & Ops) sends snowcats out at night.',
  'step.groomer.show': 'Beside the road near the village.',

  'step.snowmaking.title': 'Snowmaking',
  'step.snowmaking.text': 'Place a **Reservoir** (Buildings → Utilities) and a **Snowmaking Cannon** on your piste, within pipe range of the reservoir.',
  'step.snowmaking.show': 'The reservoir goes near the piste, the cannon next to the run.',

  'step.marketing.title': 'Marketing',
  'step.marketing.text': 'Open **Marketing** and start a campaign. Each one lists its requirements: **Brand awareness** needs an open lift and a restaurant, **Families** a Ski School and a kids area. Results show in the campaign list.',
  'step.marketing.show': 'Marketing drawer → Brand awareness or Families.',

  'step.summer.title': 'Summer pivot',
  'step.summer.text': 'In summer pistes close, but **hiking and MTB trails** and bike lifts keep income flowing. For this lesson you can jump ahead to **summer** (tutorial only). Optional: an **Alpine Farm** (Buildings, Recreation) brings cows to the summer pastures and attracts families.',
  'step.summer.show': 'Use the button below to skip to summer.',

  'step.trails.title': 'Hiking and MTB trails',
  'step.trails.text': 'In **Pistes & Trails** pick **Hiking Trail** or **MTB Trail** and paint from a path or building. Lifts can carry bikes in summer: set their season in **Operations**.',
  'step.trails.show': 'A trail along the piste from the village.',

  'step.save.title': 'Save your game',
  'step.save.text': 'Press **💾** (or `F5` for a quick save) to keep your resort. Autosave also runs in the background.',
  'step.save.show': 'The save button is in the top-left bar.',

  'step.goals.title': 'Your goals',
  'step.goals.text': 'A resort is never finished. Aim for **200 guests**, a **4★ rating** and a **profitable month**. The goal list stays on screen until you get there.',
  'step.goals.show': 'The goal checklist sits under me.',

  'step.finish.title': 'You’re ready!',
  'step.finish.text': 'That’s the tour. Keep building, watch the news, and enjoy the slopes. I’ll pop up with tips when something new happens.',
  'step.finish.show': 'Have fun!',

  // ---- contextual hints (one-shot) ----
  'hint.noRental.text': 'First guests are here, but there is no **Rental** shop. Beginners without skis will leave unhappy.',
  'hint.queue.text': 'A lift queue is getting long. Add another lift or a bigger lift kind.',
  'hint.icy.text': 'Pistes are turning **icy**. A Groomer Garage grooms them at night.',
  'hint.avalanche.text': 'Avalanche! Steep, snowy slopes can slide. Patrol coverage and warning signs reduce the danger.',
  'hint.wildlife.text': 'Wildlife spotted near the slopes. Guests love it, but keep the paths clear of predators.',
  'hint.injury.text': 'A guest got hurt and no **Ski Patrol Hub** is in your resort. Build one (and a First-Aid Hut).',
  'hint.debt.text': 'You are in debt. Construction stops until your cash is positive. Check Finance and loans.',
  'hint.bankruptcy.text': 'Bankruptcy is near. Raise cash fast: cut costs, raise prices or take a loan.',
  'hint.liftBreakdown.text': 'A lift broke down. A Lift Maintenance Workshop speeds up repairs, and regular inspections prevent faults.',
  'hint.season.autumn.text': 'Winter is coming: build **snowmaking** (Reservoir + cannons) and a Groomer Garage before the snow.',
  'hint.season.winter.text': 'Winter is here: open your lifts, check pistes and set ticket prices.',
  'hint.season.spring.text': 'Spring: the snowline climbs and lower pistes melt. Time for hiking trails and summer plans.',
  'hint.season.summer.text': 'Summer: build hiking and MTB trails, boats and beaches. Construction is cheaper now.',
  'hint.summer.farm.text': 'Summer is here: an **Alpine Farm** (Recreation) brings cows to the pastures and attracts families.',
  'hint.lowRating.text': 'Your rating dropped. Open the rating panel to see what hurts the most.',
  'hint.noSchool.text': 'Families are arriving but you have no **Ski School**. Kids need lessons.',
  'hint.storm.text': 'A storm is rolling in. Lifts may close and avalanche risk rises.',
} as const;

export type StringKey = keyof typeof STRINGS;

/** Looks up a string and fills `{name}` placeholders. Unknown keys return the key itself (visible bug, never a crash). */
export function t(key: StringKey | string, args?: Record<string, string | number>): string {
  const raw = (STRINGS as Record<string, string>)[key];
  if (raw === undefined) return key;
  return args ? raw.replace(/\{(\w+)\}/g, (_m, k: string) => (k in args ? String(args[k]) : `{${k}}`)) : raw;
}

export const stepKey = (id: string, part: 'title' | 'text' | 'show'): string => `step.${id}.${part}`;
export const hintKey = (id: string): string => `hint.${id}.text`;

/** Tiny safe markup parser (no HTML): `**bold**`, `` `key` ``, `*italic*`. */
export type RichSpan = { kind: 'text' | 'bold' | 'key' | 'em'; text: string };
export function parseRich(src: string): RichSpan[] {
  const out: RichSpan[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'key', text: m[2] });
    else out.push({ kind: 'em', text: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}
