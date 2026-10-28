# Money tips (Career, Normal)

Plain tips for earning money. The same text is in the player guide (`site/guide/money.md`, `getting-started.md`) and behind Ranger Rudi's **Cash tips** card (`cash.tips` advisor rule, strings only: `src/sim/advisor/strings.ts`). Numbers come from the headless human-like runs of `npx vite-node scripts/analysis/moneyCurve.ts [--policy winter|heavy|eager]` (docs/balance.md "Money pass").

## Early build order (first winter, start 1 December, $150,000)
1. One lift, a green/blue piste beside it, the base lodge's services (parking, ticket office, one chalet/lodge). Lifts earn the most; everything else feeds guests to them.
2. A snow cannon or two only if the snowline is above your pistes. The winter months (Dec-Mar) bring ~$20-30k net per 15-day month on a 64/128 map once the basics run.
3. Then ONE building at a time: lodge/chalet (beds), café, toilets, ski school. Do not build the next thing until cash is above that building's price plus ~$5,000.
4. A second or third lift (and the "Three kinds of lift" goal, a gondola) is a big purchase: save for it, or take the Starter loan first. On 128 / 256 maps a two-lift opening already uses all your cash.

## Pricing
- The default day pass is fair. Move it by 5-10 % at most; Rudi warns above +40 % or under -40 %. Doubling prices loses guests (the exploit test: x2 prices never beats the baseline by more than 1.6x).
- Check Pricing when guests leave unhappy; a cheap lift with a long queue is lost money, a pricey lift with an empty queue too.

## Loans
- The **Starter loan** ($50,000 at 5 %, 24 months) is the cheapest way over the first-winter gap. Repay it when cash stays above ~$30,000.
- Do not stack loans to build more lifts you cannot fill. Overdraft interest is 1.5 % of the negative balance per month and construction is refused while you are below zero.
- Summer or autumn debt: the Tourism Board offers a one-time interest-free support loan (up to $40,000, one year). Take it.

## Summer plan (June-September, and the quiet April-May / October-November)
- Winter income stays; summer is about a quarter of it. A winter-focused resort now loses at most ~$3k a month in the shoulder months, and earns in July/August if you keep one lift open for hikers and bikers.
- Paint hiking and biking trails along a lift, rest the lifts you do not need (Operations > schedule), build one summer attraction (Adventure Park, Beach, Boat Rental, Alpine Farm).
- In late spring save about 30 days of upkeep. Rudi's "Summer is coming: save up" shows the number.
- Summer construction is half price: build the next big thing in June, not in January.

## Campaigns
- Run a campaign only with cash above roughly $20,000: they cost real money. Winter: Budget -> Families -> Brand in that order. **Come by Train** needs a Train Station on a rail line near the lodge and is cheap money once it exists (trains fill guests without parking). Festival Season only around a booked festival.
- Summer campaign only once a summer attraction is open.

## What to avoid
- Building everything on day one: the first lift income arrives only after the first guests ride.
- Leaving winter lifts on the default schedule all summer when nobody rides (rest them).
- Training every staff course in year 1, bulldozing and re-building (refunds are partial), terraforming big areas early ($10 per corner half-step adds up).
- Letting Rudi's "In debt" go on: stop construction, raise prices a little, take the Starter loan, wait for the next snow.

## Targets we balance for (Normal)
| | target | measured after the money pass (64 / 128 maps, winter-focused human) |
|---|---|---|
| days below $1,000 in year 1 | a few | 0 |
| year-1 net (Dec-Mar + 8 months) | near break-even, slightly positive | -35k..+32k incl. the build-out (opening chain paid from cash) |
| year-2 net | clearly positive | +150k..+190k |
| summer month net (winter-focused) | >= -$3k | +5k..+13k (lifts open for hikers) |
