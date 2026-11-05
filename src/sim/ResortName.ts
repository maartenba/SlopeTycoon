import { SCHIRMBAR } from '../config/schirmbar';

/**
 * The resort name (M7.8, docs/schirmbar.md): shown on the Schirmbar banner, in the HUD / pause menu / year report and as the photo file name.
 * Pure: a deterministic default from the seed (no Rng draw) and one sanitiser every entry point (New Game field, URL, Settings, save) goes through.
 */
export const RESORT_NAME_MAX = SCHIRMBAR.nameMax;

/** Curated, pleasant, invented resort names (Alpine, French, Italian, Nordic, English). Append-only keeps old seeds stable; never real resorts. */
export const RESORT_NAMES: readonly string[] = [
  'Alpenglow', 'Silberhorn', 'Sonnenalm', 'Val Clair', 'Monte Rosina', 'Hinterkogel',
  'Edelweiss Hollow', 'Nordkamm', 'Pine Ridge', 'Goldkar', 'Schneeblick', 'Eisenkamm',
  'Bärenalm', 'Rauhtal', 'Vorderjoch', 'Gamsblick', 'Kronenalm', 'Fichtenhain',
  'Lärchenhang', 'Almrausch', 'Morgenrot', 'Silbertal', 'Sonnenhang', 'Birkenfeld',
  'Tannenblick', 'Edelalm', 'Firnwald', 'Gipfelruh', 'Hochnebel', 'Zirbenhof',
  'Steinadler', 'Murmeltal', 'Schneerose', 'Winterhorn', 'Kristallkar', 'Sonnjoch',
  'Weissenkamm', 'Val Argent', 'Les Mélèzes', 'Mont Blanchet', 'Col des Aigles', 'Val Doré',
  'Pic Lumière', 'Les Cimes Claires', 'Belle Neige', 'Mont Sérénité', 'Val Perle', 'Crêt du Soleil',
  'Les Sapins', 'Col Rosé', 'Monte Rosina Alta', 'Valle Serena', 'Cima Bella', 'Passo Aurora',
  'Monte Argento', 'Val Chiara', 'Campo Sereno', 'Pian dei Larici', 'Monte Lume', 'Borgo Neve',
  'Cima Dorata', 'Valle dei Cervi', 'Sella Alta', 'Fjellro', 'Snøtind', 'Nordlys Dal',
  'Frostvik', 'Björnåsen', 'Skogsfjell', 'Blåfjell', 'Vintervik', 'Norrsken',
  'Stjärnfjäll', 'Isdalen', 'Granliden', 'Pine Ridge Lodge', 'Silver Larch', 'Eagle Crest',
  'Moonlit Pass', 'Frosted Peak', 'Cedar Hollow', 'Snowdrift Bay', 'Juniper Summit', 'Blue Spruce',
  'Northern Lights Peak', 'Whitefir Basin', 'Granite Meadow', 'Starlight Ridge', 'Quiet Pines', 'Winterbourne',
  'Crystal Hollow', 'Hazel Peak', 'Larch Valley', 'Sunbeam Slopes', 'Alpine Heather', 'Ravenwood Pass',
  'Silverbirch', 'Kaiserblick', 'Waldrast', 'Lindenhof Alm', 'Bergfried', 'Almenrausch',
  'Enzianblick', 'Jägerruh', 'Wiesengrund', 'Himmelreich Alm', 'Rotbuchenkamm', 'Sterntal',
  'Mondscheinalm', 'Glockenjoch', 'Eichhorn Alm', 'Hirschbühl', 'Reifhorn', 'Zauberwald',
  'Lichtenalm', 'Brunnenjoch', 'Alpenrose', 'Sonnenkamm', 'Tannenhorn', 'Silberwald',
  'Edelhorn', 'Frühlingsalm', 'Schneeglöckchen', 'Val Soleil', 'Monte Verde Alto', 'Mont Cristal',
  'Lärchental',
];

/** A plain-text resort name: markup characters and control characters dropped, whitespace collapsed, trimmed, at most RESORT_NAME_MAX characters. Empty when nothing usable is left. */
export function sanitizeResortName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/<[^>]*>/g, '').replace(/&#?[a-z0-9]+;/gi, '').replace(/[<>&"`\\]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, RESORT_NAME_MAX).join('').trim();
}

/** The default name of a seed: 'Alpenglow', 'Val Clair', 'Pine Ridge' ... picked from RESORT_NAMES (a pure function of the seed; any number, even NaN, gives a name). */
export function defaultResortName(seed: number): string {
  let h = (Math.trunc(seed) | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  return RESORT_NAMES[h % RESORT_NAMES.length]!;
}

/** The name to use: the sanitised choice, else the seed's default. */
export const resortNameOr = (raw: unknown, seed: number): string => sanitizeResortName(raw) || defaultResortName(seed);
