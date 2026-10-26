/** Link back to the website when the game is served under `<site>/play/` (production site layout, site/README.md). Standalone (dev, `dist/`) returns null. */
export function siteUrl(path = '', loc: { pathname: string } = location): string | null {
  return /\/play\/(index\.html)?$/.test(loc.pathname) ? `../${path}` : null;
}
