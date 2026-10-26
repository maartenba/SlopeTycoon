/**
 * Ranger Rudi: flat-vector park-ranger bust (pure inline SVG, no assets; palette and outline match src/ui/logo.ts).
 * Campaign hat with band + badge, rosy cheeks, bushy moustache, green jacket with collar, red neckerchief and a shield badge.
 * Expressions: idle / point / cheer / worried / think / wave. Eyes sit in `.eyes` (blink animation lives in the host CSS).
 */
export type RudiExpression = 'idle' | 'point' | 'cheer' | 'worried' | 'think' | 'wave';
export const RUDI_EXPRESSIONS: readonly RudiExpression[] = ['idle', 'point', 'cheer', 'worried', 'think', 'wave'];

const O = '#0f213f', SKIN = '#f2c9a0', GREEN = '#3d7a4a', GREEN_D = '#2a5c37', HAT = '#2f6a3d', GOLD = '#ffd070', RED = '#d9442f', STASH = '#7a4a22', GLOVE = '#c9a24a';
const ln = (d: string, w = 1.7, c = STASH): string => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const arm = (d: string): string => `<path d="${d}" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${GREEN}" stroke-width="6.4" stroke-linecap="round"/>`;
const hand = (x: number, y: number, c = SKIN): string => `<circle cx="${x}" cy="${y}" r="4" fill="${c}" stroke="${O}" stroke-width="1.3"/>`;
const eyes = (dx = 0, dy = 0): string => `<g class="eyes">${[30, 42].map((x) => `<circle cx="${x + dx}" cy="${36 + dy}" r="2.3" fill="#2a1a10"/><circle cx="${x + dx + .8}" cy="${35.2 + dy}" r=".9" fill="#fff"/>`).join('')}</g>`;
const closedEyes = `<g class="eyes">${ln('M27.5 36.5q2.5-3.2 5 0M39.5 36.5q2.5-3.2 5 0', 1.8, '#2a1a10')}</g>`;
const brows = (l: string, r: string): string => ln(l) + ln(r);

function face(e: RudiExpression): { under: string; over: string } {
  switch (e) {
    case 'cheer': return {
      under: arm('M14 64Q8 54 10 42') + arm('M58 64Q64 54 62 42') + hand(10, 39) + hand(62, 39)
        + `<path d="M5 14l1.6 4 4 1.6-4 1.6L5 25l-1.6-3.8-4-1.6 4-1.6z" fill="${GOLD}"/><path d="M64 10l1.4 3.4 3.4 1.4-3.4 1.4L64 20l-1.4-3.4-3.4-1.4 3.4-1.4z" fill="${GOLD}"/>`,
      over: closedEyes + brows('M26.5 32q3.5-2.5 7 0', 'M38.5 32q3.5-2.5 7 0') + `<path d="M31 46.8Q36 54.5 41 46.8Z" fill="#7a2a2a"/>` };
    case 'worried': return {
      under: `<path d="M60 20q3.2 5 0 8.4-3.2-3.4 0-8.4z" fill="#7fc8ff" stroke="${O}" stroke-width=".8"/>`,
      over: eyes(0, .4) + brows('M26 34l7-3.2', 'M46 34l-7-3.2') + ln('M32 50.3Q36 46.6 40 50.3', 1.8, '#7a2a2a') };
    case 'point': return {
      under: arm('M56 66Q64 60 63 47') + `<path d="M63 45v-9" stroke="${O}" stroke-width="6.6" stroke-linecap="round"/><path d="M63 45v-9" stroke="${GLOVE}" stroke-width="4.2" stroke-linecap="round"/>` + hand(63, 46, GLOVE),
      over: eyes(1) + brows('M27 32.5q3-1.6 6 0', 'M39 30.4q3.2-2.4 6.6-.4') + ln('M32 48Q36 51.4 40 48', 1.8, '#7a2a2a') };
    case 'think': return {
      under: arm('M64 72Q62 58 47 54'),
      over: eyes(-1, -1.2) + brows('M27 32.5q3-1.6 6 0', 'M39 30.8q3.2-2.4 6.6-.4') + ln('M33 49.4h4', 1.8, '#7a2a2a') + hand(45, 51.5) };
    case 'wave': return {
      under: arm('M12 68Q4 56 11 43') + hand(11, 39),
      over: eyes() + brows('M27 32.5q3-1.6 6 0', 'M39 32.5q3-1.6 6 0') + ln('M32 48Q36 51.6 40 48', 1.8, '#7a2a2a') };
    default: return { under: '', over: eyes() + brows('M27 32.5q3-1.6 6 0', 'M39 32.5q3-1.6 6 0') + ln('M32 48Q36 51.6 40 48', 1.8, '#7a2a2a') };
  }
}

/** SVG markup for one expression (viewBox 72x72, transparent corners clipped by the round host). `mini` drops the backdrop details. */
export function rudiMarkup(e: RudiExpression = 'idle', mini = false): string {
  const f = face(e);
  const bg = `<rect width="72" height="72" fill="#3f78b8"/>` + (mini ? '' : `<path d="M0 54L15 31l9 13 15-21 33 33v22H0z" fill="#6f93c4"/><path d="M15 31l-5 7 3-1.4 2 2.4 2-2.4 3 1.4zM39 23l-6 9 3.6-1.6 2.4 3 2.4-3 3.6 1.6z" fill="#fff"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="Ranger Rudi" data-rudi="${e}">`
    + bg + f.under
    + `<path d="M5 73Q7 54 36 52Q65 54 67 73z" fill="${GREEN}" stroke="${O}" stroke-width="1.6"/>`
    + `<rect x="31" y="44" width="10" height="9" fill="${SKIN}" stroke="${O}" stroke-width="1.3"/>`
    + `<path d="M25 53L36 63 30 52zM47 53L36 63 42 52z" fill="${GREEN_D}" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="M28 51.5L36 64 44 51.5Q36 56 28 51.5z" fill="${RED}" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="M46 58h9v5.5q0 4.5-4.5 6.5-4.5-2-4.5-6.5z" fill="${GOLD}" stroke="${O}" stroke-width="1.3"/><path d="M50.5 60l-2.6 5h5.2z" fill="${GREEN_D}"/>`
    + `<circle cx="21.5" cy="37" r="3.2" fill="${SKIN}" stroke="${O}" stroke-width="1.3"/><circle cx="50.5" cy="37" r="3.2" fill="${SKIN}" stroke="${O}" stroke-width="1.3"/>`
    + `<ellipse cx="36" cy="36" rx="15" ry="14.5" fill="${SKIN}" stroke="${O}" stroke-width="1.5"/>`
    + `<circle cx="26.5" cy="41.5" r="2.7" fill="#f08a7a" opacity=".6"/><circle cx="45.5" cy="41.5" r="2.7" fill="#f08a7a" opacity=".6"/>`
    + `<circle cx="36" cy="40.5" r="2.7" fill="#e8a584"/>`
    + f.over
    + `<path d="M36 43.2Q31 41.4 26.6 44.8 30 48.4 36 45.8 42 48.4 45.4 44.8 41 41.4 36 43.2z" fill="${STASH}" stroke="#4d2c12" stroke-width=".8" stroke-linejoin="round"/>`
    + `<path d="M22 27Q21 9.5 36 9.5T50 27z" fill="${HAT}" stroke="${O}" stroke-width="1.5"/><path d="M22.3 22.5h27.4l.3 4.5H22z" fill="${GOLD}" stroke="${O}" stroke-width="1.2"/>`
    + `<ellipse cx="36" cy="27.5" rx="23" ry="5" fill="${GREEN_D}" stroke="${O}" stroke-width="1.5"/><path d="M36 13.6l1.4 3 3.2.4-2.4 2.2.7 3.2-2.9-1.7-2.9 1.7.7-3.2-2.4-2.2 3.2-.4z" fill="${GOLD}" stroke="${O}" stroke-width=".7"/>`
    + `</svg>`;
}

/** Same as rudiMarkup but as an element (document.createElementNS-safe: parsed through a template). */
export function rudiElement(e: RudiExpression = 'idle', mini = false): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = rudiMarkup(e, mini);
  return t.content.firstElementChild as SVGElement;
}
