import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Plan decision D8: no sharing features anywhere. Photos are LOCAL downloads only. */
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|css|html)$/.test(f)) out.push(p); }
  return out;
};
const files = [...walk('src'), ...walk('scripts'), 'index.html'];

describe('no sharing (D8)', () => {
  it('the repo source contains no Web Share API / clipboard-link code', () => {
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      expect(/navigator\s*\.\s*(share|canShare)\b/.test(s), `${f}: navigator.share`).toBe(false);
      expect(/\bnavigator\s*\[\s*['"](share|canShare)/.test(s), `${f}: navigator['share']`).toBe(false);
    }
  });
  it("no 'Share' UI strings: no string literal / text node that starts with Share, 'Copy link' or a share code (the iOS 'Add to Home Screen' install hint is not a share feature)", () => {
    const bad = /(['"`>])\s*(Share\b|Copy link|Copy photo link|Share code)/;
    for (const f of files.filter((x) => x.startsWith('src'))) {
      // the opt-in analytics toggle is a statistics consent, not a sharing feature (docs/analytics.md)
      const s = readFileSync(f, 'utf8').replace(/Share anonymous usage statistics/g, 'Allow anonymous usage statistics');
      expect(bad.test(s), `${f}: Share UI string`).toBe(false);
    }
  });
  it('photo files never reference upload, fetch or clipboard', () => {
    for (const f of ['src/render/view/PhotoMode.ts', 'src/render/view/postfx.ts', 'src/persist/PhotoStore.ts', 'src/ui/components/StPhoto.ts', 'src/ui/components/StYearReport.ts', 'src/ui/yearReportFormat.ts', 'src/render/view/yearCompose.ts', 'src/sim/meta/StatsHistory.ts', 'src/sim/meta/YearReport.ts', 'src/config/yearAwards.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|clipboard|WebSocket/.test(s), f).toBe(false);
    }
  });
  it('the year report offers a local image download only: no share / copy-link / code controls', () => {
    const s = readFileSync('src/ui/components/StYearReport.ts', 'utf8');
    expect(/data-action|dataset\.action/.test(s)).toBe(true);
    for (const id of ['later', 'save', 'continue']) expect(s.includes(`'${id}'`), id).toBe(true);
    expect(/share|copy\s*link|invite|\bcode\b/i.test(s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no sharing wording in the year report UI code').toBe(false);
  });
  it('scenarios: no import / export / share UI, strings or code (shipped JSON only, D8)', () => {
    const scenFiles = ['src/sim/scenario/ScenarioDef.ts', 'src/sim/scenario/ScenarioRunner.ts', 'src/config/scenarios/index.ts', 'src/ui/components/StScenarios.ts', 'src/ui/components/StScenarioCard.ts', 'src/ui/components/StScenarioResult.ts', 'src/ui/scenarioFormat.ts', 'src/persist/ProfileStore.ts', 'src/game/botPolicies.ts'];
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of scenFiles) {
      const s = strip(readFileSync(f, 'utf8'));
      expect(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|clipboard|WebSocket|navigator\s*\.\s*share|createObjectURL|FileReader|type\s*=\s*['"]file['"]|showOpenFilePicker|showSaveFilePicker/.test(s), `${f}: network / clipboard / file code`).toBe(false);
      expect(/['"`>]\s*(Import|Export|Share|Copy link|Upload|Download)\b/.test(s), `${f}: import / export / share string`).toBe(false);
    }
    const ui = strip(['StScenarios', 'StScenarioCard', 'StScenarioResult'].map((n) => readFileSync(`src/ui/components/${n}.ts`, 'utf8')).join('\n'));
    expect(/\b(shareCode|importScenario|exportScenario|scenarioCode)\b/i.test(ui)).toBe(false);
    // the shipped scenarios are bundled JSON: the only way in is the index (no loader reads a user file)
    for (const f of readdirSync('src/config/scenarios').filter((x) => x.endsWith('.json'))) expect(JSON.parse(readFileSync(join('src/config/scenarios', f), 'utf8')).id).toBe(f.replace('.json', ''));
    const main = readFileSync('src/main.ts', 'utf8');
    expect(/scenarioFile|importScenario|scenario\.json|FileReader/.test(main)).toBe(false);
  });
  it('achievements, trophies and cosmetics: local only, no import / export / share / network code or strings (D8)', () => {
    const files = ['src/config/achievements.ts', 'src/config/cosmetics.ts', 'src/sim/meta/Achievements.ts', 'src/ui/achievementToasts.ts', 'src/ui/trophyData.ts', 'src/ui/components/StTrophies.ts', 'src/persist/ProfileStore.ts'];
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of files) {
      const s = strip(readFileSync(f, 'utf8'));
      expect(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|clipboard|WebSocket|navigator\s*\.\s*share|createObjectURL|FileReader|type\s*=\s*['"]file['"]|showOpenFilePicker|showSaveFilePicker/.test(s), `${f}: network / clipboard / file code`).toBe(false);
      expect(/['"`>]\s*(Import|Export|Share|Copy link|Upload|Download)\b/.test(s), `${f}: import / export / share string`).toBe(false);
      expect(/\b(shareCode|exportProfile|importProfile|profileCode)\b/i.test(s), `${f}: profile sharing API`).toBe(false);
    }
    // the Settings cosmetics + reset section and the trophy toast / menu entries carry no sharing controls either
    const settings = strip(readFileSync('src/ui/components/StSettings.ts', 'utf8')).replace(/Share anonymous usage statistics/g, 'Allow anonymous usage statistics');
    expect(/cosmetics[\s\S]*\b(share|import profile|export profile)\b/i.test(settings.slice(settings.indexOf('buildCosmetics')))).toBe(false);
    const main = readFileSync('src/main.ts', 'utf8');
    expect(/exportProfile|importProfile|shareAchievement|profileCode/.test(main)).toBe(false);
  });
});
