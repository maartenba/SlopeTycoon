# SEO research (M7.2, task 7.2.1)

Keyword and competitor research for slopetycoon.com, run on 2026-10-31 with the Ahrefs MCP (plan "Standard, billed monthly"). Audience: people who loved *Ski Resort Tycoon* (1999) or search for a ski management game, and browser-tycoon players. No game code was touched.

## 0. Data quality (read first)
- **The niche is tiny.** The best branded keyword, "ski resort tycoon", is **300 searches/month in the US and ~900 globally**. Everything else is 0-70. Ahrefs rounds small volumes (10, 20, 30...) and returns `null` KD for many zero/low terms. Treat the numbers as orders of magnitude.
- **Slope Tycoon has no Ahrefs footprint**: `site-explorer-metrics` for `slopetycoon.com` returned 0 organic keywords, 0 traffic. There is no baseline and no backlink data worth reading.
- **Not retrieved:** (a) `site-explorer-organic-keywords` / metrics failed to parse for `crazygames.com/t/tycoon` and `skiresortmogul.com` (empty or non-JSON answers, probably not in the index); I did not find a Ski Resort Mogul or Ski Region domain in any SERP, so no data for them. (b) `site-explorer-domain-rating` responses did not parse in my helper (SERP overview gave DR for ranking pages instead). (c) No People-also-ask text: the SERP tool exposes a `question` feature type but I did not pull it; questions below come from Ahrefs question-style matching terms plus the SERP shape. (d) No Google Trends or Search Console data; (e) NL/BE/FR/DE local-language seeds returned almost only 0-30 volumes (below).
- API units used: roughly 5,000 of the 800,000 workspace limit (checked with `subscription-info-limits-and-usage`, one call at the start).
- Volume is "monthly searches in the country"; traffic potential (TP) = estimated visits to the #1 page for the parent topic.

## 1. Seed keywords

Volumes: US unless stated. KD = Keyword Difficulty. TP = traffic potential. "g" = global volume. Intent from Ahrefs flags (almost all are informational + commercial/branded: people want to find a game).

| Keyword | US vol | g | KD | TP | Notes / SERP owner |
|---|---:|---:|---:|---:|---|
| ski resort tycoon | 300 | 900 | 3 | 40 | #1 Steam "Ski-E-O! Ski Resort Tycoon" (DR 93), then r/tycoon thread, Wikipedia (#4), iOS "Ski Resort: Idle Tycoon", Steam forum, Play Store, myabandonware. A browser game fits this SERP: nobody offers a playable web page. |
| snowtopia | 200 | 800 | 12 | 150 | Brand of a competitor. Steam (#1), itch.io page, GOG, PlayStation. Not for us to target; useful for "alternative to" pages. |
| free tycoon games | 400 | 600 | 30 | 350 | CrazyGames /t/tycoon (DR 83, 2.9k traffic), Poki, Coolmath, 1001games, itch.io tag page, r/tycoon threads. Collection pages dominate. |
| ski resort tycoon 2 | 60 | 200 | 0 | 20 | Parent "ski resort tycoon ii" (the 2000s sequel). Nostalgia query. |
| snow mogul | 70 | 100 | 3 | 800 | Misread: SERP is about *mogul skiing* (Wikipedia, REI). **Not a game keyword. Ignore.** |
| ski resort game | 30 | 90 | 2 | 30 | Steam Ski-E-O #1, Reddit threads, powder.com "new ski resort simulator game launched free" (DR 72). |
| ski resort simulator | 30 | 150 | 3 | 30 | Parent "winter resort simulator". Steam Winter Resort Simulator 1/2, Snow Resort Simulator, powder.com article. |
| tycoon games browser | 30 | 70 | 25 | 4,100 | CrazyGames, itch.io web tag, SimCompanies, r/tycoon. TP 4,100 = the "tycoon games" head topic. |
| resort tycoon | 20 | 70 | 0 | 0 | Parent "tropical resort tycoon". Mostly Tropico/Rollercoaster-like; skip. |
| ski resort mogul | 10 | 30 | - | - | Low interest. Nobody notable ranks in what I retrieved. |
| ski tycoon game | 10 | 10 | - | - | Same as "ski tycoon" (30). |
| ski lift game | 10 | 10 | - | - | Dead term. |
| mountain resort tycoon, snow tycoon, build a ski resort game | 0 | 0 | - | - | No measurable demand. Use as natural wording only. |
| summer ski resort game, theme park tycoon browser, ski resort tycoon browser/free | 0-10 | 0-10 | - | - | Below the noise floor in Ahrefs. "ski resort tycoon download" 10. |

Countries for "ski resort tycoon" (volume by country): US 300, **NL 70**, CA 60, PL 50, **FR 50**, GB 40, **DE 40**, SE 20, AT 20, BE 20, ES 20, AU 20. DE/NL/FR local-language seeds were nearly empty: "skigebiet simulator" 20 (DE), "tycoon spiele kostenlos" 20 (DE), "tycoon spel" 10 (NL), "wintersport spel" 10 (NL), "jeu de gestion gratuit" 80 (FR, KD 5, TP 250), "jeu de gestion navigateur" 30 (FR, KD 0, TP 350). A localized site is **not** justified; English with the right words is enough.

## 2. Related terms and clusters

### A. Ski-management game (brand-adjacent, our core)
| Keyword | Vol (US) | KD | Note |
|---|---:|---:|---|
| ski resort tycoon | 300 | 3 | core |
| ski resort tycoon 2 / ii | 60 / 30 | 0-1 | nostalgia |
| ski simulation game | 90 | 3 | |
| ski resort simulator | 30 | 3 | |
| ski resort game | 30 | 2 | |
| ski resort manager game, ski resort builder game, my ski resort tycoon, ski resort tycoon 3 | 10-20 | - | long tail suggestions |

### B. "Browser / free tycoon" (volume sits here, KD is real)
| Keyword | Vol | KD | TP |
|---|---:|---:|---:|
| best tycoon games | 1,300 | 0 | 2,500 |
| free tycoon games | 400 | 30 | 350 |
| browser tycoon games | 70 | 3 | 2,000 |
| tycoon game online | 60 | 23 | 2,700 |
| tycoon browser games | 50 | 5 | 3,800 |
| tycoon games browser | 30 | 25 | 4,100 |
| roller coaster tycoon browser / free online | 20 | 65 | 9,400 |
| what is a tycoon game | 100 | 31 | 100 |
| best tycoon game | 80 | 0 | 1,100 |

The SERP is collection pages (CrazyGames, Poki, Coolmath, itch.io tags) and r/tycoon threads ("browser based tycoon games", "any good free online tycoons"). A single game site will not outrank them, but a **"best browser tycoon games" list page that honestly includes Slope Tycoon** could, plus Reddit participation.

### C. Ski/lift educational long tail (informational, KD about 0)
| Keyword | Vol | KD | TP |
|---|---:|---:|---:|
| how to use a ski lift | 700 | 0 | 80 |
| ski lift types | 100 | 0 | 0 |
| what is a ski lift called | 150 | 1 | 150 |
| how does a ski lift work | 80 | 0 | 450 |
| what is a ski lift | 60 | 1 | 700 |
| how much does a ski lift cost | 70 | 5 | 0 |
| how much are ski lift tickets | 60 | 12 | 1,800 |
| ski slope game | 40 | 0 | 700 |
| ski game (classic, e.g. the Windows Yeti game) | 2,800 | 18 | 350 |
| ski free game | 700 | 34 | 5,100 |
| downhill ski game | 350 | 30 | 2,100 |
| ski game online | 150 | 0 | 600 |

Cluster C is the largest *reachable* audience for guide-style pages: people curious about how lifts work are a good fit for a game that models twelve lift types. "ski game" / "ski free game" are arcade/nostalgia intent (SkiFree), not management, so keep them as secondary mentions only.

### D. Competitor / alternative terms
- "snowtopia" (200), "ski-e-o", "skingdom" (a ski-resort tycoon with a Steam demo, Reddit and Kickstarter presence), "winter resort simulator" (Steam), "ski resort idle tycoon" (mobile).
- Not retrieved: "ski resort mogul" produced no useful SERP.

## 3. SERP landscape and competitors
- **Ski-E-O! Ski Resort Tycoon (Steam, app 4493130)**: #1 for ski resort tycoon / ski resort game; DR 93 page, about 135 est. visits/month, 85 referring domains. New (2026) and heavily promoted on Reddit and YouTube.
- **Skingdom** (Steam demo, Kickstarter, r/skiing + r/tycoon launch threads): shows that Reddit launch posts *do* rank (three Reddit/news results sit in the top 10 for "ski resort tycoon").
- **Snowtopia (Steam, itch.io, GOG, PlayStation)**: 90 visits/month on Steam for "snowtopia", KD 12. The itch.io page ranks #6 for its name. Its own site (snowtopia.com.au) is a different business (DR 0).
- **Ski Resort Tycoon (Wikipedia)**: #4 for the head term, about 24 est. visits. A *See also* link is not appropriate for a proprietary hobby game; do not spam.
- **Winter Resort Simulator 1/2, Snow Resort Simulator** (Steam): the "simulator" SERP.
- **powder.com article "New ski resort simulator game launched free"**: shows editorial ski sites cover free ski games (DR 72). A good outreach target type (see section 8).
- **Mobile**: "Ski Resort: Idle Tycoon" (App Store, DR 97) and "Ski Resort Empire" (Play).
- **Browser tycoon collections**: crazygames.com/t/tycoon (DR 83, 2.9k traffic), coolmathgames (1.2k), poki.com/en/tycoon (873), 1001games, itch.io tag pages, SimCompanies (1.7k), jamango.io (DR 23, 87). The only real DR-low entrants rank on weakly competitive terms, so DR is not a barrier on cluster A.
- **Ski Resort Mogul, Ski Region, Snow Mogul**: no ranking domains found. "Snow mogul" is a skiing-technique SERP. I could not obtain a competitor site profile for these.
- **Own site**: 0 keywords, 0 traffic, no data in Ahrefs (new domain).

### Content gaps (what the field does not offer)
1. **No playable-in-browser ski tycoon page** for "ski resort tycoon" (Steam, Wikipedia, mobile apps own it). A page that says *play now, free, no download* for that head term is a clear gap.
2. **Nostalgia: "ski resort tycoon 2" / "like Ski Resort Tycoon"** has a Reddit thread at #2 ("I would really like to play ski resort tycoon again"), and Skingdom's launch post. A "games like Ski Resort Tycoon" page answers exactly that intent.
3. **No game site explains ski-lift basics** (cluster C); Wikipedia and ski blogs do, but not in a "build it yourself" frame.
4. **Seasonal story (summer + winter):** no ranking competitor markets a four-season mountain resort; but there is no search demand for it either (0-10), so use it as a differentiator in copy rather than as a target.
5. **Offline PWA / free / no accounts** is a differentiator for "browser tycoon" lists.

## 4. KEYWORD MAP (page <-> keywords)

| Page | Primary | Secondary |
|---|---|---|
| `/` landing | ski resort tycoon (300), ski resort game | free tycoon game in your browser, ski resort simulator |
| `/play/ski-resort-tycoon/` (NEW 1) | ski resort tycoon, ski resort tycoon online | ski resort tycoon free, play ski resort tycoon, ski resort tycoon 2 |
| `/games-like-ski-resort-tycoon/` (NEW 2) | games like ski resort tycoon, ski resort tycoon alternatives | ski resort tycoon 2, snowtopia alternative, ski resort simulator |
| `/browser-tycoon-games/` (NEW 3) | best browser tycoon games, free tycoon games, tycoon games browser | tycoon game online, no download |
| `/how-ski-lifts-work/` (NEW 4) | how does a ski lift work, ski lift types | what is a ski lift called, how to use a ski lift |
| `/summer-mountain-resort-game/` (NEW 5, optional) | summer resort game (near zero demand: use as a brand page, low priority) | mountain bike park, campground, quad, rafting |
| `/guide/` index + pages | long tail (below) | |
| `/guide/lifts-pistes/` | ski lift types, how does a ski lift work | gondola, chairlift, T-bar |
| `/guide/getting-started/` | how to make money ski resort tycoon, how to start a ski resort game | beginner guide |
| `/guide/money/` | how to make money ski resort tycoon | ticket prices, marketing, loans |
| `/guide/operations/` | avalanche control game | ski patrol, grooming, wildlife |
| `/guide/backcountry/` | avalanche danger scale game | ski touring |
| `/guide/summer*.md` | summer resort game | campground, rafting |
| `/guide/troubleshooting/` | FAQ (FAQPage) | |
| `/devlog/` (+ posts from CHANGELOG) | brand, long tail: "slope tycoon update", "ski resort tycoon devlog" | |
| `/about/` | slope tycoon, maarten balliauw (brand) | |

Rationale: only cluster A and the list pages have any demand. New pages 1-3 are the realistic wins; page 4 is an informational magnet; page 5 is a brand page.

## 5. New landing pages (proposed)

Titles are under 60 characters; descriptions 120-155. Do not invent a developer story (D7-10): use `site/pages/about.md` and a TODO.

### 5.1 `/play/ski-resort-tycoon/` (alias intent: play now)
Note: the game itself lives at `/play/`; avoid a path under `/play/` (it is the app scope and the service worker). Use **`/ski-resort-tycoon/`** instead.
- **URL**: `/ski-resort-tycoon/`
- **Title** (50): `Ski Resort Tycoon in Your Browser – Play Free`
- **Meta** (150): `Slope Tycoon is a free ski resort tycoon you play in your browser: shape the mountain, build lifts and pistes, run all four seasons. No download.`
- **H1**: Play a ski resort tycoon in your browser
- **Targets**: ski resort tycoon, ski resort tycoon online/free, play ski resort tycoon
- **Outline**: hero + Play button; what you do (lifts, pistes, guests, seasons) with 3 real screenshots; "if you remember the 1999 Ski Resort Tycoon" paragraph (honest: not affiliated; do not use their name as a logo); feature list (offline, no accounts, free, saves on device); FAQ (5 questions, FAQPage); link to guide + games-like page.
- **Internal links**: `/`, `/play/`, `/guide/getting-started/`, `/games-like-ski-resort-tycoon/`, `/about/`.

### 5.2 `/games-like-ski-resort-tycoon/`
- **Title** (52): `Games Like Ski Resort Tycoon: Ski Management Picks`
- **Meta** (153): `Looking for a game like Ski Resort Tycoon? An honest list of ski resort builders: Snowtopia, Ski-E-O, Skingdom, Winter Resort Simulator and Slope Tycoon.`
- **H1**: Games like Ski Resort Tycoon
- **Targets**: games like ski resort tycoon, ski resort tycoon 2, snowtopia alternative, ski resort simulator
- **Outline**: short intro on the 1999 classic; a table (platform, price, view, seasons, link) with **Steam titles linked out as plain links**; where Slope Tycoon fits (browser, free, no download); who each game suits; FAQ. Must be neutral and factual: no claims about competitors that I cannot support. Verify each game's details before publishing (store pages change).
- **Internal links**: `/ski-resort-tycoon/`, `/browser-tycoon-games/`, `/guide/`.

### 5.3 `/browser-tycoon-games/`
- **Title** (50): `Best Free Browser Tycoon Games (No Download)`
- **Meta** (150): `The best free tycoon games you can play in a browser tab, from park and city builders to a ski resort sim. Slope Tycoon is the one that runs offline.`
- **H1**: Free tycoon games in your browser
- **Targets**: best browser tycoon games, free tycoon games, tycoon games browser, tycoon game online
- **Outline**: criteria (no download, no signup, works on laptop); 8-12 games with one honest paragraph each (include Slope Tycoon, flagged as ours; verify the others before listing; candidates from SERP: CrazyGames, Poki, itch.io tag page, SimCompanies, jamango); a comparison table; link to the itch.io tag listing of tycoons; FAQ ("what is a tycoon game").
- **Internal links**: `/ski-resort-tycoon/`, `/`, `/guide/getting-started/`.
- **Expectation**: competes with DR 80+ collection pages. Realistic aim: rank for long tail ("browser tycoon games" KD 3, 70 searches) and Reddit-style queries, not "free tycoon games".

### 5.4 `/how-ski-lifts-work/`
- **Title** (46): `How Ski Lifts Work: Chairlift, Gondola & T-Bar Types`
  (52 chars; if site style prefers shorter use `How Ski Lifts Work: Types Explained`, 36.)
- **Meta** (150): `How does a ski lift work? Detachable chairs, gondolas, T-bars and cable cars explained simply, plus how to build every type in Slope Tycoon.`
- **H1**: How ski lifts work
- **Targets**: how does a ski lift work (80), ski lift types (100), what is a ski lift (60), what is a ski lift called (150), how to use a ski lift (700 - add a short "riding a lift for the first time" section)
- **Outline**: the 12 lift types in the game (verify list against `site/guide/lifts-pistes.md`), plain-language mechanics (grip, tower, loading), capacity and why detachable is faster, first-time rider tips, link to the guide and the game. No game claims beyond what the guide says.
- **Internal links**: `/guide/lifts-pistes/`, `/ski-resort-tycoon/`, `/guide/glossary/`.

### 5.5 `/summer-mountain-resort-game/` (optional, brand page)
- **Title** (50): `Summer Mountain Resort Game – Bikes, Camps & Rafting`
- **Meta** (150): `Slope Tycoon is not just winter: run a mountain resort in summer with bike trails, campground, rafting, quads and a petting zoo. Free in your browser.`
- **H1**: A mountain resort game for summer, too
- **Targets**: summer ski resort game, summer resort game (near-zero volume; this is a differentiator and a landing page for social/Reddit links)
- **Outline**: summer buildings with screenshots, the four-season loop, link to the summer guide pages.
- **Internal links**: `/guide/summer/`, `/guide/summer-adventures/`, `/ski-resort-tycoon/`.
- **Priority**: lowest; only if screenshots already exist.

## 6. Existing pages: titles and descriptions

Current: landing title `Slope Tycoon – Ski & mountain resort tycoon game` (49, good). Current landing description (`DESC`, 157) is slightly over 155; shorten.

- **Landing**: Title `Slope Tycoon – Free Ski Resort Tycoon Game in Your Browser` (56). Meta (153): `Build your own ski resort in the browser: shape terrain, place lifts, groom pistes and run it through all four seasons. Free, offline, no account.` H1 can stay; the hero sub-line should contain "ski resort tycoon" once.
- **Guide index**: `Slope Tycoon player guide – tips, controls, seasons` (50) is fine; mention "ski resort tycoon" in the description.
- **Getting started**: title `How to start your first ski resort – Slope Tycoon guide`; description already good. Add an H2 "How to make money" with a link to the money page (the query "how to make money ski resort tycoon" is the long tail).
- **Lifts & pistes**: title `Ski lift types and pistes – Slope Tycoon guide`.
- **Money**: title `Money: prices, marketing & loans – Slope Tycoon guide`.
- **Operations**: `Ski patrol, avalanches & lift safety – Slope Tycoon`.
- **Troubleshooting**: keep; add FAQPage markup.
- **About**: fine ("why I built a ski resort game"). Keep the placeholder and TODO; no invented story.
- Other guide titles are descriptive and under 60; leave them.
- Every page title already ends in "Slope Tycoon"; the brand is not a search term yet (0 volume), so put the descriptive words first (as above), the brand second.

## 7. FAQ questions to add (landing + new pages + guide)
Source: question-style terms and the SERP shape (Reddit threads, Steam). Answers must be factual (check each against the game before writing).
1. Is there a ski resort tycoon game you can play in the browser?
2. Is Slope Tycoon free? Do I need to download or create an account?
3. Does it work offline? (installed PWA)
4. Can I play it on a phone or tablet? (touch support exists, `docs/touch.md`; the phone layout is still being improved in M7.5)
5. Is it like the original Ski Resort Tycoon (1999)? (say it is an independent game; do not claim affiliation)
6. How do I make money in a ski resort tycoon? (prices, marketing, avoid debt)
7. What kinds of ski lift are in the game?
8. Does the game have summer? Do I have to build in winter?
9. Where are my saves stored?
10. What data do you collect? (consent-first, anonymous)
11. How does a ski lift work? / What is a ski lift called? (page 5.4)
12. What is a tycoon game? (page 5.3)

## 8. Structured data ideas
Already present: `VideoGame` + `WebApplication` (landing), `WebSite`, `BreadcrumbList`, `AboutPage`, `WebPage`.
- **FAQPage** on landing, 5.1, 5.4 and troubleshooting (visible FAQ text must match the markup; Google shows FAQ rich results only for few sites, so treat it as a clean-structure benefit, not a ranking promise).
- **Article** (or `BlogPosting`) for devlog posts, with `datePublished` from the CHANGELOG date and `author` = existing Person.
- **ItemList** on the "games like" and "browser tycoon" pages, listing the entries.
- **HowTo** only for step-by-step pages (getting started); optional.
- **BreadcrumbList** on all new pages (already generated for guide pages; extend to the new paths).
- Keep `VideoGame` honest: `offers.price 0`. Add `inLanguage: en`, `gamePlatform: Web browser` if missing. No review/rating markup (we have no reviews).
- `site:check` JSON-LD validity checks already exist (`scripts/site/crawl.ts`); extend with FAQ text matching visible text if possible.

## 9. Backlinks and outreach (hobby-appropriate, no spam)
Realistic, owner-driven, one post each, honest tone, **no AI-generated mass posting**:
1. **itch.io page** (web game embed or a "play on the website" link): itch is DR 92 and ranks for "snowtopia" and tycoon tag pages (itch.io/games/free/tag-tycoon). Check `docs/deploy.md` for what hosting means for the proprietary licence before uploading. The itch page links back (nofollow likely, but the SERP presence is real).
2. **Reddit**: r/tycoon (the "ski resort tycoon" and "browser based tycoon games" threads rank on page 1 in Google), r/skiing (launch posts like Skingdom's rank), r/WebGames, r/incremental_games is not a fit. Follow each sub's self-promotion rules; participate, do not drop links. Reply to the existing r/tycoon threads "I would really like to play ski resort tycoon again" and "browser based tycoon games" only if the thread allows self-promo and say you are the developer.
3. **Hacker News "Show HN"**: fits (procedural everything, no assets, PWA). One post, a technical angle, not marketing.
4. **Product Hunt**: optional; low relevance for games, small effect.
5. **AlternativeTo**: list as an alternative to Ski Resort Tycoon / Snowtopia; free listing.
6. **IndieDB, Game Jolt**, **GameFAQs/RPS-style small blogs**: submit once.
7. **Ski editorial sites** (powder.com covered a free ski game, DR 72): a short, honest email pitch with a link and a screenshot. Low odds, no cost.
8. **Wikipedia**: do **not** edit the Ski Resort Tycoon article to add us (conflict of interest, promotional). Only if a reliable third party writes about the game.
9. **Steam**: not applicable (browser PWA, no store listing planned).
10. **Credit/press kit page** (`/press/`): logo, screenshots, facts (cheap, helps every pitch).

## 10. Realistic traffic expectations
- Total addressable *branded-niche* demand is about **1,000 searches/month globally** across all ski-tycoon terms; the US head term is 300. A new domain with a good page might capture 20-40 % of the clicks on clusters A in 6-12 months: **roughly 30-150 organic visits/month**.
- Cluster B (free/browser tycoon lists) has 1,000+ monthly searches with TP in the thousands, but is held by DR 80+ domains: expect **under 20 visits/month** from it in year one unless Reddit and itch.io listings carry it.
- Cluster C (lift explainers) has KD about 0, with TP of a few hundred. A good page might bring **20-100 visits/month**, mostly not players; conversion to play maybe 5-10 %.
- **Most players will come from Reddit, itch.io, Hacker News and word of mouth, not Google.** Consider SEO a slow baseline plus correct metadata for shared links (OG cards already exist).
- Nothing here justifies paid ads, a blog engine or localisation.

## 11. Prioritised action list for the website worker (7.2.2-7.2.5)
1. **(7.2.2) Metadata pass** (cheap, certain): new landing title/description (section 6), shorten `DESC` to <= 155 chars, put "ski resort tycoon" once in the hero sub-line and once in an H2; update guide titles (lifts, money, operations, getting started). Re-run `site:og` for changed cards.
2. **(7.2.2) Landing page 5.1 `/ski-resort-tycoon/`** (highest value: the head term, KD 3) + FAQPage on landing and on it.
3. **(7.2.3) 5.4 `/how-ski-lifts-work/`** (educational, largest reachable long tail; reuse guide content) and add "How to make money" H2 linking from getting started.
4. **(7.2.3) 5.2 games-like page** (nostalgia/alternative intent; verify every competitor fact; neutral tone).
5. **(7.2.4) Devlog** generated from CHANGELOG highlights (Article markup, dates from the changelog); link to it from the footer.
6. **(7.2.4) 5.3 browser-tycoon-games page** (lower odds; only after 1-4).
7. **(7.2.5) FAQ extension, sitemap entries, internal links** (guide <-> new pages), BreadcrumbList for new paths, `site:check` rules (title < 60, meta 120-155, one H1).
8. **Optional**: 5.5 summer page; `/press/` kit.
9. **Owner tasks**: itch.io page, Reddit post(s), Show HN, AlternativeTo listing (section 9). Provide copy in `docs/` only if the owner asks.
10. Re-run this research in 3 months with `site-explorer-organic-keywords` for slopetycoon.com once it has data (appendix).

Constraints to respect (AGENTS.md): no external requests besides the allowed hosts (plain outbound links to Steam / itch.io are links only, not requests); no sharing features; sponsor link wording unchanged; never say "open source"; never "1.0"; after any site change run `npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site`.

## Appendix: Ahrefs calls that worked (repeat the research)
All via `execute`, `tools.ahrefs[...]`, after `search({ namespace: 'ahrefs', query: ... })`. Read `tools.ahrefs.doc({ tool: '<name>' })` first. Quirks: results can arrive as a **string** (JSON followed by "Display these results with ..." and an `apiUsageCosts` line). Cut at the first `"\n}\n"` and `JSON.parse` it. Filters (`where`) are JSON strings; `select` is a comma-separated string.

- `subscription-info-limits-and-usage({})`: units limit/usage.
- `keywords-explorer-overview({ select: 'keyword,volume,difficulty,traffic_potential,intents,parent_topic,global_volume', country: 'us', keywords: 'a,b,c' })`: about 52 units per row; ~15-row batches for each of us, gb, de, nl, fr. `country` is required.
- `keywords-explorer-volume-by-country({ keyword: 'ski resort tycoon', limit: 12 })`.
- `keywords-explorer-matching-terms({ select, country, keywords: 'a,b', limit: 40, order_by: 'volume:desc', where: '{"or":[{"field":"keyword","is":["iphrase_match","tycoon"]}, ...]}' })`: a broad seed like "ski resort" returns resort names (noise); filter with `where`. A `prefix` filter on "how/what/best/is/can" gave the question list.
- `keywords-explorer-search-suggestions({ select, country, keywords, limit, order_by })`, `keywords-explorer-related-terms(...)` (noisy for generic words, "game", "app store").
- `serp-overview({ select: 'position,title,url,domain_rating,traffic,page_type,type', keyword, country: 'us', top_positions: 10 })`: `type` filter `organic` returned nothing for me; omit it and filter `type` includes organic client-side. Drop `google.com/search` urls.
- `site-explorer-metrics({ target, date: 'YYYY-MM-DD', mode: 'subdomains'|'exact', country })` (date and target required).
- `site-explorer-organic-keywords({ select: 'keyword,best_position,volume,sum_traffic,best_position_url', target, mode, date, country: 'us', limit, order_by: 'sum_traffic:desc' })`: worked for Steam, Wikipedia and powder.com pages; produced a non-JSON answer for crazygames.com/t/tycoon and skiresortmogul.com (probably no data).
- Not used but available: `site-explorer-organic-competitors`, `site-explorer-top-pages`, `site-explorer-domain-rating`, `site-explorer-referring-domains`, `keywords-explorer-volume-history`, `management-*` (Rank Tracker projects). Next time, add slopetycoon.com as a project to track the keywords in section 4.

## 12. Implementation status (M7.2, tasks 7.2.2 to 7.2.6)

Built on 2026-11-01. Everything is generated by the site pipeline (`site/README.md`) and covered by tests in `tests/site/`.

| Recommendation | Status |
|---|---|
| New landing title / description, `DESC` under 155 | **Done.** Landing title `Slope Tycoon – Free Ski Resort Tycoon Game in Your Browser` (56), new description (146). |
| `ski resort tycoon` once in the hero line and an H2 | **Done.** H1 "Slope Tycoon: a ski resort tycoon in a browser tab"; the H2 is on `/ski-resort-tycoon/`. |
| Guide titles (getting started, lifts, money, operations) | **Done** with the `seo:` front matter field (nav titles unchanged). Guide index description mentions "ski resort tycoon". |
| "How to make money" H2 on getting started | **Done** (renamed from "Money tips"). |
| 5.1 `/ski-resort-tycoon/` (not under `/play/`) | **Done.** |
| 5.2 `/games-like-ski-resort-tycoon/` | **Done.** Competitors are named and described from what their own pages say, **not linked** (only Wikipedia and GitHub links are allowed by the privacy rules); ItemList markup. |
| 5.3 `/browser-tycoon-games/` | **Done**, kept modest: it describes where to find browser tycoons (portals, itch.io, online economy games) and Slope Tycoon, without naming a ranked top ten. |
| 5.4 `/how-ski-lifts-work/` | **Done** (Article markup, FAQPage, first-ride tips, the twelve lift types). |
| 5.5 `/summer-mountain-resort-game/` | **Done.** |
| FAQPage on landing and the new pages | **Done**, rendered from the same data as the visible list. Troubleshooting is **not** converted (it is prose, not Q and A). |
| Article markup on devlog posts | **Done** (BlogPosting, `datePublished` from the CHANGELOG date). |
| ItemList on list pages, BreadcrumbList on all new paths | **Done.** |
| Devlog from the CHANGELOG | **Done**: `/devlog/`, 12 posts (0.1.0 to 0.3.1), Atom feed, test that fails when a released version has no post. |
| Sitemap with every new page and `lastmod`; robots | **Done** (`sitemapEntries`, tested). |
| Internal links guide <-> landing pages, footer "Read more" column | **Done.** |
| `/press/` kit | **Not done** (optional). |
| Outreach (itch.io, Reddit, Show HN, AlternativeTo) | **Owner task.** Drafts in `outreach-drafts.md`. |
| Re-run the research in 3 months | **Owner / later.** |

## 13. Design brief and result ("feel human-made")

**Before** (`.weave/shots/seo-before-landing-*.png`): a full-bleed five-image crossfade hero with the logo, a centred slogan ("Build the ski resort of your dreams."), a row of badges, then a strip of 13 number tiles ("12 real months", "N summer attractions"), three-step cards, a seven-card "Only here" grid and an "Offline, private and adjustable" grid: every section a card grid of the same weight.

**Brief.** One honest line in the owner's voice, a real screenshot next to it (not behind it), then a rhythm that changes from section to section: prose beside two screenshots of different sizes, a single pull quote from the owner's own story with a small line-drawn ridge, an asymmetric season collage with captions written like dev notes, alternating text and image rows with different column ratios, a plain "Things I like / Things I'm still fixing" list, gallery and FAQ. Keep the dark theme, Nunito and Lilita One (headings less often and smaller), 44 px targets, reduced motion, sized images with lazy loading.

**After** (`.weave/shots/seo-after-landing-*.png` and `seo-*` page shots): the number strip, the card grids, the slideshow and the badge row are gone. The hero is a two-column layout with the winter shot and a handwritten-style caption. Nothing animates. The only illustration is the inline SVG ridge line (aria-hidden). Landing CSS and JS stay far below the 150 kB budget.
