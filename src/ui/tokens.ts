/** Design tokens shared by every st-* component (injected on each :host by StElement's BASE_CSS; custom properties inherit into children). */
export const TOKENS = {
  /** spacing scale (px) */
  sp1: 4, sp2: 6, sp3: 8, sp4: 12, sp5: 16,
  /** radii (px) */
  rSm: 4, rMd: 6, rLg: 10,
  /** font sizes (px): never below `fsMin` (11) */
  fsMin: 11, fsSm: 11, fsMd: 12, fsLg: 13, fsXl: 16, fsTitle: 20,
} as const;

export const COLORS = {
  panel: 'rgba(20,28,40,0.82)', panelSolid: '#141c28', border: '#5a7090', borderSoft: '#3a4a60',
  btn: '#34465e', btnHover: '#46607f', accent: '#e0a030', accentText: '#ffd070', text: '#ffffff', muted: '#b9c6d8',
  good: '#7fe07f', bad: '#ff6a5a', info: '#9bb8ff', field: '#0f1722', fieldBorder: '#40536d', ice: '#8fd3ff', danger: '#c0463a', dangerHover: '#d85a4c',
} as const;

/** Font stacks (fonts are self-hosted: src/ui/fonts.css, public/fonts, docs/fonts.md). Emoji fall back to the system colour fonts. */
export const FONTS = {
  ui: "'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'",
  display: "'Lilita One', 'Nunito', system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'",
} as const;

export type ModalSize = 'sm' | 'md' | 'lg';
/** Dialog widths (px): sm 420 / md 640 / lg 920. */
export const MODAL_WIDTHS = { sm: 420, md: 640, lg: 920 } as const;

/** Font tokens multiplied by the UI scale (Settings → Accessibility, 90-130 %; `--ui-scale` is set on <html> and inherits into every shadow root). Appended after `tokensCss()` so it wins. */
export function scaledFontsCss(): string {
  return (['fsSm', 'fsMd', 'fsLg', 'fsXl', 'fsTitle'] as const).map((k) => `--${k.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)}:calc(${TOKENS[k]}px * var(--ui-scale, 1))`).join(';');
}

/** `--sp-1:4px;...` declaration block for :host. */
export function tokensCss(): string {
  const px = (n: number): string => `${n}px`;
  return [
    ...Object.entries(TOKENS).map(([k, v]) => `--${k.replace(/([A-Z0-9])/g, (m) => `-${m.toLowerCase()}`)}:${px(v)}`),
    `--font-ui:${FONTS.ui}`, `--font-display:${FONTS.display}`,
    ...Object.entries(MODAL_WIDTHS).map(([k, v]) => `--modal-${k}:${v}px`),
    // good / bad / info follow the colour palette (Settings > Colour palette sets --pal-* on <html>, accessibility.ts)
    ...Object.entries(COLORS).map(([k, v]) => `--c-${k.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)}:${k === 'good' || k === 'bad' || k === 'info' ? `var(--pal-${k},${v})` : v}`),
    '--touch-min:var(--touch-min-root,0px)',
  ].join(';');
}
