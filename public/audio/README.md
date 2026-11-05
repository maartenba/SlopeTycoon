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
