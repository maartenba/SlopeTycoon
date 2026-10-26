/* Ground-level perf table (docs/perf.md "Ground level"): draw calls / triangles (renderer.info) and the JS update-path CPU time of one frame
 * (`renderer.onFrame`, i.e. everything except the GPU submit) in ride / photo / walk modes on 64 / 128 / 256 maps with hundreds of guests, per graphics preset.
 * SwiftShader (software GL) frame rates are NOT representative: only draw calls, triangles and the CPU update time are reported.
 * Usage: npm run perf:ground [-- --quick 1]   (quick = 128 only). Exit code 2 when the ride / walk draw-call budget (<= 350 on 128, med) is exceeded. */
import { launch, shot, startServer } from './lib/harness';
import { RIDE_DRAW_BUDGET_128 } from '../src/render/lod/nearLod';
const quick = process.argv.includes('--quick');

const measure = (q: string, n: number): string => `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('${q}');
const sleep=(ms)=>new Promise(x=>setTimeout(x,ms));s.spawnGuests(${n},'skiers');s.loop.setSpeed(1);await sleep(700);
const N=60;const t0=performance.now();for(let i=0;i<N;i++)r.onFrame(1/60);const cpu=(performance.now()-t0)/N;
const info=r.webgl.info.render;return {q:'${q}',calls:info.calls,tris:info.triangles,updateMs:+cpu.toFixed(2),guests:s.guestSim.store.count,near:s.guestRenderer.nearDrawn};})()`;

interface Row { size: number; mode: string; q: string; calls: number; tris: number; updateMs: number; guests: number; near: number }
const rows: Row[] = [];
const srv = await startServer();
const br = await launch();
let bad = 0;
try {
  const sizes = quick ? [128] : [64, 128, 256];
  const runs: Array<{ size: number; mode: 'ride' | 'lift' | 'photo' | 'walk'; q: string }> = [];
  for (const size of sizes) { runs.push({ size, mode: 'ride', q: 'med' }, { size, mode: 'photo', q: 'med' }, { size, mode: 'walk', q: 'med' }); }
  runs.push({ size: 128, mode: 'lift', q: 'med' }, { size: 128, mode: 'ride', q: 'low' }, { size: 128, mode: 'ride', q: 'high' }, { size: 128, mode: 'photo', q: 'low' }, { size: 128, mode: 'photo', q: 'high' }, { size: 128, mode: 'walk', q: 'low' }, { size: 128, mode: 'walk', q: 'high' });
  for (const r of runs) {
    const guests = r.size === 256 ? 600 : 400;
    const res = await shot(br, srv.url, {
      size: r.size, seed: 61, start: 'winter', hour: 11, w: 1280, h: 800, out: `m52-perf-${r.mode}-${r.size}-${r.q}`,
      pre: "__slope.populateDemo('medium'); __slope.spawnGuests(300,'skiers')", ticks: 1500,
      view: r.mode === 'photo' ? 'photo' : r.mode, guest: 'auto', freeze: false, vjs: measure(r.q, guests), ...(r.mode === 'photo' ? { photoHero: true } : {}), ...(r.mode === 'walk' ? { walkAt: 'lodge', walkYaw: 15, walkScript: 'w:0.5' } : {}),
    });
    const line = res.logs.find((l) => l.startsWith('[vjs]'));
    if (!line) { console.log(`${r.size} ${r.mode} ${r.q}: no measurement`); bad++; continue; }
    const m = JSON.parse(line.slice(6)) as { calls: number; tris: number; updateMs: number; guests: number; near: number };
    rows.push({ size: r.size, mode: r.mode, q: r.q, calls: m.calls, tris: m.tris, updateMs: m.updateMs, guests: m.guests, near: m.near });
    console.log(`${r.size} ${r.mode} ${r.q}: calls=${m.calls} tris=${m.tris} update=${m.updateMs}ms guests=${m.guests} near=${m.near}`);
    if ((r.mode === 'ride' || r.mode === 'walk') && r.size === 128 && r.q === 'med' && m.calls > RIDE_DRAW_BUDGET_128) { console.log(`OVER BUDGET (${RIDE_DRAW_BUDGET_128})`); bad++; }
  }
  console.log('| size | mode | quality | guests | draw calls | triangles | update ms/frame |\n|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.size} | ${r.mode} | ${r.q} | ${r.guests} | ${r.calls} | ${(r.tris / 1e6).toFixed(2)} M | ${r.updateMs} |`);
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
