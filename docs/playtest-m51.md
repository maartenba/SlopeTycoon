# M5.1 playtest checklist (about 15 minutes)

Start a **new 128 Normal game** (`npm run dev` or the built game). Settings are in the gear icon.

1. **Version**: Menu > About shows the current version (0.2.2).
2. **Goals**: the Goals card (right column, under the HUD) always shows a goal. Complete the first one: is there a small `+$` grant, a quiet news row, and another goal appears? Does "Show me" take the camera to the right place? Does the career wording feel light and not silly?
3. **Advice**: click the avatar / "Advice (n)" badge bottom-left. Is each suggestion sensible and correct for your resort? Try Show me and Dismiss (it should stay away for a while).
4. **Feedback, Subtle (default)**: build and sell for a few minutes at speed 2x. Calm? Only occasional `+$` popups and the odd emote bubble, no confetti except for a major milestone.
5. **Feedback, Lively**: Settings > Feedback intensity. Different (more popups, bigger puffs, a tiny camera nudge) but not noisy? Try Off: everything optional disappears.
6. **Reviews**: News > Reviews tab. After a few game days: mostly plain, informative comments, with an occasional light remark? Never a toast.
7. **Sound**: default levels. Wind and snow should no longer dominate the sfx and music. Check Ambience only still audible.
8. **Undo**: place a building, then Ctrl+Z (Cmd+Z) and the undo button in the top bar. Also bulldoze something and undo. It should refuse sensibly when it cannot (message, no crash).
9. **Text size**: Settings > Accessibility > Text size 90, 100, 130 %. Check the top bar, Goals card, news and drawer for clipping.
10. **Reduced motion**: toggle it. No confetti, no camera kick, no rising emotes.
11. **Month-end summary**: let a month end: a card appears. Turn the setting off: it stops.
12. **Recap**: save, reload, Continue. A "Welcome back" card shows cash, rating, goals and Rudi's lines. It must not appear on a new game.
13. **Narrow window** (about 1000 px wide): the Advice badge is a small corner badge and does not cover the build drawer.
14. Finally: did the game feel better or more cluttered than before? What would you remove?

## Known gaps (not bugs to report)
- The *scared* emote for bear/deer sightings is implemented but not wired.
- Goal grants appear as quiet info rows in the news, no toast.
- Audio levels were set by calculation (no audio device in automated work): your ears are the real test.
- WebGL cost of emotes/particles was not measured on a real GPU (1 draw call each).
- Minor-goal grants are small by design; year-2 balance is unchanged (grants are about 3 to 5 % of year-1 revenue).
