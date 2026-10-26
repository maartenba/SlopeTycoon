import { describe, expect, it } from 'vitest';
import { YearReportGate, barChartSvg, lineChartSvg, columnChartSvg, medalSvg, highlightLines, statTiles, type GameSpeed } from '../../src/ui/yearReportFormat';
import { computeYearReport } from '../../src/sim/meta/YearReport';
import { fillDemoStats } from '../../src/sim/meta/demoStats';
import { StatsHistory } from '../../src/sim/meta/StatsHistory';

function setup(o: { speed?: GameSpeed; enabled?: boolean; tutorial?: boolean; ended?: boolean; demo?: boolean; dialogs?: number } = {}) {
  const st = { speed: (o.speed ?? 3) as GameSpeed, enabled: o.enabled ?? true, tutorial: o.tutorial ?? false, ended: o.ended ?? false, demo: o.demo ?? false, dialogs: o.dialogs ?? 0, shown: [] as number[], sets: [] as GameSpeed[] };
  const gate = new YearReportGate({
    getSpeed: () => st.speed, setSpeed: (s) => { st.speed = s; st.sets.push(s); }, enabled: () => st.enabled, tutorialActive: () => st.tutorial, ended: () => st.ended, demo: () => st.demo,
    dialogsOpen: () => st.dialogs, show: (y) => { st.shown.push(y); },
  });
  return { st, gate };
}

describe('year report auto-pause gate', () => {
  it('pauses on open and restores the previous speed on close', () => {
    const { st, gate } = setup({ speed: 3 });
    expect(gate.onReport(1)).toBe('shown');
    expect(st.speed).toBe(0); expect(st.shown).toEqual([1]);
    gate.closed();
    expect(st.speed).toBe(3); expect(st.sets).toEqual([0, 3]);
  });
  it('a game that was already paused stays paused', () => {
    const { st, gate } = setup({ speed: 0 });
    gate.onReport(1); expect(st.sets).toEqual([]); gate.closed(); expect(st.speed).toBe(0); expect(st.sets).toEqual([]);
  });
  it('does not override a speed the player picked while the report was open', () => {
    const { st, gate } = setup({ speed: 2 });
    gate.onReport(1); st.speed = 1; gate.closed();
    expect(st.speed).toBe(1); expect(st.sets).toEqual([0]);
  });
  it('never shows during the tutorial, the title demo, a bankrupt game or when switched off', () => {
    for (const o of [{ tutorial: true }, { demo: true }, { ended: true }, { enabled: false }]) {
      const { st, gate } = setup(o);
      const r = gate.onReport(1);
      expect(st.shown, JSON.stringify(o)).toEqual([]); expect(st.speed).toBe(3);
      if (!('tutorial' in o)) expect(r).toBe('skipped');
    }
  });
  it('queues behind open dialogs and shows when they are gone; bankruptcy while queued drops it; no restore after the game ended', () => {
    const { st, gate } = setup({ dialogs: 1 });
    expect(gate.onReport(1)).toBe('queued'); expect(gate.onReport(1)).toBe('queued'); expect(gate.pending).toEqual([1]);
    expect(st.speed).toBe(3);
    st.dialogs = 0; expect(gate.pump()).toBe(true); expect(st.shown).toEqual([1]); expect(st.speed).toBe(0);
    st.ended = true; gate.closed(); expect(st.speed).toBe(0); // the bankrupt end screen keeps the clock stopped
    const q = setup({ dialogs: 1 }); q.gate.onReport(2); q.st.ended = true; q.st.dialogs = 0; expect(q.gate.pump()).toBe(false); expect(q.gate.pending).toEqual([]);
  });
  it('shows queued reports one at a time', () => {
    const { st, gate } = setup();
    gate.onReport(1); gate.onReport(2);
    expect(st.shown).toEqual([1]); gate.closed(); expect(st.speed).toBe(3);
    gate.pump(); expect(st.shown).toEqual([1, 2]); gate.closed(); expect(st.speed).toBe(3);
  });
});

describe('year report view helpers', () => {
  const h = new StatsHistory(null); fillDemoStats(h, 3);
  const r = computeYearReport({ hist: h, year: 3, mapSize: 128, name: 'Your resort', prev: computeYearReport({ hist: h, year: 2, mapSize: 128, name: 'Your resort' }) });
  it('stat tiles and highlights are plain text lines', () => {
    const t = statTiles(r);
    expect(t.map((x) => x.key)).toEqual(['guests', 'income', 'profit', 'rating']);
    expect(t.every((x) => x.chip)).toBe(true);
    const lines = highlightLines(r);
    expect(lines.length).toBeGreaterThan(5); expect(lines.every((l) => l.length < 90)).toBe(true);
  });
  it('charts and medals are well-formed SVG strings without NaN', () => {
    const svgs = [barChartSvg([5, -3, 0, 8], { w: 200, h: 60 }), barChartSvg([], { w: 200, h: 60 }), lineChartSvg([1, null, 3, 4.5], { w: 200, h: 60, min: 0, max: 5 }), lineChartSvg([], { w: 200, h: 60 }), columnChartSvg([0, 0, 0], { w: 200, h: 60 }), medalSvg(0), medalSvg(1), medalSvg(2), medalSvg(3)];
    for (const s of svgs) { expect(s.startsWith('<svg')).toBe(true); expect(s.endsWith('</svg>')).toBe(true); expect(/NaN|undefined|Infinity/.test(s)).toBe(false); }
    expect(medalSvg(3)).not.toBe(medalSvg(1));
  });
});
