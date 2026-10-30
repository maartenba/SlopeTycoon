import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { Sev } from '../../../src/sim/ops';
import { Incidents } from '../../../src/sim/ops/Incidents';
import { formatEvent, type NewsCtx } from '../../../src/ui/newsFormat';
import { GAME_EVENT_NAMES } from '../../../src/core/events';
import { EVENT_SAMPLES } from '../../ui/eventSamples';

const ALLOWED = new Set(['recovered', 'hospitalised', 'evacuated', 'left']);

describe('incidents are never fatal', () => {
  it('property: outcomes over many seeds (neglected criticals, trapped, attacks, strands) stay in the allowed set', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const covered = seed % 2 === 0;
      const m = mkSafety({ seed, guests: new FakeGuests(64), buildings: covered ? [mkB('patrolHub', 10, 10)] : [] });
      m.safety.resync();
      const kinds = ['injury', 'buried', 'attack', 'stranded'] as const;
      for (let k = 0; k < 10; k++) {
        m.guests.add(k + 1, 12 + k * 3, 20);
        m.safety.incidents.report(kinds[k % 4]!, 12 + k * 3, 20, (k % 3) as 0 | 1 | 2, k + 1, k % 4 === 1 ? { survival: 8 } : undefined);
      }
      run(m.safety, 900);
      expect(m.safety.incidents.open.length, `seed ${seed}`).toBe(0);
      const s = m.safety.incidents.stats();
      expect(s.resolved).toBe(10);
      expect(s.recovered + s.hospitalised + s.evacuated + s.left).toBe(10);
      for (const e of m.events) if (e.name === 'incident:resolved') expect(ALLOWED.has((e.p as { outcome: string }).outcome), `seed ${seed}`).toBe(true);
      for (const g of m.guests.guests.values()) expect(['hospital', 'leave', undefined]).toContain(g.gone);
    }
  });

  it('critical injury left unresolved ends hospitalised with a heavy penalty', () => {
    const m = mkSafety({ seed: 3, buildings: [] }); m.safety.resync();
    m.guests.add(1, 20, 20);
    const inc = m.safety.incidents.report('injury', 20, 20, Sev.Critical, 1)!;
    run(m.safety, 100);
    expect(inc.outcome).toBe('hospitalised'); expect(inc.severe).toBe(true);
    expect(m.guests.guests.get(1)!.gone).toBe('hospital');
    const s = m.safety.incidents.stats();
    expect(s.severe).toBe(1); expect(s.penalty).toBeGreaterThanOrEqual(0.12 * 0.8);
  });

  it('old save blobs with fatal outcomes/stats load as severe hospitalisations', () => {
    const m = mkSafety({ seed: 1 });
    const inc = m.safety.incidents;
    inc.load({
      open: [{ id: 4, kind: 'buried', x: 1, y: 1, severity: 2, guestId: 0, createdTick: 0, state: 'open', responder: 'none', eta: 0, responderId: 0, deadline: 9, responseTicks: 0, escalated: false, outcome: 'fatal' }],
      nextId: 5, rng: 7, st: { resolved: 6, respSum: 10, recovered: 1, hospitalised: 2, fatal: 3, left: 0, avoided: 1, esc: 0, created: 6 },
    });
    const s = inc.stats();
    expect(s.hospitalised).toBe(5); expect(s.severe).toBe(3); expect(s.evacuated).toBe(0);
    expect(Object.keys(s)).not.toContain('fatal');
    expect(inc.open[0]!.outcome).toBe('hospitalised');
    expect(() => inc.hash()).not.toThrow();
    expect(inc).toBeInstanceOf(Incidents);
  });
});

const FORBIDDEN = /\b(fatal(ly|ity|ities)?|died|dies|dying|death|deaths|deadly|dead|killed|kills?|corpses?|casualt(y|ies)|buried|burial|perish\w*|lifeless)\b/i;

describe('forbidden words (user-facing text)', () => {
  const ctx: NewsCtx = {
    liftName: (id) => `Chairlift ${id}`, money: (n) => `$${n}`, locate: () => ({ x: 1, y: 2 }),
    where: () => ({ name: 'the upper bowl', on: 'on Blue Run 3', near: 'near Hut 2' }),
  };
  it('news formatters never mention death', () => {
    for (const n of GAME_EVENT_NAMES) {
      const p = (EVENT_SAMPLES as Record<string, unknown>)[n]; if (!p) continue;
      const r = formatEvent(n, p as never, ctx);
      if (r) expect(FORBIDDEN.test(r.text), `${n}: ${r.text}`).toBe(false);
    }
    for (const outcome of ['recovered', 'hospitalised', 'evacuated']) for (const kind of ['injury', 'buried', 'attack', 'stranded']) for (const severe of [false, true]) {
      const r = formatEvent('incident:resolved', { id: 1, responder: 'heli', responseTicks: 3, outcome, kind, severe } as never, ctx);
      if (r) expect(FORBIDDEN.test(r.text), r.text).toBe(false);
    }
    for (const kind of ['injury', 'buried', 'attack', 'stranded']) for (const severity of [1, 2]) {
      const r = formatEvent('incident:created', { id: 1, kind, severity, x: 1, y: 2, guestId: 3 }, ctx)!;
      expect(FORBIDDEN.test(r.text), r.text).toBe(false);
    }
    expect(formatEvent('incident:avalanche', { x: 1, y: 2, severity: 2, buried: 2 }, ctx)!.text).toMatch(/trapped in the snow/);
  });

  it('string literals across src contain no death wording (technical uses allow-listed)', () => {
    const ALLOW = /Burials possible; patrol required|dead.?end|dead band|dead weight|dead snag|dead tree|dead flat|spiral of death|dead members/i;
    const files: string[] = [];
    const walk = (d: string): void => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(p)) files.push(p); } };
    walk(join(__dirname, '../../../src'));
    const hits: string[] = [];
    for (const f of files) {
      if (/AudioEngine|DemoScene/.test(f)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        const lits = line.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
        for (const raw of lits) { const l = raw.replace(/\$\{[^}]*\}/g, ''); if (/\s/.test(l) && FORBIDDEN.test(l) && !ALLOW.test(l)) hits.push(`${f}:${i + 1}: ${l.slice(0, 100)}`); }
      });
    }
    expect(hits).toEqual([]);
  });
});
