---
title: "Privacy & analytics – Slope Tycoon"
heading: "Privacy & analytics"
description: "How Slope Tycoon handles your data: saves stay on your device, no ads, no accounts, and anonymous usage statistics only if you choose to allow them."
order: 2
---
The short version: **no ads, no accounts, your saves stay on your device, and anonymous usage statistics only if you say yes.** Here is the longer version, in plain words.

## Anonymous statistics (opt-in)

I would like to know whether people play the game, which features get used, and where it is confusing. For that, Slope Tycoon can use **Google Analytics** to count things anonymously. **It is off until you click "Allow"** on the small bar at the bottom of the page (or in the game: Settings → Privacy). If you click "No thanks", nothing is loaded and nothing is sent to Google.

If you allow it, this is what is collected:

- **Page views** of this website and the player guide.
- **Coarse device and browser information**: browser, operating system, screen size, language and country (not your exact location).
- **Anonymous in-game events**, such as: a game was started, a level was reached, a scenario ended with a result, a feature such as photo mode or the statistics panel was used.

This is **never** collected: names, e-mail addresses, your saved games, resort names, or anything you type. There are no accounts. Google Signals and ad personalisation are switched off, and the data is not used for advertising.

Statistics are kept for the retention period configured in the Google Analytics property (a Google setting, at most 14 months for detailed data). Google acts as the processor of this data and applies its own privacy policy.

<div class="callout note"><strong class="callout-title">Note</strong><p>The analytics code is not even downloaded unless you allow it. On a local test server, in automated or headless browsers, nothing is ever sent.</p></div>

## Where your saves live

Saved games, settings and photos are stored **locally in your browser** (IndexedDB and localStorage). They are never uploaded. To move a save to another device, export a `.slope` file from Save / Load and import it there. Clearing your browser data deletes your saves, so export a backup of the ones you care about.

## Playing offline

After the first visit the game caches itself and works without a connection (it is a Progressive Web App). When you are offline, nothing is sent anywhere, so statistics simply do not happen. Offline play is not affected by your analytics choice.

## Settings

Your choice is remembered in your browser (localStorage key `slope.consent.analytics`) and is shared between this website, the player guide and the game, because they live on the same address. You can change your mind at any time:

- on this website: use **Privacy & analytics settings** in the footer of any page, or the button below;
- in the game: **Settings → Privacy**.

<button type="button" class="btn ghost" data-consent-open>Change my analytics choice</button>

<noscript><p>Without JavaScript nothing is tracked at all, and this website works as usual.</p></noscript>

Choosing "No thanks" after allowing it switches analytics off again straight away and removes the Google Analytics cookies this site set.

## Questions

Slope Tycoon is a hobby project by [Maarten Balliauw](https://github.com/maartenba). The source is available to read on GitHub; all rights reserved (see the [licence](https://github.com/maartenba/SlopeTycoon/blob/main/LICENSE)). If you have a question or want something deleted or explained, open an issue on [GitHub](https://github.com/maartenba/SlopeTycoon/issues). Read the story behind the game on the [about page](../about/).
