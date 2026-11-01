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

## Questions for you (from the audit)
1. Should **Challenging** be clearly harder? (Tighten its multipliers.)
2. Rudi tips for the **Helipad** and the energy extras, or leave them as discoverable extras?
3. The **Campground** only pays with hikers; fine as a summer-plan building?
4. Should a bigger resort keep rewarding **more cafés** (food demand scaling with size), or is saturation what you want?

## Not verifiable by agents
Real GPU frame rate, pointer lock (walk mode), audio by ear, touch on a real device (the unchanged `npm run touch:e2e` emulation passes), and whether the economy *feels* fair: all in your hands.
