/* M8 lane I: READ the MaterialGuard problem count (not just the harness log) on a starter resort with a dug pond, village decor, rocks, on each quality tier. vite-node scripts/shots/m8-guard-i.ts */
import { launch, shot, startServer } from '../lib/harness';
const srv = await startServer(); const br = await launch();
try {
  for (const q of ['low', 'med', 'high']) {
    const js = `(()=>{const s=__slope;s.view.setQuality('${q}');const L=s.landscapeDebug;const p=L.find(4,0);if(p)L.dig(p.x,p.y,4);s.villageDecor.items.length;})()`;
    const r = await shot(br, srv.url, { w: 900, h: 600, size: 128, seed: 5, hour: 11, ticks: 200, extra: 'starter=1', evalJs: js, out: `m8-after-i-guard-${q}` } as never);
    const g = await shot(br, srv.url, { w: 400, h: 300, size: 128, seed: 5, hour: 11, ticks: 200, extra: 'starter=1', evalJs: `(()=>{const s=__slope;s.view.setQuality('${q}');})();(()=>{console.log('[stats] guard '+__slope.materialGuard.count)})()`, out: `m8-after-i-guard2-${q}` } as never);
    console.log(q, g.logs.filter((l) => l.includes('[stats]')).join(' '), 'errors', r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length);
  }
} finally { await br.close(); srv.stop(); }
