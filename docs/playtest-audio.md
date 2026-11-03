# Playtest: proximity audio (nature, streams, Apres-Ski Bar)

**Nothing here was heard by the agent that wrote it** (no audio device): levels come from reasoned estimates and offline renders (`tests/audio/proximity.test.ts`). Please check by ear, with the ambience slider at its default (28 %) and again at 60 %. **All constants live in `src/config/audioProximity.ts` (`PROX`)**; the ambience ceilings are `AMB.layerMax` in `src/audio/Ambience.ts`.

## Checklist
1. **Apres-Ski Bar (winter, daytime or evening, bar open and serving)**: zoom in until the bar fills a good part of the screen. Polka should come in smoothly, clearly audible, with a faint crowd murmur and an occasional glass clink. Zoom out: it should fade to silence around the default view. Too quiet/loud? `apres.musicMax` (0.2), `murmurMax` (0.05), `clinkGain`. Too far-reaching? `reach` (22 tiles), `zoomFar` (34).
2. The game music should dip a little near the bar and recover when you leave (`apres.duck` 0.3, `duckTc` 0.8). If it fights the polka, raise `duck`.
3. Close the bar (or wait until after 23:00): the music must stop within a second or so. Two bars side by side: louder, but never more than the cap (`apres.cap`).
4. The polka should sound cheerful, not shrill: if the accordion is too buzzy lower `cutoffNear` (3600) or the chord peak (`0.32` in `Apres.ts` `play`); beat speed is `apres.bpm` (118).
5. **Birds / nature**: at the default zoom they should be rare and soft; zoomed in close (summer morning) they come forward as before. Tune `nature.far` (0.08), `nature.power` (2), `chirpGain` (0.8).
6. **Streams**: zoom in beside a stream or a dug river: a soft brook; faster (rapids) water should sound brighter and louder. Zoom out: silent. Winter with ice: silent. Tune `stream.zoomFar/zoomNear/reach`, ceilings `AMB.layerMax.stream` (0.17) / `rapids` (0.14), flow mix `stream.flow`.
7. Ponds / lakes: barely audible lapping only when very close (`pond.max` 0.45).
8. Mute (M), ambience slider at 0, and switching to another browser tab: everything including the polka must stop; coming back must not burst.
9. Zoom in and out with the mouse wheel: no zippering / pumping (layers ease over about 1 s).
