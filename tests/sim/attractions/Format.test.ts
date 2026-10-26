import { describe, expect, it } from 'vitest';
import { formatAttractionStats, formatPriceLabel, formatStaff } from '../../../src/ui/attractionFormat';
import type { AttractionInfo } from '../../../src/sim/attractions/Attraction';
import { ACTIVITY_FAR_VIEW_HEIGHT, MAX_BOATS, MAX_FIGURES_PER_ATTRACTION, activityPoses, type ActivityView, type Pose } from '../../../src/render/AttractionActivity';

const info = (o: Partial<AttractionInfo> = {}): AttractionInfo => ({
  id: 1, name: 'Ice Rink', open: true, served: 42, revenue: 1234, balked: 2, reneged: 1, nights: 0, queue: 3, users: 12, capacity: 40,
  price: 6, maxPrice: 25, billing: 'perHour', unitPrice: 6, staff: 1, staffRequired: 2, upkeepPerDay: 10, ...o,
});

describe('inspector formatting helpers', () => {
  it('prints status, usage, revenue, price and staff', () => {
    const l = formatAttractionStats(info());
    expect(l[0]).toBe('Open');
    expect(l).toContain('In use 12/40 · Queue 3');
    expect(l).toContain('Guests served: 42 (3 gave up)');
    expect(l).toContain('Revenue: $1,234');
    expect(l).toContain('Price: $6/hour');
    expect(l).toContain('Staff: 1/2 (understaffed: reduced capacity)');
  });
  it('shows the closed reason first', () => {
    expect(formatAttractionStats(info({ open: false, reason: 'Closed: no snow at 1,450 m' }))[0]).toBe('Closed: no snow at 1,450 m');
  });
  it('price labels and staff text', () => {
    expect(formatPriceLabel(40, 'perNight')).toBe('$40/night');
    expect(formatPriceLabel(3, 'perUse')).toBe('$3/use');
    expect(formatStaff(0, 0)).toBe('Staff: none needed');
    expect(formatStaff(3, 2)).toBe('Staff: 3/2 (extra: faster service)');
    expect(formatStaff(2, 2)).toBe('Staff: 2/2');
  });
});

describe('attraction activity poses (render helper, pure)', () => {
  const view = (type: string, users: number, extra: Partial<ActivityView> = {}): ActivityView => ({ id: 3, type, x: 10, y: 10, w: 5, h: 4, users, open: true, ...extra });
  const poses = (v: ActivityView, t: number): Pose[] => { const out: Pose[] = []; activityPoses(v, t, out); return out; };

  it('is deterministic and caps the figure count', () => {
    expect(poses(view('iceRink', 40), 12.5)).toEqual(poses(view('iceRink', 40), 12.5));
    expect(poses(view('iceRink', 40), 1)).toHaveLength(MAX_FIGURES_PER_ATTRACTION);
    expect(poses(view('boatRental', 40), 1).filter((p) => p.kind === 'boat')).toHaveLength(MAX_BOATS);
  });
  it('closed or empty attractions draw nothing; unknown types too', () => {
    expect(poses(view('iceRink', 0), 1)).toHaveLength(0);
    expect(poses(view('iceRink', 5, { open: false }), 1)).toHaveLength(0);
    expect(poses(view('cafe', 5), 1)).toHaveLength(0);
  });
  it('skaters stay on the rink footprint and move over time', () => {
    for (const t of [0, 7, 33.3, 101]) for (const p of poses(view('iceRink', 12), t)) { expect(p.x).toBeGreaterThanOrEqual(10); expect(p.x).toBeLessThanOrEqual(15); expect(p.y).toBeGreaterThanOrEqual(10); expect(p.y).toBeLessThanOrEqual(14); }
    expect(poses(view('iceRink', 4), 0)[0]).not.toEqual(poses(view('iceRink', 4), 20)[0]);
  });
  it('boats follow lake tiles; the beach has umbrellas; riders/kids exist', () => {
    const lake = [{ x: 20, y: 10 }, { x: 21, y: 10 }, { x: 22, y: 11 }];
    const b = poses(view('boatRental', 2, { lake }), 5);
    expect(b.every((p) => p.kind === 'boat' && p.x >= 20 && p.x <= 23)).toBe(true);
    expect(poses(view('beach', 8), 1).some((p) => p.kind === 'umbrella')).toBe(true);
    expect(poses(view('stuntPark', 5), 3)).toHaveLength(5);
    expect(poses(view('playground', 5), 3)).toHaveLength(5);
  });
  it('hidden when far: threshold constant is the guest LOD one', () => { expect(ACTIVITY_FAR_VIEW_HEIGHT).toBe(70); });
});
