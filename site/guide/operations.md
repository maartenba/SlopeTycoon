---
title: "Operations & safety"
order: 6
summary: "Patrol, first aid, the rescue helicopter, avalanches, wildlife, rangers, lift maintenance, energy and green buildings, crews and courses."
description: "Run the mountain in Slope Tycoon: ski patrol, first aid, the rescue helicopter, avalanches, wildlife, rangers, lift maintenance, energy, crews and courses."
screenshots: [ui-eco-programme, ui-staff, ui-maintenance, ui-energy-tab]
---
Skiing is fun until somebody falls over. The **Operations** drawer and the coverage overlays show how well your resort can cope. Its tabs are **Lifts** (opening hours, the snowmaking row), **Runs** (see [Lifts & pistes](page:lifts-pistes)), **Maintenance** and **Staff**.

> [!NOTE] Slope Tycoon is gentle about it: **nobody dies**. A badly handled incident ends with a guest going to hospital and leaving early (and a bad review).

## Incidents

Guests can get injured, stuck or buried, or meet a bear. An incident progresses from open to responding, treatment, transport and resolved. Left alone, a minor injury becomes major and then critical, so **response time** matters.

## Your safety team

- **Ski Patrol Hub**: sends patrol sleds out onto the pistes (you can add or remove staff, up to six per hub).
- **First-Aid Hut**: treats minor injuries on site; its medic walks to the guest.
- **Helipad**: a rescue helicopter flies serious cases to hospital off the edge of the map. It costs more per mission and unlocks at resort level 4 in Career.
- **Warning signs** reduce storm trouble on the slopes.

Use the **coverage overlay** (<kbd>O</kbd> cycles overlays) to see which pistes are outside patrol and first-aid reach.

## Staff and training

{{fig:ui-staff}}

The **Staff** tab (the last tab of the Operations drawer) keeps four crews: **instructors** (ski-school capacity), **patrol** (how fast the rescue sleds go), **groomers** (the night shift) and **lift operators** (loading speed). By default everything is on **Auto**: crews match what your buildings need, nothing changes and nothing extra is paid.

Untick Auto to set a headcount yourself. Fewer people than needed slows that job down (never below 30 %), extra people cost wages and bring nothing. The **wage level** (low, normal, high) scales the bill and sets the crew's **morale**: tired, underpaid crews break more lifts, happy ones fewer.

### Six training courses

Staff can also take one **course** at a time. Each costs a one-off sum, takes some days and adds a small daily upkeep once trained. Some need a higher resort level in Career.

{{gen:staffUpgrades}}

> [!TIP] Courses are convenience and safety investments, not profit engines. Train *Lift mechanics* if lifts keep breaking, *Rangers & wildlife* if animals scare guests or your forest score is low.

## Avalanches

Avalanches are rare and dramatic. They need steep ground (roughly 30–45°), plenty of snow and fresh snowfall, and cold air. Forests protect slopes; patrol cover and **night control blasting** make slides less likely. A slide can bury guests and closes pistes for several hours. Most are small and harmless, and **nobody ever dies**: buried guests are dug out by patrol or the helicopter, or taken to hospital, and count against your safety rating.

**Backcountry routes** use the same snow model to give each route an **avalanche danger from 1 to 5**. A route closes by itself at 4, a Ski Patrol Hub next to it keeps the danger lower and blasts the slope at night, and you can override a closure if you accept the risk. See [Backcountry & avalanche danger](page:backcountry). The winter tours (snowshoe walks in particular) cancel on unstable snow too: [Sleighs, snowshoes & snowscooters](page:winter-adventures).

## Wildlife and rangers

Bears sleep through winter, get hungry in autumn and roam the remote forest in the warm months, along with wolves. They scare guests and cost you income.

Autumn has a bonus: the **Almabtrieb**. With an Alpine Farm (and cows) the herds come down from the pastures in early October. It is announced three days ahead in the news and by Ranger Rudi (*Show me* flies to the base station), starts with a news item on 1 October, brings a small arrival bonus and dresses the road by the base station for 11 days. It is listed in the Events panel with its date; without a farm Rudi suggests building one.

**Fish are wildlife too.** Every lake, pond, stream and dug river has a **fish stock** that regrows by itself (faster in flowing water, not at all under ice). A *Tackle & Bait Hut* is set to **Catch & release** (the stock hardly shrinks) or **Keep** (a little more income, but the fish disappear about fifteen times faster); when a water falls under 30 % the Advisor warns *Overfished*. A healthy stock adds a little, an empty one subtracts a little (at most two points) from your [sustainability](page:events) score. In winter anglers **ice-fish** on frozen lakes and ponds. More in [Summer](page:summer).

Build a **Ranger Station** (it unlocks a goal early on) to keep guests and animals apart. Rangers can stock bear-proof bins. The **Rangers & wildlife** course scares guests less often and halves the habitat penalty in your [sustainability](page:events) score.

## Lifts: maintenance and breakdowns

Lifts wear out. A **Lift Maintenance Workshop** looks after them, and every lift gets a planned **annual service** in the **Maintenance** tab: winter lifts in April, summer-only lifts in October, or a month you pick. Skipped services make a lift *overdue* and more likely to break down.

{{fig:ui-maintenance}}

The full rules (windows, closures of 2 to 7 days, cost, overdue risk) are in [Lifts & pistes](page:lifts-pistes). Strong wind closes lifts that are not wind-tolerant, and a stuck lift triggers an evacuation of riders.

## Energy and sustainability

Lifts and snow cannons burn energy, and that is a cost line in your books (and a bar in your rating). The **Energy** tab of the Buildings drawer holds the buildings that make it cheaper or greener:

{{fig:ui-energy-tab}}

| Building | Notes |
|---|---|
| **Solar Array** | Cheap and flat-ground friendly. Weak under winter snow, strong in summer. |
| **Solar Plant** | The big one (level 3 in Career); worthwhile on large maps. |
| **Wind Turbine** | Level 2. Needs exposed, high ground ("Too low for this building" otherwise) and shuts down in storms; the rotor really spins. |
| **Small Hydro** | Must stand on a stream bank; runs day and night, best in the spring melt. |
| **Biomass Heating** | Burns timber from the forest you clear. A small, slow-payback offset. |
| **Tree Nursery** | Raises saplings that count against the forest you felled, and makes replanting cheaper. |
| **Recycling & Compost Centre** | A flat bonus to the sustainability score (one is enough). |

A **Luxury Hotel**'s heated pool is part of the bill too: about $17 a day at a winter noon (never less than a quarter of that, even in summer), booked on the energy line and offset by generators like the lifts (see [Hotels & the coffee stand](page:hotels)).

How it works: generators cover a **share of the day's lift energy bill**, at most 60 %, hour by hour; the surplus is **not sold**, so energy is never free and overbuilding is wasted money. A solar array or small hydro typically pays itself back in about **3 years**, a turbine in 2.5 to 3, biomass in about 5. Games without generators behave exactly as before.

### Eco Centre and the Eco programme

The **Eco Centre** (Energy tab, resort level 4, $20,000, $18 a day, one per resort, needs a road or footpath) opens the **Eco programme**: select it and press **Open the Eco programme**. Five policies each have a start fee, a daily running cost and a trade-off:

| Policy | Fee | Per day | Points | Trade-off |
|---|---:|---:|---:|---|
| Electric snowcats & groomers | $3,500 | $14 | +4 | running cost; saves fuel |
| Car-free village | $4,000 | $12 | +5 | slightly fewer arrivals |
| Habitat corridors & wildlife protection | $3,000 | $12 | +7 | forestry crew and fencing |
| Local produce & zero-waste kitchens | $2,500 | $8 | +4 | supplier cost; restaurants earn a little more |
| Smart snowmaking & dimmed lifts | $3,000 | $8 | +5 | controls cost more than they save at first |

Hold three policies with renewables covering at least 20 % of your energy for ten days in a row and the **carbon-neutral certificate** is yours (fee $5,000, then $5 a day while the audit runs): another 4 points and a lasting boost to arrivals. Together the programme can lift the Sustainability score by **up to 29 points**. It costs about $77 a day and roughly pays for itself, so it is a strategic choice rather than a money machine. Demolish the centre and everything pauses at no cost. Ranger Rudi suggests it when Sustainability is your weakest area.

{{fig:ui-eco-programme}}

Inspectors show **output now**, today, yesterday and the share of the bill each unit offsets. The **sustainability** facet of your rating counts the **net grid purchase per guest** (what you still buy), so generators raise it; recycling adds a few points and nursery saplings count against felled trees. Ranger Rudi suggests a Solar Array when energy is your weakest green spot. See [Events, stories & the region](page:events) for the Green Resort award.

> [!TIP] Wind turbines and solar plants work best where the sun and wind are: put turbines on the high, open ground and panels on gentle slopes, then look at the inspector to see what they really offset.
