# Menu music

The two files here are the main-menu music, generated with Suno by the project owner and provided by the owner (owner decision, 2026-11-05). No licence is asserted beyond "owner-provided"; they are not under a Creative Commons licence.

| File | Title | Length | Integrated loudness |
| --- | --- | --- | --- |
| `menu-seasons-of-management.mp3` | Seasons of Management | 2:20 | -15.9 LUFS |
| `menu-seasonal-menu.mp3` | Seasonal Menu | 2:34 | -15.6 LUFS |

The mp3 audio stream is the original one (copied, not re-encoded; cover art and tags stripped with `ffmpeg -map 0:a -c:a copy -map_metadata -1`). Played by `src/audio/MenuMusic.ts`; table and per-track trim: `MENU_MUSIC` in `src/config/audioMusic.ts`. Not precached: the service worker caches them on first play (`docs/audio.md`, "Menu music"). Everything else in the game is procedural.
