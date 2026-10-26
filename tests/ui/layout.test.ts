import { describe, expect, it } from 'vitest';
import { NARROW_PX, PANELS, intersects, zoneRect, type Rect, type Zone } from '../../src/ui/layout';
import { COLORS, TOKENS, tokensCss } from '../../src/ui/tokens';

describe('anchor zone registry', () => {
  it('no two always-visible components share an anchor zone (collapsed or open)', () => {
    const seen = new Map<string, string>();
    for (const p of PANELS.filter((x) => x.alwaysVisible)) for (const z of [p.zone, p.openZone].filter(Boolean) as Zone[]) {
      expect(seen.has(z), `${p.tag} and ${seen.get(z)} share zone ${z}`).toBe(false);
      seen.set(z, p.tag);
    }
  });
  it('the debug button and the assistant never share a zone', () => {
    const z = (t: string): Zone => PANELS.find((p) => p.tag === t)!.zone;
    expect(z('st-debug')).not.toBe(z('st-assistant'));
  });
  for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700]] as const) {
    it(`zone rectangles of all visible components, with debug/drawer (and news when wide) open, do not overlap at ${vw}x${vh}`, () => {
      const narrow = vw < NARROW_PX;
      const rects: Array<{ tag: string; r: Rect }> = [];
      for (const p of PANELS.filter((x) => x.alwaysVisible || x.tag === 'st-assistant')) {
        const open = p.tag === 'st-debug' || (p.tag === 'st-news' && !narrow) || p.tag === 'st-dock';
        const z = open && p.openZone ? p.openZone : p.zone;
        const r = zoneRect(z, vw, vh, open);
        expect(r, `${p.tag} @ ${z}`).toBeTruthy();
        rects.push({ tag: p.tag, r: r! });
        if (p.tag === 'st-dock') rects.push({ tag: 'st-dock-row', r: zoneRect('bottom-center', vw, vh)! });
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        expect(intersects(rects[i]!.r, rects[j]!.r), `${rects[i]!.tag} overlaps ${rects[j]!.tag} at ${vw}x${vh}`).toBe(false);
      }
      for (const { tag, r } of rects) { expect(r.x, tag).toBeGreaterThanOrEqual(0); expect(r.x + r.w, tag).toBeLessThanOrEqual(vw); expect(r.y, tag).toBeGreaterThanOrEqual(0); expect(r.y + r.h, tag).toBeLessThanOrEqual(vh); }
    });
  }
  it('the advice card (340x214) + avatar row fits inside the assistant zone, so it never overlaps other panels (wide windows)', () => {
    for (const [vw, vh] of [[1280, 800], [1920, 1080]] as const) {
      const z = zoneRect('left-assist', vw, vh)!;
      const card = { x: 8, y: vh - 84 - 56 - 6 - 214, w: 340, h: 214 + 6 + 56 };
      expect(card.x).toBeGreaterThanOrEqual(z.x); expect(card.x + card.w).toBeLessThanOrEqual(z.x + z.w);
      expect(card.y).toBeGreaterThanOrEqual(z.y); expect(card.y + card.h).toBeLessThanOrEqual(z.y + z.h);
      for (const other of ['left-debug', 'right-goals', 'right-news', 'bottom-drawer', 'top-left', 'top-right'] as const) {
        expect(intersects(card, zoneRect(other, vw, vh, other === 'right-news' || other === 'left-debug')!), `${other} @ ${vw}x${vh}`).toBe(false);
      }
    }
  });
  it('the build drawer is low-profile, bounded by the viewport and sits directly above the dock row', () => {
    for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700], [1100, 700]] as const) {
      const d = zoneRect('bottom-drawer', vw, vh)!;
      expect(d.h).toBeLessThanOrEqual(190);
      expect(d.h / vh).toBeLessThan(0.3);
      expect(d.w).toBeLessThanOrEqual(1200);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.w).toBeLessThanOrEqual(vw);
      expect(d.y + d.h).toBeLessThanOrEqual(zoneRect('bottom-center', vw, vh)!.y);
    }
    expect(zoneRect('bottom-drawer', 1920, 1080)!.w).toBeGreaterThan(zoneRect('bottom-drawer', 1280, 800)!.w);
  });
  it('the assistant collapses to a badge under the narrow breakpoint', () => {
    expect(zoneRect('left-assist', NARROW_PX - 1, 700)!.w).toBeLessThan(100);
    expect(zoneRect('left-assist', NARROW_PX, 800)!.w).toBe(340);
  });
});

describe('goals card anchor', () => {
  it('lives in its own right-column zone under the HUD block, clear of the news feed (open) and the assistant at every tested size', () => {
    expect(PANELS.find((p) => p.tag === 'st-goals')).toMatchObject({ zone: 'right-goals', alwaysVisible: true });
    for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700]] as const) {
      const g = zoneRect('right-goals', vw, vh)!;
      expect(intersects(g, zoneRect('top-right', vw, vh)!), `HUD @ ${vw}x${vh}`).toBe(false);
      expect(intersects(g, zoneRect('right-news', vw, vh, vw >= NARROW_PX)!), `news @ ${vw}x${vh}`).toBe(false);
      expect(intersects(g, zoneRect('left-assist', vw, vh)!), `assistant @ ${vw}x${vh}`).toBe(false);
      expect(intersects(g, zoneRect('top-center', vw, vh)!), `toasts @ ${vw}x${vh}`).toBe(false);
      expect(g.x + g.w).toBeLessThanOrEqual(vw);
    }
    // the assistant stays the documented fixed 340x214 bubble; the goals card never reaches into its column
    const a = zoneRect('left-assist', 1280, 800)!; expect(a.w).toBe(340);
  });
});

describe('scenario card anchor', () => {
  it('replaces the goals card in the same right-column zone: same footprint, clear of the HUD, news, assistant and toasts at every tested size', () => {
    const c = PANELS.find((p) => p.tag === 'st-scenario-card')!;
    expect(c.zone).toBe(PANELS.find((p) => p.tag === 'st-goals')!.zone);
    expect(c.alwaysVisible).toBe(false); // scenario games hide st-goals: exactly one of the two occupies the zone
    for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700]] as const) {
      const g = zoneRect(c.zone, vw, vh)!;
      expect(g.h).toBe(140);
      for (const other of ['top-right', 'left-assist', 'top-center'] as const) expect(intersects(g, zoneRect(other, vw, vh)!), `${other} @ ${vw}x${vh}`).toBe(false);
      expect(intersects(g, zoneRect('right-news', vw, vh, vw >= NARROW_PX)!), `news @ ${vw}x${vh}`).toBe(false);
    }
  });
});

describe('design tokens', () => {
  it('fonts never go below 11px and the css block is well-formed', () => {
    expect(TOKENS.fsMin).toBeGreaterThanOrEqual(11);
    const css = tokensCss();
    expect(css).toContain('--sp-1:4px');
    expect(css).toContain('--fs-md:12px');
    expect(css).toContain('--c-btn-hover:');
    expect(Object.keys(COLORS).length).toBeGreaterThan(5);
  });
});

describe('recap / month-end card anchor', () => {
  for (const [vw, vh] of [[1280, 800], [1920, 1080], [1000, 700]] as const) {
    it(`the transient card zone is clear of the right column + goals, assistant, news, debug (open), dock and (>= 800 px tall) the open build drawer at ${vw}x${vh}`, () => {
      const c = zoneRect('top-card', vw, vh)!;
      expect(c.w).toBe(320);
      const others: Zone[] = ['top-left', 'left-debug', 'top-right', 'right-goals', 'left-assist', 'right-news', 'bottom-drawer', 'bottom-center', 'bottom-left', 'bottom-right'];
      expect(c.y).toBeGreaterThanOrEqual(56 + 4 * 38); // below a full stack of four toasts
      for (const z of others) if (!(z === 'bottom-drawer' && vh < 800)) expect(intersects(c, zoneRect(z, vw, vh, z === 'right-news')!), `${z} overlaps the card`).toBe(false);
      expect(intersects(c, zoneRect('top-center', vw, vh)!)).toBe(false); // sits right below the toasts
    });
  }
  it('is registered as a transient (not always visible) panel', () => {
    expect(PANELS.find((p) => p.tag === 'st-recap')).toMatchObject({ zone: 'top-card', alwaysVisible: false });
  });
});
