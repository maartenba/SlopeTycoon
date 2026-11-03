import type { MusicInput } from './musicState';
import type { TrackId } from './musicThemes';

/** A game state in which each track is the best fit (used by the offline tests, `npm run audio:render` and `npm run audio:export`). */
export const TRACK_CONTEXT: Record<TrackId, Partial<MusicInput>> = {
  morningSnow: { season: 'winter', hour: 8, weather: 'clear' }, alpineNoon: { season: 'winter', hour: 13, weather: 'clear', busy: 0.8 }, apres: { season: 'winter', hour: 19, weather: 'clear' },
  starlight: { season: 'winter', hour: 23, weather: 'clear' }, summerMeadow: { season: 'summer', hour: 12, weather: 'clear', busy: 0.6 }, autumnGold: { season: 'autumn', hour: 15, weather: 'clear' },
  blizzard: { season: 'winter', hour: 12, weather: 'storm' }, title: { menu: true, screen: 'title' }, festival: { season: 'summer', hour: 14, festival: true, busy: 1, weather: 'clear' },
  snowPiano: { season: 'winter', hour: 14, weather: 'snow' }, nightChill: { season: 'winter', hour: 22, weather: 'clear' }, menu: { menu: true, screen: 'menu' },
};
