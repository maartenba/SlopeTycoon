import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLE_DEFS, SAMPLE_LICENCES, SAMPLES, BED_SLOTS, UNKNOWN_LICENCE_SAMPLES } from '../../src/config/audioSamples';

/**
 * public/audio/sfx = the recorded CC0 / public-domain samples (second owner exception to "everything but the music is procedural", 2026-11-06; AGENTS.md, public/audio/README.md).
 * The folder holds exactly the files of SAMPLE_DEFS; each has a licence row in public/audio/README.md; only CC0 / public-domain keys are allowed; size guards (every committed binary stays in git history).
 */
const DIR = 'public/audio/sfx';
const readme = readFileSync('public/audio/README.md', 'utf8');
/** OWNER DECISION 2026-11-07 (explicit): exactly this one file may have an UNKNOWN licence (a TikTok groomer clip). Tracked: remove / replace before any commercial release. Do NOT extend this list; every other file needs CC0 / PD. */
const UNKNOWN_LICENCE_ALLOWED = ['bed-groomer-01'];
const TOTAL_BUDGET = 12 * 1024 * 1024, PER_FILE_BUDGET = 400 * 1024;

describe('sfx assets', () => {
  it('the folder holds exactly the files of the sample table (clean ASCII kebab-case names, category prefixes)', () => {
    expect(readdirSync(DIR).sort()).toEqual(SAMPLE_DEFS.map((s) => `${s.id}.mp3`).sort());
    for (const s of SAMPLE_DEFS) expect(s.id).toMatch(/^(step|thud|bird|bell|bed|leaves|lap|creak|avalanche|mach|thunder|creature)(-[a-z0-9]+)+$/);
  });
  it('size guard: the folder stays under the budget, no single file is large', () => {
    let total = 0;
    for (const s of SAMPLE_DEFS) { const n = statSync(`${DIR}/${s.id}.mp3`).size; total += n; expect(n, s.id).toBeLessThan(PER_FILE_BUDGET); }
    expect(total).toBeLessThan(TOTAL_BUDGET);
  });
  it('every file is an mp3 with no ID3 tag / cover art (the Xing / LAME header only)', () => {
    for (const s of SAMPLE_DEFS) { const b = readFileSync(`${DIR}/${s.id}.mp3`).subarray(0, 4096); expect(b.subarray(0, 3).toString('latin1'), s.id).not.toBe('ID3'); expect(b[0], s.id).toBe(0xff); expect(b.includes(Buffer.from('APIC')), s.id).toBe(false); }
  });
  it('every shipped sample has a licence row (file, source, author, licence key) in public/audio/README.md; only CC0 / PD keys; the row key matches the table', () => {
    for (const s of SAMPLE_DEFS) {
      if (UNKNOWN_LICENCE_ALLOWED.includes(s.id)) expect(s.licence, s.id).toBe('UNKNOWN'); else expect(SAMPLE_LICENCES as readonly string[], s.id).toContain(s.licence);
      const row = readme.split('\n').find((l) => l.startsWith(`| \`${s.id}.mp3\``));
      expect(row, `${s.id}.mp3 has no row in public/audio/README.md`).toBeTruthy();
      const cells = row!.split('|').map((c) => c.trim()).filter(Boolean);
      expect(cells.length, s.id).toBeGreaterThanOrEqual(6);
      if (s.licence === 'UNKNOWN') expect(cells[4], s.id).toMatch(/^UNKNOWN \(owner decision 2026-11-07/); else expect(cells[4], s.id).toBe(s.licence); // licence key column
      expect(cells[1]!.length, s.id).toBeGreaterThan(3); expect(cells[3]!.length, s.id).toBeGreaterThan(2); // source, author
    }
    expect([...SAMPLE_LICENCES].sort()).toEqual(['CC0', 'CC0-collection', 'CC0-freesound', 'PD']);
    const rows = readme.split('\n').filter((l) => /^\| `[a-z0-9-]+\.mp3` \| (OpenGameArt|Wikimedia Commons|Freesound|TikTok)/.test(l));
    expect(rows.length).toBe(SAMPLE_DEFS.length); // no row without a file
  });
  it('the single unknown-licence file is an explicit, visible, tracked exception (owner decision 2026-11-07)', () => {
    expect(SAMPLE_DEFS.filter((d) => d.licence === 'UNKNOWN').map((d) => d.id)).toEqual(UNKNOWN_LICENCE_ALLOWED);
    expect([...UNKNOWN_LICENCE_SAMPLES]).toEqual(UNKNOWN_LICENCE_ALLOWED);
    expect(readme).toMatch(/## Files with unknown licence/); expect(readme).toMatch(/remove or replace before any commercial release/i);
    const row = readme.split('\n').find((l) => l.startsWith('| `bed-groomer-01.mp3`'))!;
    expect(row).toContain('TikTok clip (downloaded via ssstik.io; author unknown)'); expect(row).toContain('UNKNOWN (owner decision 2026-11-07; no licence verified)');
    expect(readFileSync('docs/audio.md', 'utf8')).toContain('Replace bed-groomer-01 with a CC0 recording');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('bed-groomer-01.mp3');
    expect(BED_SLOTS.some((b) => b.sample === 'bed-groomer-01' && b.layer === 'snowcat' && b.gate === 'snowcat')).toBe(true);
  });
  it('nothing from the unclear-provenance (Public Domain Mark) material is shipped', () => {
    for (const n of readdirSync(DIR)) expect(n).not.toMatch(/aporee|pdm/i);
    expect(readme).not.toMatch(/ia-aporee_/);
  });
  it('licence of every Freesound / collection sample is flagged for the owner to verify in the README', () => {
    expect(SAMPLE_DEFS.some((s) => s.licence === 'CC0-freesound')).toBe(true);
    expect(readme).toMatch(/Owner to verify/);
  });
  it('credit wording: "Sound recordings: mostly CC0, mostly from Freesound; one clip of unknown origin"; rows whose source page is not recorded say "Freesound (CC0)"; no row names a source it cannot back up', () => {
    const credit = 'Sound recordings: mostly CC0, mostly from Freesound; one clip of unknown origin';
    expect(readme).toContain(credit);
    expect(readFileSync('src/ui/components/StMainMenu.ts', 'utf8')).toContain(`${credit} (see the audio README in the project)`);
    expect(readFileSync('scripts/licenses.ts', 'utf8')).toContain(credit); expect(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')).toContain(credit);
    for (const s of SAMPLE_DEFS.filter((d) => d.licence === 'CC0-collection')) {
      const row = readme.split('\n').find((l) => l.startsWith(`| \`${s.id}.mp3\``))!;
      expect(row.split('|')[2]!.trim(), s.id).toBe('Freesound (CC0)'); // no per-file page recorded
    }
    expect(SAMPLE_DEFS.filter((d) => d.licence === 'CC0-collection').map((d) => d.id).sort()).toEqual(['avalanche-03', 'bed-morning-01', 'thud-dull-01']);
  });
  it('the shipped loops fit the decoded memory cap together with their one-shots in the worst realistic scene', () => {
    // ~12 simultaneously audible beds at their decode rate (mono float32)
    const bytes = BED_SLOTS.slice(0, 12).reduce((a, sl) => { const d = SAMPLE_DEFS.find((s) => s.id === sl.sample)!; return a + d.dur * (d.rate ?? 48000) * 4; }, 0);
    expect(bytes).toBeLessThan(SAMPLES.memoryCapMB * 1048576 * 1.6);
    for (const f of SAMPLE_DEFS) expect(existsSync(`${DIR}/${f.id}.mp3`)).toBe(true);
  });
});
