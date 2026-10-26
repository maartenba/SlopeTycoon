// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { el, registerComponents } from '../../src/ui';
import { PROFILE_COLORS } from '../../src/ui/components/StProfile';
import type { SlopeProfile } from '../../src/sim/PisteStats';

registerComponents();

const prof = (diffs: number[]): SlopeProfile => {
  const samples = diffs.map((d, i) => ({ distM: i * 10, altM: 2000 - i * 6, slopePct: 40, difficulty: d }));
  return { samples, lengthM: (diffs.length - 1) * 10, dropM: (diffs.length - 1) * 6, avgPct: 60, maxPct: 80, startAltM: 2000, endAltM: 2000 - (diffs.length - 1) * 6 };
};

describe('st-profile', () => {
  it('constructor adds no attributes / children to the host', () => {
    const e = document.createElement('st-profile');
    expect(e.attributes.length).toBe(0);
    expect(e.childNodes.length).toBe(0);
  });
  it('draws one coloured polygon per segment, by difficulty, plus the snowline marker; show(null) hides', () => {
    const p = el('st-profile'); document.body.append(p);
    const card = p.shadowRoot!.querySelector('.card') as HTMLElement;
    expect(card.hidden).toBe(true);
    p.show({ kind: 'piste', title: 'Ski piste profile', profile: prof([0, 0, 1, 2, 3]), snowlineM: 1985, note: 'careful' });
    expect(card.hidden).toBe(false);
    const polys = Array.from(p.shadowRoot!.querySelectorAll('polygon'));
    expect(polys.length).toBe(4);
    expect(polys.map((q) => q.getAttribute('fill'))).toEqual([PROFILE_COLORS[0], PROFILE_COLORS[1], PROFILE_COLORS[2], PROFILE_COLORS[3]]);
    expect(p.shadowRoot!.textContent).toContain('snowline');
    expect(p.shadowRoot!.textContent).toContain('drop 24 m');
    expect(p.shadowRoot!.textContent).toContain('careful');
    p.show(null);
    expect(card.hidden).toBe(true);
  });
  it('a lift profile says climb, not drop', () => {
    const p = el('st-profile'); document.body.append(p);
    p.show({ kind: 'lift', title: 'Chairlift line', profile: prof([0, 1, 1]) });
    expect(p.shadowRoot!.textContent).toContain('climb');
  });
});
