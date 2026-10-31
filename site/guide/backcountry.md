---
title: "Backcountry & avalanche danger"
order: 5.78
summary: "Paint ski-touring routes, watch the avalanche danger scale from 1 to 5, let routes close themselves at 4, override with care, and bring in ski tourers and Powder Hounds."
description: "Slope Tycoon backcountry routes: paint a route with flag poles, read the avalanche danger rose from 1 to 5, auto-close, override, patrol and ski tourers."
screenshots: [backcountry-open, backcountry-closed, ui-marketing-powder]
---
Off the groomed runs lies the **backcountry**: powder, silence and a few people who climb up on skis to enjoy it. From **resort level 3** you can mark **ski-touring routes** on the mountain, and the game tells you, route by route, how dangerous the snow is today.

{{fig:backcountry-open}}

## Painting a route

Open **Pistes & Trails** and pick the fourth card, **Backcountry route** ($15 a tile, winter item, level 3). Paint it like a piste, but note the differences:

- A route must **start at something connected**: the top of a lift, a hut, the end of a piste or a trail. A route that touches nothing shows *Not connected to a lift, hut, piste or trail* and nobody uses it.
- It is **not a piste**: no grooming, no difficulty colour, no quality rating, and you cannot build on it. It shows as a violet dashed line with **flag poles** every few tiles. The flags carry the colour of the current danger level, and a closed route's poles get a dark cross-bar.
- It needs snow: a route with less than half of its length skiable closes with *Closed: no snow*.

Click a route in Select mode to open the **route inspector**.

## The danger scale

Every route gets an **avalanche danger level from 1 to 5**, recalculated every hour from the same snow model that drives avalanches (steep ground, fresh snow, warm spells, rain on snow):

| Level | Name | Colour |
|---|---|---|
| 1 | Low | green |
| 2 | Moderate | yellow |
| 3 | Considerable | orange |
| 4 | High | red |
| 5 | Very high | dark red |

The inspector shows a **danger rose** (a half circle of five wedges, the current level bright), the name in words, whether the route is open or why it is closed, its length, and how much of it is covered by **Ski Patrol**. The level always appears as text as well as colour.

{{fig:backcountry-closed}}

## Closing, patrol and blasting

- At **level 4 or 5 a route closes by itself** (*Avalanche danger 4*) and nobody is sent onto it. It reopens when the snow has settled a little below the level-4 line, so it will not flap open and shut.
- A **Ski Patrol Hub** nearby helps: covered slopes build up danger more slowly, and the patrol's **night control blasting** at 04:00 releases unstable covered snow safely and resets the neighbourhood. After a storm the danger falls with time, after blasting and when it warms.
- Rudi warns you when an **open route has less than half of its length under patrol cover**, and when a route is kept open at danger 4 or higher.

## Override (use with care)

The inspector has two tick boxes: **Open at danger 4+** for this route, and **All routes: open at danger 4+**. Ticking either asks you to confirm (*Open at danger 4? Burials possible; patrol required.*). Un-ticking needs no confirmation. Tourers themselves never go at danger 4 or higher, so an overridden route only draws regular off-piste skiers, and they can be caught in a slide.

> [!NOTE] **Nobody dies in Slope Tycoon.** A guest caught in a slide is buried and injured. Patrol or the rescue helicopter dig them out, or they are taken to hospital: it counts against your [safety rating](page:operations), never as a death.

## Ski tourers

From level 2, while **an open route below danger 4 exists**, a new guest type turns up in winter and spring: the **Ski tourer** (red shell, backpack, touring skis). Tourers skin up a route (after one lift ride, or straight from the base on a foot route), spend little (about $100 to $190) and love a **Mountain Hut**. When every route is closed or at 4 or higher, no tourer starts a new tour. See [Guests & seasons](page:guests-seasons).

## Powder Hounds

{{fig:ui-marketing-powder}}

The **Powder Hounds** campaign ($5,500, 10 days, winter) is aimed at tourers (+160 %) and riders (+50 %) and needs **an open backcountry route below danger 4**, an **active Ski Patrol Hub** and **a restaurant, café or mountain hut**. It is 30 % stronger on a powder day and **pauses while every route is closed**, so you never pay to send people at a closed mountain. See [Money](page:money).
