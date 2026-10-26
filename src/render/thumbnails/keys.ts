export type ThumbKind = 'building' | 'lift';
/** Cache key: one render per kind/id/pixel size. */
export function thumbKey(kind: ThumbKind, id: string, size: number): string { return `${kind}:${id}@${size}`; }
