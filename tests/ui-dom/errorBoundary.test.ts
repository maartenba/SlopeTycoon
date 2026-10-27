import { describe, expect, it } from 'vitest';
import { installErrorBoundary } from '../../src/ui/errorBoundary';

describe('error boundary -> analytics hook', () => {
  it('reports the error CLASS once per distinct error, never the message', () => {
    const l = new Map<string, (e: unknown) => void>();
    const host = { addEventListener: (t: string, f: (e: unknown) => void) => { l.set(t, f); }, removeEventListener: () => {} };
    const kinds: string[] = [];
    installErrorBoundary(host, { notify: () => {}, log: () => {}, onReport: (k) => kinds.push(k) });
    l.get('error')!({ error: new Error('secret save name') }); l.get('error')!({ error: new Error('secret save name') });
    l.get('unhandledrejection')!({ reason: 'boom' });
    expect(kinds).toEqual(['error', 'unhandledrejection']);
  });
});
