/** `npm run site:check [-- --dir dist-site]`: static link / image / a11y / budget checks of the generated website (see scripts/site/crawl.ts). */
import { checkSite } from './crawl';
import { existsSync, readFileSync } from 'node:fs';
import { siteEnv } from './build';
import { OG_MANIFEST, ogInputsHash } from './ogCards';

const i = process.argv.indexOf('--dir'); const dir = i >= 0 ? process.argv[i + 1]! : 'dist-site';
const r = checkSite(dir, { siteUrl: siteEnv().siteUrl, seo: true });
console.log(`[site:check] ${r.pages} pages, ${r.links} references, ${r.images} images, screenshots ${(r.shotBytes / 1048576).toFixed(1)} MB`);
const ogOk = existsSync(OG_MANIFEST) && (JSON.parse(readFileSync(OG_MANIFEST, 'utf8')) as { inputs?: string }).inputs === ogInputsHash();
if (!ogOk) r.problems.push('social cards (site/assets/og) are stale or have no manifest: run npm run site:og and commit the result');
if (r.problems.length) { for (const p of r.problems) console.error('✗', p); process.exit(1); }
console.log('[site:check] OK');
