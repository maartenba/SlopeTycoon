/* M8 lane H: before / after shots of the static-cache + dynamic shadow pass (docs/shadows.md "Static cache"). vite-node scripts/shots/m8-shadows-h.ts <prefix> [summer|winter]
 * Iso at 17:00 and noon on the 64 map (lodge) and the 128 demo resort (guests, lifts moving); prints the rig stats + the MaterialGuard summary (READ it: 0 problems). New --out per run. */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-h';
const season = process.argv[3] ?? 'summer';
const HIDE = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const SET = `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('high');s.loop.setSpeed(1);await new Promise(x=>setTimeout(x,5000));console.info('[shadows] '+JSON.stringify(r.shadows.stats)+' calls='+r.webgl.info.render.calls+' tris='+r.webgl.info.render.triangles+' guard='+(s.materialGuard.check(),s.materialGuard.summary()));})()`;
const srv = await startServer(); const br = await launch();
const run = async (name: string, o: Record<string, unknown>): Promise<void> => {
  const r = await shot(br, srv.url, { w: 1400, h: 900, start: season, ...o, out: `${prefix}-${name}` } as never);
  for (const l of r.logs.filter((x) => /\[shadows\]|Render problems|Shader error/.test(x))) console.log(name, l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length, 'errors');
};
try {
  for (const hour of [17, 12]) {
    await run(`iso${hour}`, { size: 64, seed: 61, hour, zoom: 1.6, target: 'lodge', yaw: 2.2, evalJs: `${HIDE};${SET}` });
    await run(`demo${hour}`, { size: 128, seed: 5, pre: "__slope.populateDemo('medium');__slope.spawnGuests(150,'skiers')", ticks: 900, hour, zoom: 2.2, target: 'lodge', yaw: 2.2, evalJs: `${HIDE};${SET}` });
  }
} finally { await br.close(); srv.stop(); }
