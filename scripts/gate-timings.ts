/* Gate timings (measure only): runs each release-gate stage ONCE, SERIALLY, and records wall time, CPU, peak RSS, exit code and an output tail.
 * Usage: npm run gate:timings [-- --only a,b] [--skip x,y] [--dry]
 * Output: .weave/gate/timings-<date>.json and .md (sorted by wall time), logs in .weave/gate/logs/<id>.log. See docs/gate-speed.md.
 * Run on a quiet machine; nothing else should use the CPU or kill browsers. Only spawns its own child processes (own process group, killed by PID on timeout). */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';

interface Stage {
  id: string; cmd: string;
  /** What the stage needs / touches (documentation for docs/gate-speed.md). */
  needs: { browser?: boolean; devServer?: boolean; dist?: boolean; quiet?: boolean };
  writes: string;
  after?: string;
  /** Concurrency verdict for a future parallel runner. */
  parallel: string;
}
const san = (id: string, script: string): Stage => ({ id: `${id}:sanity`, cmd: `npm run ${script}`, needs: { browser: true, devServer: true }, writes: '.weave/shots, own IDB (fresh Chrome profile)', parallel: 'yes (own vite on a free port, own Chrome); CPU heavy under SwiftShader' });
export const STAGES: Stage[] = [
  { id: 'typecheck', cmd: 'npm run typecheck', needs: {}, writes: '-', parallel: 'yes' },
  { id: 'lint', cmd: 'npm run lint', needs: {}, writes: '-', parallel: 'yes' },
  { id: 'test-1', cmd: 'npm test', needs: {}, writes: '-', parallel: 'yes, but uses all cores' },
  { id: 'test-2', cmd: 'npm test', needs: {}, writes: '-', parallel: 'yes, but uses all cores (redundant repeat)' },
  { id: 'build', cmd: 'npm run build', needs: {}, writes: 'dist/, src/config/whatsNew.generated.ts, icons if missing', parallel: 'yes with build:site only if outDirs differ (they do: dist vs dist-site)' },
  { id: 'verify-pwa', cmd: 'npm run verify:pwa', needs: { dist: true }, writes: '-', after: 'build', parallel: 'after build' },
  { id: 'test-perf', cmd: 'npm run test:perf', needs: { quiet: true }, writes: '-', parallel: 'NO: timing thresholds need a quiet machine' },
  { id: 'test-balance', cmd: 'npm run test:balance', needs: {}, writes: '-', parallel: 'yes (one test file, pure CPU, single thread)' },
  { id: 'shot-suite', cmd: 'npm run shot:suite', needs: { browser: true, devServer: true }, writes: '.weave/shots', parallel: 'yes (own vite + Chrome)' },
  san('play', 'play:sanity'), san('phase6', 'phase6:sanity'), san('summer', 'summer:sanity'), san('winter', 'winter:sanity'),
  san('winter-tours', 'winter:tours'), san('backcountry', 'backcountry:sanity'), san('sled', 'sled:sanity'), san('m74', 'm74:sanity'),
  san('schirmbar', 'schirmbar:sanity'), san('visitor', 'visitor:sanity'), san('photographer', 'photographer:sanity'),
  { id: 'analytics:e2e', cmd: 'npm run analytics:e2e', needs: { browser: true, devServer: true }, writes: '.weave', parallel: 'yes' },
  { id: 'offline:splash', cmd: 'npm run offline:splash', needs: { browser: true, dist: true }, writes: '.weave', after: 'build', parallel: 'after build (serves dist)' },
  { id: 'music:e2e', cmd: 'npm run music:e2e', needs: { browser: true, devServer: true }, writes: '.weave', parallel: 'yes' },
  { id: 'menu-music:e2e', cmd: 'npm run menu-music:e2e', needs: { browser: true, devServer: true }, writes: '.weave', parallel: 'yes' },
  { id: 'sfx:e2e', cmd: 'npm run sfx:e2e', needs: { browser: true, devServer: true }, writes: '.weave', parallel: 'yes' },
  { id: 'touch:e2e', cmd: 'npm run touch:e2e -- --only camera,placement,drawers --viewport phone', needs: { browser: true, devServer: true }, writes: '.weave', parallel: 'yes' },
  { id: 'mobile:audit', cmd: 'npm run mobile:audit -- --label gate', needs: { browser: true, devServer: true }, writes: '.weave/shots', parallel: 'yes' },
  { id: 'desktop:diff', cmd: 'npm run desktop:diff -- --out .weave/gate/desktop-diff', needs: { browser: true, devServer: true }, writes: '.weave/gate/desktop-diff', parallel: 'yes (the real gate also needs a before worktree)' },
  { id: 'flicker', cmd: 'npm run flicker -- --only 64-winter-day', needs: { browser: true, devServer: true, quiet: true }, writes: '.weave', parallel: 'NO: frame-timing sensitive, keep serial' },
  { id: 'site:og', cmd: 'npm run site:og', needs: { browser: true }, writes: 'site/assets/og (committed)', parallel: 'yes' },
  { id: 'docs:img', cmd: 'npm run docs:img', needs: {}, writes: 'docs/img (committed)', parallel: 'yes' },
  { id: 'build:site', cmd: 'npm run build:site', needs: {}, writes: 'dist-site/', after: 'site:og', parallel: 'after site:og (cards); not with another vite build writing the same dir' },
  { id: 'site:check', cmd: 'npm run site:check', needs: {}, writes: '-', after: 'build:site', parallel: 'after build:site' },
  { id: 'verify:site', cmd: 'npm run verify:site', needs: { dist: true }, writes: '-', after: 'build:site', parallel: 'after build:site' },
];

const args = process.argv.slice(2);
const opt = (k: string): string[] => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1]!.split(',') : []; };
const only = opt('--only'), skip = opt('--skip'), dry = args.includes('--dry');
const list = STAGES.filter((s) => (!only.length || only.includes(s.id)) && !skip.includes(s.id));
if (dry) {
  for (const s of list) console.log(`${s.id.padEnd(16)} ${s.cmd}  [${Object.keys(s.needs).join(',') || '-'}]${s.after ? ` after ${s.after}` : ''}`);
  console.log(`${list.length} stages`);
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
mkdirSync('.weave/gate/logs', { recursive: true });
interface Res { id: string; cmd: string; wallS: number; userS: number; sysS: number; cpuS: number; cpuWall: number; rssMB: number; exit: number; tail: string; needs: Stage['needs']; writes: string; after?: string; parallel: string }
const results: Res[] = [];
const load0 = loadavg().map((x) => +x.toFixed(2));
console.log(`load at start ${load0.join(' ')}; ${cpus().length} cores`);

function run(s: Stage): Promise<Res> {
  return new Promise((resolve) => {
    const log = createWriteStream(`.weave/gate/logs/${s.id.replace(/[:]/g, '_')}.log`);
    const t0 = Date.now();
    // `/usr/bin/time -l` reports user/sys/peak RSS of the whole child tree's waited-for processes (macOS).
    const p = spawn('/usr/bin/time', ['-l', 'sh', '-c', s.cmd], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    const feed = (d: Buffer): void => { const t = String(d); log.write(t); out += t; if (out.length > 400000) out = out.slice(-200000); };
    p.stdout?.on('data', feed); p.stderr?.on('data', feed);
    const timer = setTimeout(() => { try { if (p.pid) process.kill(-p.pid); } catch { /* gone */ } }, 60 * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(timer); log.end();
      const wallS = (Date.now() - t0) / 1000;
      const m = /([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/.exec(out);
      const rss = /(\d+)\s+maximum resident set size/.exec(out);
      const userS = m ? Number(m[2]) : 0, sysS = m ? Number(m[3]) : 0;
      const body = out.replace(/^\s*[\d.]+\s+real[\s\S]*$/m, '').trimEnd();
      const tail = body.split('\n').slice(-12).join('\n');
      const r: Res = { id: s.id, cmd: s.cmd, wallS: +wallS.toFixed(1), userS, sysS, cpuS: +(userS + sysS).toFixed(1), cpuWall: +((userS + sysS) / wallS).toFixed(2), rssMB: rss ? Math.round(Number(rss[1]) / 1048576) : 0, exit: code ?? -1, tail, needs: s.needs, writes: s.writes, after: s.after, parallel: s.parallel };
      console.log(`${r.exit === 0 ? 'ok  ' : 'FAIL'} ${s.id.padEnd(16)} wall ${r.wallS}s cpu ${r.cpuS}s (x${r.cpuWall}) rss ${r.rssMB}MB`);
      resolve(r);
    });
  });
}

(async () => {
  for (const s of list) results.push(await run(s));
  const load1 = loadavg().map((x) => +x.toFixed(2));
  const sorted = [...results].sort((a, b) => b.wallS - a.wallS);
  const total = results.reduce((a, r) => a + r.wallS, 0);
  writeFileSync(`.weave/gate/timings-${date}.json`, JSON.stringify({ date, node: process.version, cores: cpus().length, loadStart: load0, loadEnd: load1, totalWallS: +total.toFixed(1), results }, null, 2));
  const md = [`# Gate timings ${date}`, '', `Node ${process.version}, ${cpus().length} cores, load avg start ${load0.join(' ')} end ${load1.join(' ')}, total serial wall ${(total / 60).toFixed(1)} min`, '',
    '| Stage | Wall s | CPU s | CPU/wall | Peak RSS MB | Exit | Needs | Parallel-safe |', '|---|---:|---:|---:|---:|---:|---|---|',
    ...sorted.map((r) => `| ${r.id} | ${r.wallS} | ${r.cpuS} | ${r.cpuWall} | ${r.rssMB} | ${r.exit} | ${Object.keys(r.needs).join(', ') || '-'} | ${r.parallel} |`), '',
    ...sorted.filter((r) => r.exit !== 0).map((r) => `## ${r.id} FAILED\n\n\`\`\`\n${r.tail}\n\`\`\`\n`)].join('\n');
  writeFileSync(`.weave/gate/timings-${date}.md`, md);
  console.log(md);
  void readFileSync;
  process.exit(results.some((r) => r.exit !== 0) ? 1 : 0);
})();
