/** Support link (Ko-fi, https://ko-fi.com/slopetycoon; .github/FUNDING.yml lists both GitHub Sponsors and Ko-fi). A plain link opened only on click: no request is made until then. */
export const SUPPORT_URL = 'https://ko-fi.com/slopetycoon';

/** Link back to the website when the game is served under `<site>/play/` (production site layout, site/README.md). Standalone (dev, `dist/`) returns null. */
export function siteUrl(path = '', loc: { pathname: string } = location): string | null {
  return /\/play\/(index\.html)?$/.test(loc.pathname) ? `../${path}` : null;
}
