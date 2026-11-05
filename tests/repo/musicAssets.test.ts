import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAR_PLAYLIST, FALLBACK, MENU_PLAYLIST, MUSIC_TARGET_LUFS, PLAYLISTS, SITUATION_IDS, TRACKS, TRACK_BY_ID } from '../../src/config/audioMusic';
import { trimFor } from '../../src/audio/musicPlaylist';

/**
 * The ONLY audio asset files allowed in the repo: the owner-provided Suno music tracks listed in TRACKS (owner decision, 2026-11-05; AGENTS.md, public/audio/README.md).
 * Sound effects and ambience are procedural. Adding a track = add the file, a TRACKS row (id, file, title, group, lufs, trim) and a playlist entry, then extend ALLOWED.
 */
const ALLOWED = ['README.md', ...TRACKS.map((t) => t.file)].sort();
/** Budget for the whole folder (bytes). Reason: every committed mp3 stays in git history forever and the service worker caches what is played (about this much on disk at most); 37 MB today, re-encoded to ~115 kbps VBR. Raise it only with a reason. */
const AUDIO_BUDGET = 42 * 1024 * 1024;
const PER_FILE_BUDGET = 3.2 * 1024 * 1024;

describe('music assets', () => {
  it('public/audio holds exactly the files of the track table (clean ASCII kebab-case names) and nothing else', () => {
    expect(readdirSync('public/audio').sort()).toEqual(ALLOWED);
    for (const t of TRACKS) { expect(t.file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.mp3$/); expect(existsSync(`public/audio/${t.file}`)).toBe(true); }
    expect(new Set(TRACKS.map((t) => t.file)).size).toBe(TRACKS.length); expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
  });
  it('size guard: the whole folder stays under the budget and no single file is huge', () => {
    let total = 0;
    for (const t of TRACKS) { const n = statSync(`public/audio/${t.file}`).size; total += n; expect(n, t.file).toBeLessThan(PER_FILE_BUDGET); }
    expect(total).toBeLessThan(AUDIO_BUDGET);
  });
  it('every file is an mp3 without cover art or descriptive tags (at most the 44-byte ffmpeg encoder tag, no APIC / title / artist)', () => {
    for (const t of TRACKS) { const b = readFileSync(`public/audio/${t.file}`).subarray(0, 4096); if (b.subarray(0, 3).toString('latin1') === 'ID3') expect(((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) + 10, t.file).toBeLessThanOrEqual(64); const txt = b.toString('latin1'); for (const f of ['APIC', 'TIT2', 'TPE1', 'TALB']) expect(txt, t.file).not.toContain(f); }
  });
  it('trim table is complete: loudness-normalised to the group target, finite, every track has a measured lufs', () => {
    for (const t of TRACKS) {
      expect(t.lufs).toBeLessThan(-10); expect(t.lufs).toBeGreaterThan(-25);
      expect(t.trim, t.id).toBeCloseTo(trimFor(t.lufs, MUSIC_TARGET_LUFS[t.group]), 2);
      expect(t.trim).toBeGreaterThan(0.3); expect(t.trim).toBeLessThanOrEqual(1); // measured true peaks are <= -2.4 dBFS and the targets sit 2-4 dB below the files: no clipping
      expect(t.title.length).toBeGreaterThan(2);
    }
    expect(MUSIC_TARGET_LUFS.game).toBe(-20); expect(MUSIC_TARGET_LUFS.bar).toBe(-18); // 3 dB below the old procedural targets (-17 / -15): the owner found the default level a bit loud
  });
  it('every playlist entry exists and has the right group; every situation has a playlist; fallbacks resolve', () => {
    for (const s of SITUATION_IDS) { expect(PLAYLISTS[s].length).toBeGreaterThan(0); for (const id of PLAYLISTS[s]) expect(TRACK_BY_ID.get(id)?.group, id).toBe('game'); expect(PLAYLISTS[FALLBACK[s]].length).toBeGreaterThan(0); }
    for (const id of MENU_PLAYLIST) expect(TRACK_BY_ID.get(id)?.group).toBe('menu');
    for (const id of BAR_PLAYLIST) expect(TRACK_BY_ID.get(id)?.group).toBe('bar');
    const used = new Set([...Object.values(PLAYLISTS).flat(), ...MENU_PLAYLIST, ...BAR_PLAYLIST]);
    for (const t of TRACKS) expect(used.has(t.id), `${t.id} is in no playlist`).toBe(true);
  });
  it('no other audio files anywhere in src / public / site', () => {
    const bad: string[] = [];
    const walk = (d: string): void => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (/\.(mp3|ogg|wav|flac|m4a|aac|opus)$/i.test(n) && !p.startsWith('public/audio/')) bad.push(p); } };
    for (const d of ['src', 'public', 'site']) walk(d);
    expect(bad).toEqual([]);
  });
  it('the README says owner-provided Suno music, no licence asserted', () => {
    const r = readFileSync('public/audio/README.md', 'utf8');
    expect(r).toContain('Suno'); expect(r).toContain('owner'); expect(r).toContain('No licence is asserted');
  });
});
