import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const read = (p: string): string => readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
type Wf = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, { needs?: string; permissions?: Record<string, string>; environment?: { name: string }; steps: Array<{ uses?: string; run?: string; with?: Record<string, string> }> }> };
const wf = (n: string): Wf => parse(read(`.github/workflows/${n}.yml`)) as Wf;
const npmScripts = (w: Wf): string[] => Object.values(w.jobs).flatMap((j) => j.steps).flatMap((s) => (s.run ? [...s.run.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]!) : []));

describe('GitHub workflows', () => {
  for (const n of ['pages', 'ci', 'extra-tests', 'site-shots']) {
    it(`${n}.yml parses, uses pinned action majors and only existing npm scripts`, () => {
      const w = wf(n);
      for (const j of Object.values(w.jobs)) for (const s of j.steps) if (s.uses) expect(s.uses).toMatch(/^actions\/[\w-]+@v\d+$/);
      for (const s of npmScripts(w)) expect(pkg.scripts[s], `npm script ${s}`).toBeTruthy();
      const uses = Object.values(w.jobs).flatMap((j) => j.steps.filter((s) => s.uses?.startsWith('actions/setup-node')));
      for (const u of uses) { expect(u.with?.['node-version-file']).toBe('.nvmrc'); expect(u.with?.cache).toBe('npm'); }
    });
  }
  it('pages.yml: push to main + manual; build then deploy with Pages permissions', () => {
    const w = wf('pages');
    expect(Object.keys(w.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(w.jobs.deploy!.needs).toBe('build');
    expect(w.jobs.deploy!.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(w.jobs.deploy!.environment?.name).toBe('github-pages');
    const b = w.jobs.build!.steps;
    expect(b.some((s) => s.uses === 'actions/upload-pages-artifact@v3' && s.with?.path === './dist-site')).toBe(true);
    expect(w.jobs.deploy!.steps.some((s) => s.uses === 'actions/deploy-pages@v4')).toBe(true);
    const runs = b.map((s) => s.run).filter(Boolean);
    for (const r of ['npm ci', 'npm run typecheck', 'npm run lint', 'npm test', 'npm run build', 'npm run verify:pwa', 'npm run build:site', 'npm run site:check', 'npm run verify:site']) expect(runs).toContain(r);
    const site = b.find((x) => x.run === 'npm run build:site') as { env?: Record<string, string> };
    expect(Object.keys(site.env ?? {})).toEqual(['SITE_REPO', 'SITE_URL']);
    expect(runs).not.toContain('npm run site:shots');
  });
  it('ci.yml: pull requests only, no deploy; extra-tests is manual', () => {
    expect(Object.keys(wf('ci').on)).toEqual(['pull_request']);
    expect(JSON.stringify(wf('ci'))).not.toContain('deploy-pages');
    expect(Object.keys(wf('extra-tests').on)).toEqual(['workflow_dispatch']);
  });
  it('site-shots.yml is manual, uploads the shots as an artifact and is not part of the deploy', () => {
    const w = wf('site-shots');
    expect(Object.keys(w.on)).toEqual(['workflow_dispatch']);
    expect(JSON.stringify(w)).not.toContain('deploy-pages');
    expect(w.jobs.shots!.steps.some((s) => s.uses === 'actions/upload-artifact@v4')).toBe(true);
  });
  it('.nvmrc matches engines major', () => {
    expect(read('.nvmrc').trim()).toMatch(/^\d+$/);
  });
});

describe('repo hygiene', () => {
  it('.gitignore does not ignore required files', () => {
    const files = ['public/icons/icon-192.png', 'public/manifest.webmanifest', 'public/.nojekyll', 'public/fonts/OFL.txt', 'package.json', 'src/main.ts', '.github/workflows/pages.yml', '.nvmrc'];
    for (const f of files) {
      let ignored = true;
      try { execFileSync('git', ['check-ignore', '-q', f]); } catch { ignored = false; }
      expect(ignored, `${f} is git-ignored`).toBe(false);
    }
  });
  it('.gitignore ignores build output and screenshots', () => {
    for (const f of ['dist/index.html', 'node_modules/x', '.weave/shots/a.png', '.weave/plans/x.md']) expect(() => execFileSync('git', ['check-ignore', '-q', f])).not.toThrow();
  });
  it('.nojekyll is shipped from public/ and not in the precache list', () => {
    expect(existsSync('public/.nojekyll')).toBe(true);
    expect(read('vite-plugins/precache.ts')).toContain("'.nojekyll'");
  });
});
