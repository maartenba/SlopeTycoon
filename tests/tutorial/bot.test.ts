import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { Layer, sweepBrush } from '../../src/world/Networks';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { placeLift } from '../../src/sim/Lift';
import { STEPS } from '../../src/tutorial/steps';
import { makeEngine, runDoItBot, tutorialSim } from './helpers';

describe('tutorial bots (scenario map)', () => {
  it("'Do it for me' on every step reaches complete, then the resort has guests and a positive rating", () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    const rep = runDoItBot(sim, eng, { ticksPerStep: 0 }); // no time passes between steps: the 'guests' lesson must fast-forward itself
    expect(rep.failed).toEqual([]);
    expect(eng.status).toBe('complete');
    expect(rep.done).toEqual(STEPS.filter((s) => rep.done.includes(s.id)).map((s) => s.id)); // in lesson order
    expect(eng.state.completed.length).toBe(STEPS.length);
    expect(rep.done).toContain('guests');
    // the summer pivot ended winter: jump back to the next winter morning and let the resort run for a few days
    sim.jumpToDay(15);
    let peak = 0;
    for (let k = 0; k < 6 * 12; k++) { sim.tick(20); peak = Math.max(peak, sim.guestSim.store.count); } // sample through the days (guests leave at night)
    expect(peak).toBeGreaterThan(0);
    expect(sim.rating.stars).toBeGreaterThan(0);
    expect(sim.finance.ended).toBe(false);
  }, 60000);

  it('the first guests arrive during the guests lesson itself (tutorial winter, assisted fast-forward)', () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    runDoItBot(sim, eng, { until: 'guests', ticksPerStep: 0 });
    expect(eng.current?.id).toBe('guests');
    expect(eng.doItForMe().ok).toBe(true);
    expect(sim.guestSim.store.count + (eng.q.flag('guests:arrived') ? 1 : 0)).toBeGreaterThan(0);
  }, 60000);

  it("'Show me' suggestions are real: placing exactly what each step points at works", () => {
    const sim = tutorialSim();
    const eng = makeEngine(sim, { funding: false });
    eng.start({ fresh: true });
    const placed: string[] = [];
    for (let i = 0; i < 80 && eng.status === 'active'; i++) {
      const s = eng.current!;
      const show = eng.showMe();
      expect(show.ui.length, s.id).toBeGreaterThan(0);
      if (s.ack) { eng.next(); continue; }
      const item = show.ui.find((u) => u.startsWith('drawer:item:'))?.slice('drawer:item:'.length);
      const m = show.map;
      let did = false;
      if (m && show.valid && item && BUILDINGS[item] && !m.line) {
        // building suggestion: rect -> rotation -> real placement
        const def = BUILDINGS[item]!;
        const rot = def.w === def.h || (m.w === def.w && m.h === def.h) ? 0 : 1;
        const out = placeBuilding(sim.env, sim.props, item, m.x, m.y, rot, true, false);
        did = out.ok;
        if (!did) throw new Error(`${s.id}: suggested ${item} at ${m.x},${m.y} rejected: ${out.reasons.join('; ')}`);
        // connect it like the lesson text says
        if (s.id !== 'parking') eng.doItForMe();
      } else if (m && show.valid && s.id === 'lift' && m.extra) {
        const kind = item as 'chair4' | 'tbar' | 'chair2';
        const out = placeLift({ grid: sim.grid, lifts: sim.lifts, economy: sim.economy, access: sim.networks.access }, sim.props, kind, { x: m.x, y: m.y }, { x: m.extra.x, y: m.extra.y }, true);
        if (!out.ok) throw new Error(`lift suggestion rejected: ${out.reasons.join('; ')}`);
        sim.bus.emit('lift:built', { id: out.lift!.id, kind });
        eng.doItForMe(); // station path
        did = true;
      } else if (m && m.line && show.valid && item === 'ski') {
        const painted = sim.networks.paint(Layer.Ski, sweepBrush(m.line, 2, sim.size));
        sim.bus.emit('piste:painted', { layer: 'ski', tiles: painted.painted, erase: false });
        expect(painted.painted).toBeGreaterThan(8);
        did = true;
      } else if (m && m.line && show.valid && (item === 'path' || item === 'road')) {
        const kind = item === 'path' ? 1 : 2;
        const tiles = sim.networks.buildSegment(kind === 1 ? 1 : 2, m.line);
        sim.bus.emit('path:drawn', { kind: item as 'path' | 'road', tiles: tiles.length, erase: false });
        did = true;
      }
      if (!did) { const r = eng.doItForMe(); expect(r.ok, `${s.id} fallback: ${r.reason}`).toBe(true); }
      placed.push(s.id);
      sim.tick(60);
      eng.evaluate();
    }
    expect(eng.status).toBe('complete');
    expect(placed.length).toBeGreaterThan(18);
  }, 60000);
});
