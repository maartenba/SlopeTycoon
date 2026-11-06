# Music

All the music in the game is here: every file was generated with Suno by the project owner and provided by the owner (owner decision, 2026-11-05). No licence is asserted beyond "owner-provided"; the files are not under a Creative Commons licence. The in-game credit line is "Music: generated with Suno."

| File | Title | Length | Size | Integrated loudness |
| --- | --- | --- | --- | --- |
| `menu-seasons-of-management.mp3` | Seasons of Management | 2:20 | 1.8 MB | -15.9 LUFS |
| `menu-seasonal-menu.mp3` | Seasonal Menu | 2:34 | 1.9 MB | -15.6 LUFS |
| `game-winter-mountain-morning.mp3` | Mountain Morning | 2:16 | 2.0 MB | -15.8 LUFS |
| `game-winter-early-slopes.mp3` | Winter Early slopes | 2:20 | 2.0 MB | -14.3 LUFS |
| `game-winter-day.mp3` | Winter Day | 2:45 | 2.4 MB | -15.4 LUFS |
| `game-winter-snow.mp3` | Winter Snow | 3:04 | 2.4 MB | -17.6 LUFS |
| `game-evening-corner.mp3` | Evening Corner | 1:00 | 0.8 MB | -16.6 LUFS |
| `game-night-melted-snow.mp3` | Melted Snow | 3:10 | 2.5 MB | -16.4 LUFS |
| `game-night-vinny-f-minor.mp3` | Vinny F Minor | 2:44 | 1.7 MB | -16.4 LUFS |
| `game-summer-meadow-loop.mp3` | Meadow Loop | 2:18 | 2.0 MB | -15.7 LUFS |
| `game-summer-pastoral-walk.mp3` | Pastoral Walk | 2:33 | 2.2 MB | -15.3 LUFS |
| `game-autumn-gentle-sway.mp3` | Autumn's Gentle Sway | 2:48 | 2.3 MB | -16.3 LUFS |
| `game-autumn-gold.mp3` | Autumn Gold | 3:09 | 2.8 MB | -16.0 LUFS |
| `game-storm-tente-restringida.mp3` | Tente Restringida | 1:00 | 0.6 MB | -17.8 LUFS |
| `game-festival-groove.mp3` | Festival groove | 2:45 | 2.4 MB | -15.8 LUFS |
| `apres-ski-hut-groove.mp3` | Ski Hut Groove | 2:30 | 2.2 MB | -16.1 LUFS |
| `apres-polka-party-time.mp3` | Polka Party Time | 2:00 | 1.7 MB | -16.5 LUFS |
| `apres-alpine-apres-ski.mp3` | Alpine Après-Ski | 2:00 | 1.7 MB | -16.1 LUFS |
| `apres-ski-brass.mp3` | Après-Ski Brass | 2:00 | 1.6 MB | -16.5 LUFS |

`menu-*` = title screen and main menu, `game-*` = the in-game music by season / time of day / weather / festival, `apres-*` = the music next to an open Apres-Ski Bar or Schirmbar.
Which file plays when, the per-track trim and the player: `src/config/audioMusic.ts` (`TRACKS`, `PLAYLISTS`), `docs/audio.md`.

Encoding (done once; the files are committed as they are): the owner's originals (~185 kbps, 63.1 MB in total) were re-encoded with `ffmpeg -i IN -map 0:a -map_metadata -1 -c:a libmp3lame -q:a 6 -joint_stereo 1 OUT` (VBR, about 115 kbps, 37.0 MB in total): cover art and descriptive tags stripped (only ffmpeg's 44-byte encoder tag remains), duration identical, integrated loudness identical (within 0.1 LU), true peak <= -2.4 dBTP. Not precached: the service worker caches a file at runtime the first time it is played. To swap a track: `docs/audio.md`, "How to swap a track".


# Sound recordings (`sfx/`)

Credit line (About dialog, `THIRD_PARTY_NOTICES.md`): "Sound recordings: CC0, mostly from Freesound (see the audio README)." Where the exact source page of a file is not recorded, the table says `Freesound (CC0)`; the rows that name OpenGameArt or Wikimedia Commons are the ones whose page is known.

`sfx/` holds the recorded sound effects and ambience loops (88 mono mp3 files, about 7.5 MB). Owner decision, 2026-11-06: a second exception to "everything but the music is generated in code". Every file is a CC0 or public-domain recording the owner picked; the game still synthesises the same sounds and plays those whenever a recording is not loaded (offline before the first cache, a failed download, `?nosamples=1`). Nothing from the unclear-provenance folder of the staging library (the Public Domain Mark radio recordings) is shipped.

Licence keys (the same strings as `src/config/audioSamples.ts`, tested in `tests/repo/sfxAssets.test.ts`): `CC0` = CC0 1.0 on the source page, `PD` = public domain on the source page, `CC0-freesound` = CC0 per the Freesound page (the owner downloaded these logged in; the owner still verifies each page, see below), `CC0-collection` = CC0 per the collection the file came from, no per-file page recorded (the Source column then says `Freesound (CC0)`; owner to verify). Only these keys are allowed; no attribution is required, the credit is given here and in the About dialog.

Encoding (done once, the files are committed as they are): mono mp3 from the cleaned staging clips. One-shots 44.1 kHz 96 kbps with 15 ms fade-in / 30 ms fade-out; long clips (avalanche, thunder) 22.05 kHz 64 kbps with a short fade-in and a 0.3 s fade-out; loops ("beds") 22.05 kHz (32 kHz for the bright ones: birds, crickets, bells) 80 kbps, no fades (the loops were crossfaded when they were cleaned). The player decodes them to PCM at the same rate, so a loop stays seamless (the encoder delay and padding are in the Xing / LAME header, which the browsers' decoders honour) and big beds cost half the memory. No tags, no cover art.

Cut notes: `mach-chairlift-squeak-01` / `-02` are two segments of Freesound 180942 (jc144940, chairlift): the real lift only starts at about 25 s of the original (squeaky wheel), so everything before is cut. `step-gravel-snowcove-01..03` come from the original flacs `Corsica_S-Walking_on_snow_covered_gravel_01..03`.

Owner to verify on the page (the manifest says "owner to verify"): all `CC0-freesound` rows (Freesound), the three `CC0-collection` rows (`thud-dull-01`, `bed-morning-01`, `avalanche-03`: the original file names are in the table) and the rows of the OpenGameArt collection "30 CC0 sfx loops" if any file of it is ever shipped (none is now).

| File | Source | Page | Author | Licence | Original clip / notes |
| --- | --- | --- | --- | --- | --- |
| `step-snow-dry-01.mp3` | OpenGameArt | https://opengameart.org/content/4-dry-snow-steps | qubodup | CC0 | snow__4-dry-snow-steps-snow-step-dry-01 |
| `step-snow-dry-02.mp3` | OpenGameArt | https://opengameart.org/content/4-dry-snow-steps | qubodup | CC0 | snow__4-dry-snow-steps-snow-step-dry-02 |
| `step-snow-dry-03.mp3` | OpenGameArt | https://opengameart.org/content/4-dry-snow-steps | qubodup | CC0 | snow__4-dry-snow-steps-snow-step-dry-03 |
| `step-snow-wet-02.mp3` | OpenGameArt | https://opengameart.org/content/9-wet-snow-steps | qubodup | CC0 | snow__9-wet-snow-steps-snow-step-wet-02 |
| `step-snow-wet-03.mp3` | OpenGameArt | https://opengameart.org/content/9-wet-snow-steps | qubodup | CC0 | snow__9-wet-snow-steps-snow-step-wet-03 |
| `step-gravel-snowcove-01.mp3` | OpenGameArt | https://opengameart.org/content/42-snow-and-gravel-footsteps | qubodup (author Corsica_S) | CC0 | gravel__42-snow-and-gravel-Corsica-S-Walking-on-snow-cove |
| `step-gravel-snowcove-02.mp3` | OpenGameArt | https://opengameart.org/content/42-snow-and-gravel-footsteps | qubodup (author Corsica_S) | CC0 | gravel__42-snow-and-gravel-Corsica-S-Walking-on-snow-cove_2 |
| `step-gravel-snowcove-03.mp3` | OpenGameArt | https://opengameart.org/content/42-snow-and-gravel-footsteps | qubodup (author Corsica_S) | CC0 | gravel__42-snow-and-gravel-Corsica-S-Walking-on-snow-cove_3 |
| `step-gravel-steps-01.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | gravel__different-steps-on-gravel |
| `step-gravel-stones-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AAssorted_gravel_rock_and_stones.ogg | stephan | PD | gravel-cm-Assorted-gravel-rock-and-stones-001 |
| `step-mud-01.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | mud__different-steps-on-mud02 |
| `step-grass-boot-01.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-001 |
| `step-grass-boot-02.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-002 |
| `step-grass-boot-03.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-003 |
| `step-grass-boot-04.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-004 |
| `step-grass-boot-05.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-005 |
| `step-grass-boot-06.mp3` | Freesound | https://freesound.org/people/fission9/sounds/521587/ | fission9 | CC0-freesound | grass-fs521587-fission9-hiking-boot-footsteps-006 |
| `step-grass-short-01.mp3` | Freesound | https://freesound.org/people/jevans27/sounds/563529/ | jevans27 | CC0-freesound | grass-fs563529-jevans27-snd-footsteps-grass-j-001 |
| `step-grass-leaves-01.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | grass__different-steps-on-leaves01 |
| `step-grass-leaves-02.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | grass__different-steps-on-leaves02 |
| `step-grass-fall-01.mp3` | OpenGameArt | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | qubodup (recorded by Fantozzi) | CC0 | grass-fantozzis-footstep-fallfantozi-002 |
| `step-wood-01.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | wood__different-steps-on-wood01 |
| `step-wood-02.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | wood__different-steps-on-wood02 |
| `step-wood-03.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | wood__different-steps-on-wood03 |
| `step-stone-01.mp3` | OpenGameArt | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 | road__different-steps-on-stone01 |
| `step-stone-02.mp3` | OpenGameArt | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | qubodup (recorded by Fantozzi) | CC0 | road__fantozzis-footstep-Fantozzi-StoneL2 |
| `step-stone-03.mp3` | OpenGameArt | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | qubodup (recorded by Fantozzi) | CC0 | road__fantozzis-footstep-Fantozzi-StoneL3 |
| `thud-dull-01.mp3` | Freesound (CC0) | no per-file page recorded in the library index; original file cm-Dull_thud.ogg | (not listed in INDEX.md) | CC0-collection | generic__cm-Dull-thud |
| `thud-step-01.mp3` | OpenGameArt | https://opengameart.org/content/footsteps-0 | GboxMikeFozzy | CC0 | generic__footsteps-0-01-footstep |
| `thud-step-02.mp3` | OpenGameArt | https://opengameart.org/content/footsteps-0 | GboxMikeFozzy | CC0 | generic__footsteps-0-02-footstep |
| `bird-partridge-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASnow_Partridge.ogg | hi:User:Somesh Tripathi | CC0 | bird-calls-cm-Snow-Partridge-001 |
| `bird-partridge-02.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASnow_Partridge.ogg | hi:User:Somesh Tripathi | CC0 | bird-calls-cm-Snow-Partridge-002 |
| `bird-partridge-03.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASnow_Partridge.ogg | hi:User:Somesh Tripathi | CC0 | bird-calls-cm-Snow-Partridge-003 |
| `bird-partridge-04.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASnow_Partridge.ogg | hi:User:Somesh Tripathi | CC0 | bird-calls-cm-Snow-Partridge-004 |
| `bird-partridge-06.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASnow_Partridge.ogg | hi:User:Somesh Tripathi | CC0 | bird-calls-cm-Snow-Partridge-006 |
| `bird-gull-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AXC707075_-_European_Herring_Gull_-_Larus_argentatus.mp3 | Sonothèque ADVL | CC0 | bird-calls-cm-XC707075-European-Herring-Gull-Larus-argentat-004 |
| `bird-night-01.mp3` | OpenGameArt | https://opengameart.org/content/birdcricketfrog-and-mosquito-sounds | Aj_ | CC0 | bird-calls__birdcricketfrog-an-birdNight |
| `bed-birds-01.mp3` | OpenGameArt | https://opengameart.org/content/ambient-bird-sounds | isaiah658 | CC0 | birds-bed__ambient-bird-sound-birds-isaiah658 |
| `bell-ding-01.mp3` | OpenGameArt | https://opengameart.org/content/bell-dingschimes | PWL | CC0 | bell-ding__bell-dingschimes-bell-ding4 |
| `bell-church-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AChurch_bells_-_Leverkusen%2C_2007.oga | natalie | PD | church-bell-cm-Church-bells-Le-2007-003 |
| `bell-cow-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ACowbell.ogg | Freddythehat at English Wikipedia | PD | cowbell-cm-Cowbell-001 |
| `bell-cow-02.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ACowbell.ogg | Freddythehat at English Wikipedia | PD | cowbell-cm-Cowbell-002 |
| `bed-cowbells-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3A457569_florianreichelt_peaceful-sound-of-a-herd-of-cows-in-the-swiss-alps.wav | florianreichelt | CC0 | cowbell-herd__cm-457569-florianreichelt-peaceful-sound-of-a-he |
| `bed-crossing-01.mp3` | Freesound | https://freesound.org/people/ondrosik/sounds/121260/ | ondrosik | CC0-freesound | crossing-bell__fs121260-ondrosik-railway-crossing-bell |
| `bed-crossing-02.mp3` | Freesound | https://freesound.org/people/mycompasstv/sounds/457125/ | mycompasstv | CC0-freesound | crossing-bell__fs457125-mycompasstv-railway-crossing-w |
| `bell-sleigh-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASleigh_bells.wav | The Midnite Wolf | CC0 | sleigh-bells-cm-Sleigh-bells-001 |
| `bell-sleigh-02.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ASleigh_bells.wav | The Midnite Wolf | CC0 | sleigh-bells-cm-Sleigh-bells-002 |
| `bed-morning-01.mp3` | Freesound (CC0) | no per-file page recorded in the library index; original file amb-morning-sounds-perfect-loop__amb_morning.ogg | (not listed in INDEX.md) | CC0-collection | ambience-outdoor__amb-morning-sounds-amb-morning-seg1 |
| `bed-brook-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AShallow_small_river_with_stony_riverbed.ogg | stephan | PD | brook__cm-Shallow-small-river-with-stony-riverbed |
| `bed-brook-02.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AWater_flowing_pouring_trickling.ogg | stephan | PD | brook__cm-Water-flowing-pouring-trickling-seg1 |
| `bed-campfire-01.mp3` | OpenGameArt | https://opengameart.org/content/fireplace-sound-loop | PagDev | CC0 | campfire__fireplace-sound-lo-fire |
| `bed-crickets-01.mp3` | OpenGameArt | https://opengameart.org/content/crickets-ambient-noise-loopable | Wolfgang_ | CC0 | crickets__crickets-ambient-n-crickets-1 |
| `bed-crowd-01.mp3` | OpenGameArt | https://opengameart.org/content/crowd-shoutingspeaking-ambience | StarNinjas | CC0 | crowd__crowd-shoutingspea-crowd-shouting |
| `leaves-rustle-01.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle01 |
| `leaves-rustle-02.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle02 |
| `leaves-rustle-03.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle03 |
| `leaves-rustle-08.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle08 |
| `leaves-rustle-09.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle09 |
| `leaves-rustle-17.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle17 |
| `leaves-rustle-18.mp3` | OpenGameArt | https://opengameart.org/content/20-rustles-dry-leaves | qubodup | CC0 | leaves__20-rustles-dry-lea-rustle18 |
| `lap-wave-01.mp3` | OpenGameArt | https://opengameart.org/content/water-waves | qubodup (transitking, Freesound 11505) | CC0 | pond-lapping__water-waves-wave-01-cc0-11505-transitking |
| `bed-rain-01.mp3` | OpenGameArt | https://opengameart.org/content/rain-loopable | Ylmir | CC0 | rain__rain-loopable-1 |
| `bed-rain-02.mp3` | OpenGameArt | https://opengameart.org/content/amb-rain-loop-1 | Kresiek The Furry | CC0 | rain__amb-rain-loop-1-amb-rain-loop-1-seg1 |
| `bed-rain-03.mp3` | OpenGameArt | https://opengameart.org/content/amb-rain-loop-2 | Kresiek The Furry | CC0 | rain__amb-rain-loop-2-amb-rain2-seg3 |
| `bed-river-01.mp3` | OpenGameArt | https://opengameart.org/content/park-ambiences | Thimras | CC0 | river__park-ambiences-park-ambience-river-seg1 |
| `bed-river-02.mp3` | OpenGameArt | https://opengameart.org/content/park-ambiences | Thimras | CC0 | river__park-ambiences-park-ambience-river-seg2 |
| `bed-rapids-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3A433589_jackthemurray_stream-river-water-up-close.wav | jackthemurray | CC0 | river-rapids__cm-433589-jackthemurray-stream-river-water-up-cl-seg1 |
| `creak-tree-01.mp3` | OpenGameArt | https://opengameart.org/content/tree-creaking | AntumDeluge | CC0 | tree-creak__tree-creaking-tree-creak |
| `bed-drips-01.mp3` | OpenGameArt | https://opengameart.org/content/dripping-water-loop | qubodup | CC0 | water-drips__dripping-water-loo-atmo |
| `bed-wind-01.mp3` | OpenGameArt | https://opengameart.org/content/wind1 | Luke.RUSTLTD | CC0 | wind__wind1-wind4-seg1 |
| `bed-wind-02.mp3` | OpenGameArt | https://opengameart.org/content/wind1 | Luke.RUSTLTD | CC0 | wind__wind1-wind5-seg1 |
| `bed-wind-gust-01.mp3` | OpenGameArt | https://opengameart.org/content/wind-whoosh-loop | SketchMan3 | CC0 | wind-gust__wind-whoosh-loop-wind-woosh-loop |
| `bed-wind-storm-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3AKilliney_Hill_Storm_Floris_20250804_1537.ogg | Karlunun | CC0 | wind-storm__cm-Killiney-Hill-Storm-Floris-20250804-1537-seg1 |
| `avalanche-01.mp3` | Freesound | https://freesound.org/people/blaukreuz/sounds/162674/ | blaukreuz | CC0-freesound | avalanche__fs162674-blaukreuz-avl05 |
| `avalanche-02.mp3` | OpenGameArt | https://opengameart.org/content/muffled-distant-explosion | NenadSimic | CC0 | avalanche__muffled-distant-ex-NenadSimic-Muffled-Distant-Exp |
| `avalanche-03.mp3` | Freesound (CC0) | no per-file page recorded in the library index; original file explosion-somewhere-far__explosion_somewhere_far.mp3 | (not listed in INDEX.md) | CC0-collection | avalanche__explosion-somewher-explosion-somewhere-far |
| `mach-chairlift-seg1.mp3` | Freesound | https://freesound.org/people/schafferdavid/sounds/419317/ | schafferdavid | CC0-freesound | chairlift__fs419317-schafferdavid-ski-resort-under-seg2 |
| `mach-chairlift-seg2.mp3` | Freesound | https://freesound.org/people/nome_diva/sounds/585385/ | nome_diva | CC0-freesound | chairlift__fs585385-nome-diva-chairlift-1-seg2 |
| `mach-chairlift-squeak-01.mp3` | Freesound | https://freesound.org/people/jc144940/sounds/180942/ | jc144940 | CC0-freesound | chairlift__fs180942-jc144940-chairlift-1 (cut 24.6-27.6 s of the cleaned file) |
| `mach-chairlift-squeak-02.mp3` | Freesound | https://freesound.org/people/jc144940/sounds/180942/ | jc144940 | CC0-freesound | chairlift__fs180942-jc144940-chairlift-1 (cut 28.6-32.0 s of the cleaned file) |
| `mach-skilift-01.mp3` | Freesound | https://freesound.org/people/indieground/sounds/223829/ | indieground | CC0-freesound | ski-lift__fs223829-indieground-remontee-mecanique |
| `mach-lifthum-01.mp3` | OpenGameArt | https://opengameart.org/content/generator-loop | YCbCr | CC0 | lift-hum-standin__generator-loop-loop-generator-1 |
| `mach-lifthum-02.mp3` | OpenGameArt | https://opengameart.org/content/defect-motor-loop | qubodup | CC0 | lift-hum-standin__defect-motor-loop-fan-interval |
| `mach-heli-01.mp3` | OpenGameArt | https://opengameart.org/content/helicopter-sfx | WuxiaScrub | CC0 | helicopter__helicopter-sfx-heli |
| `mach-snowcat-01.mp3` | OpenGameArt | https://opengameart.org/content/engine-sounds2 | pauliuw | CC0 | snowcat-idle__engine-sounds2-engine-sound |
| `mach-cannon-01.mp3` | Freesound | https://freesound.org/people/inspire153/sounds/843392/ | inspire153 | CC0-freesound | snow-cannon__fs843392-inspire153-snow-cannon-at-tall-seg1 |
| `thunder-01.mp3` | Wikimedia Commons | https://commons.wikimedia.org/wiki/File%3ARain_and_thunder.ogg | User:Caesar | PD | thunder__cm-Rain-and-thunde-1 |
| `thunder-02.mp3` | OpenGameArt | https://opengameart.org/content/rain-long-thunder | WuxiaScrub | CC0 | thunder__rain-long-thunder-rain-thunder |

Which file plays when, the trim of each file and how to swap, add or switch off samples: `src/config/audioSamples.ts`, `docs/audio.md` ("Samples").
