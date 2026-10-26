import { readFileSync } from 'node:fs';
export interface ManifestShot { id: string; alt: string; caption?: string; pages: string[]; kind: 'harness' | 'copy'; shot?: Record<string, unknown>; source?: string }
export interface Manifest { shots: ManifestShot[] }
export const loadManifest = (file = 'site/shots.json'): Manifest => JSON.parse(readFileSync(file, 'utf8')) as Manifest;
export function validateManifest(m: Manifest): string[] {
  const errs: string[] = [], seen = new Set<string>();
  for (const s of m.shots) {
    if (!/^[a-z0-9-]+$/.test(s.id)) errs.push(`bad id '${s.id}'`);
    if (seen.has(s.id)) errs.push(`duplicate id '${s.id}'`); seen.add(s.id);
    if (!s.alt || s.alt.length < 15) errs.push(`${s.id}: alt text too short`);
    if (s.kind === 'harness' && !s.shot) errs.push(`${s.id}: harness shot needs 'shot'`);
    if (s.kind === 'copy' && !s.source) errs.push(`${s.id}: copy needs 'source'`);
    if (!s.pages?.length) errs.push(`${s.id}: no pages`);
  }
  return errs;
}
