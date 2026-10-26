/** `npm run preview:pages`: serves dist/ under PAGES_BASE (default /slopetycoon/) like GitHub Pages. Port: PORT (default 4180). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPagesServer, normalizeBase } from './lib/static-server';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const base = normalizeBase(process.env.PAGES_BASE ?? '/slopetycoon/');
const port = Number(process.env.PORT ?? 4180);
createPagesServer(dist, base).listen(port, '127.0.0.1', () => {
  console.log(`[preview:pages] http://localhost:${port}${base}  (unknown paths -> 404.html). Ctrl+C to stop.`);
});
