/** `npm run site:dev`: serves dist-site/ (website at /, game at /play/) under SITE_BASE (default /) on PORT (default 4190). Build first: `npm run build:site`. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPagesServer, normalizeBase } from '../lib/static-server';

const dist = join(process.cwd(), 'dist-site');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist-site/ missing: run `npm run build:site` first'); process.exit(1); }
const base = normalizeBase(process.env.SITE_BASE ?? '/'), port = Number(process.env.PORT ?? 4190);
createPagesServer(dist, base).listen(port, '127.0.0.1', () => console.log(`[site:dev] http://localhost:${port}${base}  (game: ${base}play/). Ctrl+C to stop.`));
