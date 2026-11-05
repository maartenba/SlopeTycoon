import { existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENU_MUSIC } from '../../src/config/audioMusic';

/** The ONLY audio asset files allowed in the repo: the two owner-provided Suno menu tracks (owner decision, 2026-11-05; AGENTS.md, public/audio/README.md). Everything else is procedural. */
const ALLOWED = ['README.md', 'menu-seasonal-menu.mp3', 'menu-seasons-of-management.mp3'];
describe('menu music assets', () => {
  it('public/audio holds exactly the allow-listed files and the table points at them', () => {
    expect(readdirSync('public/audio').sort()).toEqual(ALLOWED);
    for (const t of MENU_MUSIC.tracks) { expect(existsSync(`public/audio/${t.file}`)).toBe(true); expect(statSync(`public/audio/${t.file}`).size).toBeLessThan(4 * 1024 * 1024); }
  });
  it('no other audio files anywhere in src / public / site', () => {
    const bad: string[] = [];
    const walk = (d: string): void => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (/\.(mp3|ogg|wav|flac|m4a|aac|opus)$/i.test(n) && !p.startsWith('public/audio/')) bad.push(p); } };
    for (const d of ['src', 'public', 'site']) walk(d);
    expect(bad).toEqual([]);
  });
  it('credit wording is plain and the README says owner-provided, not CC', () => {
    expect(MENU_MUSIC.tracks.length).toBe(2);
  });
});
