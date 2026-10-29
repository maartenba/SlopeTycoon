---
title: "Lifts & pistes"
order: 4
summary: "The eleven lift types, towers and clearance, planned lift maintenance, pistes and runs, grooming and snowmaking."
description: "Slope Tycoon lifts and pistes: all eleven lift types, towers and clearance rules, planned maintenance, pistes and runs, grooming and snowmaking explained."
screenshots: [ui-lifts-drawer, runs-overlay, ui-runs-tab, ui-snowmaking]
---
## Lifts

{{fig:ui-lifts-drawer}}

A lift has a **bottom station** and a **top station**. The game places towers along the line and checks that the cable is neither too steep nor too long for the chosen type.

**Tower height is capped**: a T-bar tower may be at most 35 m tall, chairs 50 m, gondolas 60 m and a cable car 100 m, and a tower may never be taller than the longer of the two spans next to it. The game prefers **more, shorter towers** over a few tall ones, and tall towers get thicker poles. If a line cannot be done within the caps you see *Towers would need to be N m tall (max M m): shorten the span, clear the forest lane or pick another route*: move a station, cut a lane through the trees, or choose a different route.

{{gen:lifts}}

- **Fixed grip** lifts (T-bar, older chairs) are cheap but slow to board. **Detachable** lifts slow down in the station, so they load faster and run faster on the line.
- **Bubble** chairs and **cabins** keep guests warm and happy, and close less often in the wind.
- Only some lifts carry **bikes**, which matters in summer.
- In Career mode the biggest lifts unlock with your resort level (see [Career & scenarios](page:career)).

### Clearance

Cables must stay clear of what's underneath: trees, roofs and other lifts. The cable needs free air under the carrier, and stations always clear the trees in the first few tiles of approach. Your options:

- **Move** the line.
- Let the game **clear a forest lane** (it charges you for the trees).
- Choose a **taller lift type**, or avoid flying over big buildings (a lodge or an apartment block is always too tall, a small shop is fine).

The error message tells you what the cable would hit, for example *Cable would hit Base Lodge*.

### Breakdowns and wind

Lifts wear out and eventually break down, and a stormy wind closes lifts that are not wind-tolerant. A **Lift Maintenance Workshop** keeps them in shape. Closed lifts show up in the news and in Ranger Rudi's advice.

### Planned maintenance

Every lift gets an **annual service**. Open **Operations → Maintenance** to see them all: the policy (**Auto** or **Manual**), a **service window** per lift, last and next service, whether a lift is **overdue**, and a 30-day cost projection.

- **Auto** (the default) services winter lifts in **April** and summer-only lifts in **October**. You can pick a different month for any lift.
- A service **closes the lift for 2 to 3 days** (basic) or **5 to 7 days** (thorough, when its inspection level is thorough). It only starts once the lift is empty, and the news announces it the day before.
- It costs money (the *maintenance* line in Finance; cheaper with a Lift Workshop, shorter and cheaper with happy crews and the *Lift mechanics* course), restores the lift's condition, resets part of its age and lowers the breakdown risk until the next one.
- Skip it (policy **Manual**, or a missed window) and the lift shows **service overdue**: the breakdown risk rises and keeps rising (more than doubled after 90 days). Ranger Rudi warns you before winter.
- The lift inspector has the same information plus a **Service now** button with the cost.

Old saves load as Auto, with the service clock starting when you load.

## Pistes and runs

Paint pistes by **difficulty**: green (easy), blue, red and black. The game colours the snow and checks:

- **Connection**: a piste only counts if it reaches a lift station, and runs that don't connect to anything are flagged. Guests need a way up *and* a way down.
- **Steepness**: a piste's real slope decides how hard it feels. A “green” painted on a cliff is still a cliff.
- **Variety**: a good resort offers all difficulties; a goal asks for runs of green, blue and red, and another for a black run.

Trails cross water and rails too: drag a hiking or MTB trail over a pond, stream or gap and a wooden hiking bridge or MTB bridge is built as part of the stroke; over rail the **Crossings** section lets you choose a level crossing or a footbridge / MTB ramp bridge ($900 / $1,100). Ski pistes stop at water and rail. See [Rails, crossings & bridges](page:rails-bridges).

> [!NOTE] **Hiking and biking trails can be painted all year**, including in deep winter: snow cover does not block them (they are just not used much until the snow melts).

### Runs

Strokes that touch are **not** one big piste. The network is split at **junctions** and **lift stations** into separate **runs**, each with its own name (*Blue Run 3*), difficulty (judged from that run's own tiles), length, vertical drop and slope. A wide piste is still one run. The names stay with a run when you extend, split or merge it, and you can rename any run in its inspector.

{{fig:runs-overlay}}

Press <kbd>O</kbd> (or use the **View** drawer) until you reach the **Runs** overlay: every run in its own colour with a label, junction and station tiles in white. The usual *Piste difficulty* overlay is unchanged.

{{fig:ui-runs-tab}}

**Operations → Runs** lists them all with level, length, drop, traffic today and this week, surface, when they were last groomed, the grooming order and the status. Click a run's name to fly to it.

- **Open / close** a run with the button in the table or the inspector. A closed run shows *Closed by you* and guests avoid it. Avalanche, wind and control closures only close the runs they touch.
- **Grooming order** per run: *Auto*, *Groom first* or *Never groom* (it is skipped in the night plan).
- **Routing**: at the top of a lift guests pick a run by how well its difficulty fits their skill, how crowded it is, its surface and their mood (unhappy skiers lean towards the easier run). Closed runs are never chosen, and nobody gets stuck if every run is closed.
- Ranger Rudi names the worst run ("Black Run 2 is icy") and shows it on the map. Goals count runs.

Old saves load with every run open and every grooming order on Auto.

### Slope profile and *Suggest a run*

While you drag a piste or place a lift a small **profile card** shows the ground as a side view: altitude over distance, coloured by difficulty tile by tile, with today's **snowline** as a dashed line, plus length, drop and the average and steepest gradient. It tells you before you pay whether a "green" run is really green and whether the bottom will be bare in warm weather.

**Suggest a run** (in the Pistes pane) highlights a line down the fall line that matches the difficulty chosen in the dock and keeps most of its length above the current snowline, with advice if the lower part may be bare. It only highlights: nothing is built or charged.

### Grooming and snow quality

Fresh snow turns bumpy and icy with traffic. **Grooming** restores it overnight. Build a **Groomer Garage** (and a **Snowcat Outpost** for far-off pistes) and the groomers work the slopes after dark. The inspector and the *Operations* drawer show how much of your piste network was groomed last night.

### Snowmaking

{{fig:ui-snowmaking}}

When natural snow is thin, build a **Reservoir** and **Snowmaking Cannons** (both under Buildings → Snow). Cannons only run when it is cold enough and the reservoir has water, and they add to your running costs. The **snowmaking overlay** (<kbd>O</kbd> cycles overlays) shows where they reach.

You decide when they run. **Operations → Lifts** has a **Snowmaking** row with a mode for the whole resort:

| Mode | What it does |
|---|---|
| **On** | The classic behaviour: cannons run whenever conditions allow. |
| **Off** | Every cannon is switched off. |
| **Auto** | Pause while the snowline is above your pistes or the daily high is above +4 °C, resume when it cools. |

*Turn all cannons off / on* is a one-click bulk switch, and every cannon has its own **On / Off** in its inspector. A switched-off cannon is **mothballed**: no energy, no water and only 15 % of its upkeep. The status line says why a cannon is idle (*Paused: snowline above this piste (1,420 m)*, *Off by you*, *Auto: waiting for cold*). Existing games default to **On**.

> [!TIP] If a piste is closed, click it. The inspector says whether it is lack of snow, an avalanche closure or no connection.
