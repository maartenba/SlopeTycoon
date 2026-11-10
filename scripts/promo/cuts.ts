/* eslint-disable @typescript-eslint/no-explicit-any -- manifest JSON */
/** Pure cut helpers for the promo assembler (docs/promo-video.md): the `--cut` argument and the exact length of every cut. No node / DOM imports (unit tested). */
export type Cut = '90' | '30';

/** `--cut 90|30|both` (default 90). Anything else is an error: the old parser silently turned every unknown value into 90. */
export function parseCuts(value: string | undefined): Cut[] {
  const v = (value ?? '90').trim().toLowerCase();
  if (v === '90') return ['90'];
  if (v === '30') return ['30'];
  if (v === 'both' || v === 'all' || v === '90,30' || v === '30,90') return ['90', '30'];
  throw new Error(`--cut must be 90, 30 or both (got "${value}")`);
}

export interface CutClip { id: string; len: number; from: number; endCard: boolean; shot: any }
/** The clips of one cut in order, with the length each one contributes (a clip's `cuts.cNN` is `true` = the whole shot, or `{ len, from }`). The end card is the last one. */
export function cutClips(film: any, cut: Cut): CutClip[] {
  const shots: any[] = [...film.shots, { id: 'end-card', endCard: true, len: film.endCard.len, cuts: film.endCard.cuts }];
  const key = `c${cut}`;
  const order: string[] = film.cuts[key].order ?? [...film.shots.filter((x: any) => x.cuts[key]).map((x: any) => x.id), 'end-card'];
  return order.map((id) => {
    const s = shots.find((q) => q.id === id || (id === 'end-card' && q.endCard));
    if (!s) throw new Error(`cut ${cut}: unknown shot ${id}`);
    const c = s.cuts[key];
    if (!c) throw new Error(`cut ${cut}: shot ${id} has no ${key} entry`);
    const len: number = (typeof c === 'object' && c.len) || s.len; const from: number = (typeof c === 'object' && c.from) || 0;
    if (!s.endCard && from + len > s.len + 1e-9) throw new Error(`cut ${cut}: ${id} uses ${from}..${from + len} s of a ${s.len} s shot`);
    return { id, len, from, endCard: !!s.endCard, shot: s };
  });
}

/** Exact running time of a cut in seconds: the clips are padded by the crossfade length (frozen last frame), so the crossfades eat the padding and the sum of the lengths IS the total. */
export function cutTotal(film: any, cut: Cut): number { return cutClips(film, cut).reduce((a, c) => a + c.len, 0); }
