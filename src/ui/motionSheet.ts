/**
 * Shared constructable stylesheet that switches off CSS animations / transitions INSIDE every st-* shadow root while 'Reduced motion' is on
 * (Settings > Accessibility). The document-level rule in styles.css (`html[data-reduced-motion] *`) cannot reach into shadow trees, so before this
 * only components with their own `prefers-reduced-motion` media query respected the in-game toggle. One sheet adopted by all roots = one update.
 */
const RULE = '*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}';
let sheet: CSSStyleSheet | null = null;
try { if (typeof CSSStyleSheet !== 'undefined') sheet = new CSSStyleSheet(); } catch { sheet = null; }
export const motionSheet = (): CSSStyleSheet | null => sheet;
export function setMotionSheet(reduced: boolean): void { try { sheet?.replaceSync(reduced ? RULE : ''); } catch { /* old engines */ } }
