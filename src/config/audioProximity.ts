/**
 * Proximity / zoom audio tuning (owner feedback, Nov 2026): ONE table for every level that depends on how close the camera is.
 * Used by src/audio/proximity.ts (pure curves), Ambience.ts (mix), Apres.ts (bar music) and worldProbe.ts (sampling). Docs: docs/audio.md "Proximity audio",
 * by-ear checklist: docs/playtest-audio.md. None of it was tuned by ear (agents have no audio device): change numbers HERE.
 *
 * "zoom" = visible world height in tiles (camera.top - camera.bottom): small = zoomed in. Walk mode counts as AMB.walkZoom (6).
 */
export const PROX = {
  /** Nature one-shots + beds (birds, crickets, insects, cowbells, leaves, drips): level = far + (1 - far) * close^power, close = 0 at AMB.farZoom .. 1 at AMB.closeZoom.
   *  Before: 0.4 + 0.6 * close (birds), i.e. 0.7 at the default view. Now about 0.33 at the default view, 0.08 zoomed right out, unchanged (1.0) fully zoomed in. */
  nature: { far: 0.08, power: 2, chirpGain: 0.8 },
  /** Streams / rivers: a smooth zoom window (silent at zoomFar and beyond, full at zoomNear) x a distance falloff to the nearest stream tile. */
  stream: {
    zoomFar: 38, zoomNear: 14,
    /** Tiles from the camera target (or walker) to the nearest stream tile at which it is fully silent; level falls as (1 - d / reach)^falloff. */
    reach: 12, falloff: 1.6,
    /** [burble (brook layer), rush (rapids layer)] by flow class 0 calm / 1 brisk / 2 rapids. */
    flow: [[0.55, 0], [1, 0.3], [0.7, 1]] as ReadonlyArray<readonly [number, number]>,
    /** Frozen (global river ice): 0 = silent. */
    frozen: 0,
  },
  /** Lakes / ponds (the old `water` layer, tile fraction near the camera): very soft lapping only when zoomed in; winter ice = silent. */
  pond: { zoomFar: 30, zoomNear: 10, max: 0.45, frozen: 0 },
  /** Apres-Ski Bar music: only an OPEN, serving bar contributes. The songs, levels and hand-off with the game music live in `audioMusic.ts` (BAR_PLAYLIST, BAR_AUDIO, HANDOFF). */
  apres: {
    /** Camera -> bar distance (tiles) at which a bar is silent; per-bar level (1 - d / reach)^falloff. */
    reach: 22, falloff: 1.5,
    /** Sum of the bars' levels is capped here (several bars never get louder than this). */
    cap: 1,
    /** Zoom window: inaudible at the default view, fully there when zoomed in close. */
    zoomFar: 34, zoomNear: 12,
    /** Bar-music low-pass cutoff Hz far .. near (the hats need the top end, so near is wide open). */
    cutoffFar: 1200, cutoffNear: 9500,
    /** Murmur + glasses bed layer ceiling (AMB.layerMax.apres). */
    murmurMax: 0.05,
    /** Fixed composition seed used when no game seed is given (same song on every machine). */
    seed: 0x4a9e5,
  },
  /** Update rate of the proximity sampling: AudioApi.frame() tick period (s). 0.1 = 10 Hz. */
  tickEvery: 0.1,
} as const;
