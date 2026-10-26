/** Runs after `vite build`: writes dist/404.html (tiny redirect to the app root) and checks .nojekyll. Neither is precached (see vite-plugins/precache.ts). */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_FOUND_HTML } from './lib/notFound';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'index.html'))) { console.error('[post-build] dist/index.html missing: run `vite build` first'); process.exit(1); }
writeFileSync(join(dist, '404.html'), NOT_FOUND_HTML);
if (!existsSync(join(dist, '.nojekyll'))) { console.error('[post-build] dist/.nojekyll missing (public/.nojekyll not copied)'); process.exit(1); }
console.log(`[post-build] dist/404.html written, .nojekyll present${existsSync(join(dist, 'CNAME')) ? ', CNAME present' : ''}`);
