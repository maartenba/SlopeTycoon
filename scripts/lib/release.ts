export type Bump = 'patch' | 'minor' | 'major';
export function bumpVersion(v: string, kind: Bump): string {
  const [a, b, c] = v.split('.').map(Number) as [number, number, number];
  return kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
export function releaseChangelog(md: string, version: string, date: string): string {
  if (!md.includes('## [Unreleased]')) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  return md.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${date}`);
}
