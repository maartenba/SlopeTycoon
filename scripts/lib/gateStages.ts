/** Stage table + path selection of `npm run gate` (docs/gate-speed.md). Pure data and functions, unit-tested in tests/scripts/gate.test.ts. */
import type { StageDef } from './gateRunner';

const HEAVY = 3, SAN = 2, LIGHT = 1;
const vt = (base: string, env = ''): StageDef['vitest'] => ({ retryCmd: (files) => `${env}${base} ${files.join(' ')}` });
const VT = 'npx vitest run';
const san = (id: string, script: string, est: number): StageDef => ({ id, cmd: `npm run ${script}`, slots: SAN, est });
/** Number of `test:balance` shards (tests/game/balance*.test.ts, docs/balance.md "Shards"). */
export const BALANCE_SHARDS = ['balance', 'balance.b', 'balance.c', 'balance.d'];
const balanceStage = (name: string): StageDef => ({ id: `test:${name}`, cmd: `BALANCE=1 ${VT} tests/game/${name}.test.ts`, slots: 1, est: 300, vitest: vt(VT, 'BALANCE=1 ') });

export const STAGES: StageDef[] = [
  { id: 'typecheck', cmd: 'npm run typecheck', slots: LIGHT, est: 6 },
  { id: 'lint', cmd: 'npm run lint', slots: LIGHT, est: 8 },
  { id: 'test', cmd: `${VT} --reporter=default`, slots: 4, est: 230, vitest: vt(VT) },
  { id: 'test:repo', cmd: `${VT} tests/repo`, slots: 2, est: 20, vitest: vt(VT) },
  { id: 'test:site', cmd: `${VT} tests/site`, slots: 2, est: 20, vitest: vt(VT) },
  { id: 'test:scripts', cmd: `${VT} tests/scripts tests/analysis`, slots: 2, est: 15, vitest: vt(VT) },
  { id: 'test:render', cmd: `${VT} tests/render tests/ui tests/ui-dom tests/smoke.test.ts`, slots: 3, est: 60, vitest: vt(VT) },
  { id: 'test:audio', cmd: `${VT} tests/audio`, slots: 2, est: 20, vitest: vt(VT) },
  ...BALANCE_SHARDS.map(balanceStage),
  { id: 'test:perf', cmd: 'npm run test:perf', slots: 4, exclusive: true, est: 60, vitest: vt('PERF=1 npx vitest run --config vitest.perf.config.ts') },
  { id: 'build', cmd: 'npm run build', slots: LIGHT, est: 10 },
  { id: 'verify:pwa', cmd: 'npm run verify:pwa', needs: ['build'], slots: LIGHT, est: 2 },
  { id: 'analytics:e2e', cmd: 'npm run analytics:e2e', needs: ['verify:pwa'], slots: HEAVY, est: 50 },
  { id: 'offline:splash', cmd: 'npm run offline:splash', needs: ['verify:pwa'], slots: HEAVY, est: 20 },
  { id: 'menu-music:e2e', cmd: 'npm run menu-music:e2e', needs: ['verify:pwa'], slots: HEAVY, est: 50 },
  { id: 'sfx:e2e', cmd: 'npm run sfx:e2e', needs: ['verify:pwa'], slots: HEAVY, est: 60 },
  { id: 'music:e2e', cmd: 'npm run music:e2e', needs: ['verify:pwa'], slots: HEAVY, est: 80 },
  san('play:sanity', 'play:sanity', 32), san('phase6:sanity', 'phase6:sanity', 17), san('summer:sanity', 'summer:sanity', 24), san('winter:sanity', 'winter:sanity', 29),
  san('winter-tours:sanity', 'winter:tours', 11), san('backcountry:sanity', 'backcountry:sanity', 24), san('sled:sanity', 'sled:sanity', 22), san('m74:sanity', 'm74:sanity', 21),
  san('schirmbar:sanity', 'schirmbar:sanity', 16), san('visitor:sanity', 'visitor:sanity', 58), san('photographer:sanity', 'photographer:sanity', 16),
  { id: 'shot:suite', cmd: 'npm run shot:suite', slots: HEAVY, est: 180 },
  { id: 'touch:e2e', cmd: 'npm run touch:e2e -- --only camera,placement,drawers --viewport phone', slots: HEAVY, est: 215 },
  { id: 'mobile:audit', cmd: 'npm run mobile:audit -- --label gate', slots: HEAVY, est: 265 },
  { id: 'desktop:diff', cmd: 'npx vite-node scripts/gate-desktop-diff.ts', slots: HEAVY, est: 70 },
  { id: 'flicker', cmd: 'npm run flicker -- --only 64-winter-day', slots: HEAVY, exclusive: true, est: 120 },
  { id: 'site:og', cmd: 'npm run site:og', slots: LIGHT, est: 10 },
  { id: 'docs:img', cmd: 'npm run docs:img', needs: ['site:og'], slots: LIGHT, est: 1 },
  { id: 'build:site', cmd: 'npm run build:site', needs: ['docs:img'], slots: LIGHT, est: 10 },
  { id: 'site:check', cmd: 'npm run site:check', needs: ['build:site'], slots: LIGHT, est: 1 },
  { id: 'verify:site', cmd: 'npm run verify:site', needs: ['site:check'], slots: LIGHT, est: 2 },
];

export const ids = (pred: (s: StageDef) => boolean): string[] => STAGES.filter(pred).map((s) => s.id);
export const ALL = STAGES.map((s) => s.id);
export const SANITIES = ids((s) => s.id.endsWith(':sanity'));
export const E2E = ['analytics:e2e', 'offline:splash', 'menu-music:e2e', 'sfx:e2e', 'music:e2e'];
export const SITE = ['site:og', 'docs:img', 'build:site', 'site:check', 'verify:site'];
export const BALANCE = BALANCE_SHARDS.map((n) => `test:${n}`);
export const BASE = ['typecheck', 'lint', 'test', 'build', 'verify:pwa'];
/** The whole release gate. */
export const FULL = ALL.filter((id) => !/^test:(repo|site|scripts|render|audio)$/.test(id));

const RENDER_SANITIES = ['play:sanity', 'winter:sanity', 'summer:sanity', 'schirmbar:sanity', 'photographer:sanity', 'visitor:sanity'];
const SAVE_SANITIES = ['play:sanity', 'phase6:sanity'];

export interface Selection { ids: Set<string>; reason: string[] }
/** Path -> stages (docs/gate-speed.md "What to run by changed path"). `paths` are repo-relative, posix. */
export function stagesForPaths(paths: string[]): Selection {
  const out = new Set<string>(), why: string[] = [];
  const add = (reason: string, list: string[]): void => { list.forEach((i) => out.add(i)); if (!why.includes(reason)) why.push(reason); };
  const p = paths.filter(Boolean);
  if (!p.length) return { ids: out, reason: ['no changes'] };
  const isDocs = (f: string): boolean => /^docs\//.test(f) || (/\.md$/i.test(f) && !f.startsWith('site/')) || f === 'LICENSE';
  for (const f of p) {
    if (/^(package(-lock)?\.json|vite\.config\.[jt]s|vitest[^/]*\.config\.[jt]s|tsconfig[^/]*\.json|\.nvmrc|scripts\/gate[^/]*\.ts|scripts\/lib\/(gate|harness|static-server|dist-guard)[^/]*\.ts)$/.test(f)) add('build / tooling config', FULL);
    else if (/^src\/(sim|config|game|core|world)\//.test(f)) add('src/sim|config|game|core|world', FULL);
    else if (/^src\/(render|ui)\//.test(f) || /\.(glsl|vert|frag)$/.test(f)) add('src/render|ui', [...BASE.slice(0, 2), 'test:render', 'build', 'verify:pwa', 'shot:suite', 'flicker', 'desktop:diff', 'mobile:audit', 'test:perf', ...RENDER_SANITIES]);
    else if (/^(src\/audio\/|public\/audio\/)/.test(f)) add('src/audio|public/audio', ['typecheck', 'lint', 'test:audio', 'build', 'verify:pwa', 'music:e2e', 'menu-music:e2e', 'sfx:e2e']);
    else if (/^src\/persist\//.test(f)) add('src/persist', [...BASE, ...SAVE_SANITIES]);
    else if (/^(src\/(sw|pwa)\/|sw\/|vite-plugins\/)/.test(f)) add('service worker / pwa', ['typecheck', 'lint', 'build', 'verify:pwa', 'offline:splash', 'analytics:e2e']);
    else if (/^src\/analytics\//.test(f)) add('src/analytics', [...BASE, 'analytics:e2e']);
    else if (/^src\//.test(f)) add('src (other)', [...BASE, 'play:sanity']);
    else if (/^scripts\/(promo|analysis)\//.test(f)) add('scripts/promo|analysis', ['typecheck', 'lint', 'test:scripts']);
    else if (/^scripts\//.test(f)) add('scripts', ['typecheck', 'lint', 'test:scripts']);
    else if (/^site\//.test(f)) add('site', [...SITE, 'test:site', 'test:repo']);
    else if (/^tests\//.test(f)) add('tests', ['typecheck', 'lint', 'test']);
    else if (isDocs(f)) add('docs', ['test:repo']);
    else add('other', BASE);
  }
  return { ids: out, reason: why };
}

/** `--fast`: typecheck, lint, unit tests, build, verify:pwa, the site gate when site/ or docs changed, plus the sanity stages the changed paths map to. */
export function fastSelection(changed: string[]): Selection {
  const m = stagesForPaths(changed), out = new Set<string>(BASE), why = ['fast tier'];
  if (changed.some((f) => /^(site\/|docs\/)/.test(f) || /\.md$/i.test(f))) { SITE.forEach((i) => out.add(i)); out.add('test:site'); why.push('site / docs changed'); }
  for (const i of m.ids) if (i.endsWith(':sanity')) out.add(i);
  return { ids: out, reason: why.concat(m.reason.filter((r) => r !== 'no changes')) };
}
