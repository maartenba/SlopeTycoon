/** Tiny static server mounting `dist` under a base path (like GitHub Pages project sites). Unknown paths -> 404.html (status 404). */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };

export const normalizeBase = (b: string): string => { let s = b.trim(); if (!s.startsWith('/')) s = `/${s}`; if (!s.endsWith('/')) s += '/'; return s; };

export function createPagesServer(dist: string, base: string): Server {
  const mount = normalizeBase(base);
  const notFound = (res: import('node:http').ServerResponse): void => {
    const f = join(dist, '404.html');
    res.writeHead(404, { 'content-type': MIME['.html']! });
    res.end(existsSync(f) ? readFileSync(f) : 'Not found');
  };
  return createServer((req, res) => {
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]!); } catch { notFound(res); return; }
    if (path === mount.slice(0, -1)) { res.writeHead(301, { location: mount }); res.end(); return; }
    if (!path.startsWith(mount)) { notFound(res); return; }
    let f = normalize(join(dist, path.slice(mount.length)));
    if (!f.startsWith(dist)) { notFound(res); return; }
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) { notFound(res); return; }
    const type = MIME[extname(f)] ?? 'application/octet-stream', buf = readFileSync(f), range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) { // byte ranges, so a video can seek
      const start = range[1] ? Number(range[1]) : Math.max(0, buf.length - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      if (start > end || start >= buf.length) { res.writeHead(416, { 'content-range': `bytes */${buf.length}` }); res.end(); return; }
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 }); res.end(buf.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'max-age=600' });
    res.end(buf);
  });
}
