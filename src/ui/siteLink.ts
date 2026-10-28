/** Support link (GitHub Sponsors; see .github/FUNDING.yml). A plain link opened only on click: no request is made until then. */
export const SPONSOR_URL = 'https://github.com/sponsors/maartenba';

/** Link back to the website when the game is served under `<site>/play/` (production site layout, site/README.md). Standalone (dev, `dist/`) returns null. */
export function siteUrl(path = '', loc: { pathname: string } = location): string | null {
  return /\/play\/(index\.html)?$/.test(loc.pathname) ? `../${path}` : null;
}
