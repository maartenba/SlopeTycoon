/** `npm run site:check [-- --dir dist-site]`: static link / image / a11y / budget checks of the generated website (see scripts/site/crawl.ts). */
import { checkSite } from './crawl';
import { siteEnv } from './build';

const i = process.argv.indexOf('--dir'); const dir = i >= 0 ? process.argv[i + 1]! : 'dist-site';
const r = checkSite(dir, { siteUrl: siteEnv().siteUrl });
console.log(`[site:check] ${r.pages} pages, ${r.links} references, ${r.images} images, screenshots ${(r.shotBytes / 1048576).toFixed(1)} MB`);
if (r.problems.length) { for (const p of r.problems) console.error('✗', p); process.exit(1); }
console.log('[site:check] OK');
