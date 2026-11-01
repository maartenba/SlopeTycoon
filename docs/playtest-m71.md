# M7.1 human playtest checklist (STOP)

Version 0.3.1. The consistency pass: the building contract test, the access / placement audit, the per-building ROI table and four economy fixes (Shop, Shuttle Bus Depot, Après-Ski Bar, Wind Turbine). The report is [economy-audit.md](economy-audit.md); the re-recorded goldens are in [balance.md](balance.md) "M7.1 re-record". Agents cannot judge feel, pacing or real-GPU behaviour: this is the list for the owner.

## One year on each difficulty (the main test)
- [ ] **Relaxed**: start a fresh Career game on 64, play 180 days at speed 3 / 10. Is it comfortably profitable? Target the agents measured for a competent bot: year 1 about +15k..+80k, year 2 about +195k..+235k (a real player will earn less).
- [ ] **Normal**: same. The bot ends year 1 between -15k and +50k, year 2 +135k..+165k, summer months about +5k..+10k each. Does the first winter feel tight but fair? Does summer feel survivable (no foreclosure, as in the fix3 playtest)?
- [ ] **Challenging**: same. The bot ends year 2 at +95k..+145k, i.e. only 10-20 % below Normal. Does it feel clearly harder to *you*? (Owner question 1 in the audit: tighten it?)
- [ ] Note the lowest cash you reached on each difficulty and whether any month ended in an overdraft.

## The four economy fixes
- [ ] **Shop**: build one beside the lodge. After a winter week the inspector / Finance shows a **Shops** income line in the low thousands a year (about $5k), not zero. Does it feel fair for $2,000? Do guests visibly stop at it without clogging the path?
- [ ] **Shuttle Bus Depot**: with a Train Station or Altiport and a depot, do buses of mixed guests (families, couples, VIPs among them) arrive, instead of only budget crowds? Does lodging income stay normal?
- [ ] **Après-Ski Bar** ($18 a round, $24 a day): build one in winter; in the evening do the guests gather there, and does the Finance tab show Bars income roughly covering its running cost? Do the restaurants still earn?
- [ ] **Wind Turbine** (high ground): the Energy tab shows a clearly useful output in a windy winter week (about +40 % over 0.3.0) while still shutting down in a storm.

## Rules and wording
- [ ] Hover a card for every building in the **Services, Recreation, Transport Hubs** tabs: each has an icon, a description, a price and the *Needs a footpath, road ... next to it* sentence in the same order.
- [ ] Place a building without access (a Rental away from the road): the ghost warning, the inspector status and Rudi's tip all say the same sentence.
- [ ] Mountain Hut and Après-Ski Bar: icon and description are present in the drawer.
- [ ] Guide > Building: the seven tabs match the drawer; the **Building reference** table matches what the cards show (price, upkeep, unlock level).
- [ ] The Show me button of the early tutorial steps (parking, ticket office, ski school, patrol) still highlights valid sites.

## Contract and balance (agents ran these; re-run if you changed data)
- [ ] `npx vitest run tests/repo/buildingContract.test.ts` passes (92 rows, no gaps).
- [ ] `npm run analysis:roi` (about 17 min) rewrites the table in `docs/economy-audit.md`; compare the flags with your own feel (which buildings do you never build?).
- [ ] `npm run test:balance` 42 / 42.

## Questions for you (from the audit): the owner's answers and what was done (M7.2)
1. **Challenging clearly harder?** Yes, about 30 % tighter than Normal. Done: loan rate x1.4, upkeep x1.2, wages x1.15, arrivals x0.85, price sensitivity x1.35 (cash x0.75, incidents x1.4, patience x0.8 as before). The bot's year 2 is now about 70 % of Normal on 64 / 128 (+97k vs +140k on 64) and still profitable in years 2 and 3 on 64 / 128 / 256 (`docs/economy-audit.md` section 4, balance suite). Re-test by hand: on Challenging the first winter should feel clearly tight (the lowest cash of the bot is $12k-$22k on 64), summer survivable, and the guide / New Game card say "About 30 % tighter than Normal".
2. **Rudi tips for the Helipad and the energy extras?** Yes. Done: `heli.rescue`, `trees.nursery`, `eco.recycling`, `energy.more` (`docs/advisor.md`). Re-test by hand: they should appear once, only for a real problem (late rescues; felled forest; sustainability the weakest area; a first generator with the grid offset far from its cap), never nag, be dismissible, and Show me must open the Buildings drawer on the item without building it.
3. **Campground** only pays with hikers: fine, no change.
4. **Food buildings**: audited. Extra cafes, huts and lodges never pay for themselves (a resort of 64 loses about $4k per extra cafe a year, $5k-$19k per extra lodge, with no extra income), so spamming loses money; nothing was retuned. New tip `food.surplus` ("You have more food buildings than guests can use"). Re-test by hand: build four or five cafes beside the village and play a winter fortnight; Rudi should say so once.

## New checks (M7.2)
- [ ] Open the New Game dialog: the Challenging card reads "About 30 % tighter than Normal: ...".
- [ ] A fresh Challenging Career game on 64: does it feel clearly harder than Normal, but not hopeless? Note the lowest cash.
- [ ] Rudi's four new extras tips and `food.surplus` behave as described above.

## Not verifiable by agents
Real GPU frame rate, pointer lock (walk mode), audio by ear, touch on a real device (the unchanged `npm run touch:e2e` emulation passes), and whether the economy *feels* fair: all in your hands.
