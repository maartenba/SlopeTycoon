/** Family groups: parents drop kids at a kid-safe venue (ski school / kids ground / playground / childcare), ski/do their own thing,
 *  then regroup for lunch and leave together. Kids are NEVER free-roaming: they are either inside an open kid-safe venue or
 *  glued to a parent (position follows the family leader). No three/DOM imports. */
import { SkiSchool, SKI_SCHOOL, type LessonGroup, type SkiSchoolHooks } from '../attractions/SkiSchool';
import type { GameBus } from '../../core/events';
import { GState, GuestType, Leave, type GuestStore } from './Guest';
import { addLessonXp } from './Skill';
import type { WorldBuilding } from './GuestWorld';

export type KidsKind = 'skiSchool' | 'kidsGround' | 'playground' | 'childcare';
export interface KidsArea { id: number; kind: KidsKind; x: number; y: number; w: number; h: number; capacity: number; open: boolean }
export interface LunchSpot { id: number; kind: 'restaurant' | 'hut' | 'playground' | 'rink' | 'beach'; x: number; y: number; w: number; h: number }
/** Source of kid-friendly destinations (Task 23's attraction registry can replace the default Buildings adapter). */
export interface KidsAreaProvider {
  areas(): KidsArea[];
  lunchSpots(): LunchSpot[];
}

export const KIDS_NAMES: Record<KidsKind, string> = { skiSchool: 'Ski School', kidsGround: 'Kids Ground', playground: 'Playground', childcare: 'childcare' };
const FOOD_KIND: Record<string, LunchSpot['kind']> = { baseLodge: 'restaurant', lodge: 'restaurant', cafe: 'restaurant', heatedTerrace: 'restaurant', mountainHut: 'hut' };

/**
 * Default provider over the building list: Ski School HQ (needs snow), Kids Ground (snow), Playground (snow-free), Base Lodge
 * childcare (snow-free fallback). `isOpen` is the OpenStatus condition check; `snowy` decides the winter/summer variant.
 */
export function buildingKidsProvider(buildings: () => Iterable<WorldBuilding>, snowy: () => boolean, isOpen: (id: number) => boolean = () => true): KidsAreaProvider {
  return {
    areas(): KidsArea[] {
      const snow = snowy(), out: KidsArea[] = [];
      for (const b of buildings()) {
        const ok = b.active && isOpen(b.id);
        const mk = (kind: KidsKind, capacity: number, open: boolean): void => { out.push({ id: b.id, kind, x: b.x, y: b.y, w: b.w, h: b.h, capacity, open: ok && open }); };
        if (b.type === 'skiSchoolHQ') mk('skiSchool', 30, snow);
        else if (b.type === 'kidsGround') mk('kidsGround', 25, snow);
        else if (b.type === 'playground') mk('playground', 25, !snow);
        else if (b.type === 'baseLodge') mk('childcare', 6, !snow);
      }
      return out;
    },
    lunchSpots(): LunchSpot[] {
      const snow = snowy(), out: LunchSpot[] = [];
      for (const b of buildings()) {
        if (!b.active || !isOpen(b.id)) continue;
        const f = FOOD_KIND[b.type];
        const kind = f ?? (b.type === 'playground' && !snow ? 'playground' : b.type === 'iceRink' ? 'rink' : b.type === 'beach' && !snow ? 'beach' : null);
        if (kind) out.push({ id: b.id, kind, x: b.x, y: b.y, w: b.w, h: b.h });
      }
      return out;
    },
  };
}

export const FamilyPhase = { Together: 0, ToVenue: 1, AtVenue: 2, Recall: 3, ToLunch: 4, Lunch: 5, Free: 6, Leaving: 7 } as const;
export const FAMILY_PHASE_NAMES = ['together', 'to venue', 'at venue', 'recall', 'to lunch', 'lunch', 'free', 'leaving'] as const;

/** Tuning (ticks are 6 game minutes: 10 per hour). */
export const FAMILY = {
  maxKids: 3,
  reach: 1.8,
  toVenueTimeout: 60, recallTimeout: 50, toLunchTimeout: 40,
  venueMaxStay: 70, venueAfternoonStay: 30,
  lunchTicks: 6, lunchStart: 11.3, lunchEnd: 13.8, secondSessionBefore: 14.5, retryEvery: 12,
  noSchoolDrain: 0.004, waitDrain: 0.005, playGain: 0.002,
  kidUnhappy: 0.1,
} as const;

export interface Family {
  group: number;
  parents: number[]; kids: number[];
  leader: number;
  phase: number; phaseTick: number;
  venue: KidsArea | null; failed: Set<number>;
  sessions: number; lunchDone: boolean; noSchool: boolean; lessonDone: boolean;
  regroupReason: 'lunch' | 'lessonEnd' | 'timeout' | 'unhappy'; lunchSpot: LunchSpot | null; lastRetry: number;
}

/** What the family system needs from the guest sim. */
export interface FamilyHost {
  startLeaving(slot: number, reason: number): void;
  despawn(slot: number): void;
  /** Move a guest (updates spatial hash, ground height, interpolation). */
  place(slot: number, x: number, y: number): void;
  onSpend?(amount: number, what: string): void;
  /** Make a guest walk to building `buildingId` now (interrupting its current activity; no-op while riding a lift). */
  direct(slot: number, kind: FamilyOverride['kind'], buildingId: number): void;
}

export interface FamilyOverride { kind: 'lesson' | 'eat' | 'activity'; buildingId?: number }

const rectDist = (r: { x: number; y: number; w: number; h: number }, x: number, y: number): number =>
  Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));

export class Families {
  readonly groups = new Map<number, Family>();
  readonly schools = new Map<number, SkiSchool>();
  private byGuest = new Map<number, Family>();
  private ignored = new Set<number>();
  private ctrl: Uint8Array;
  private tick = 0; private hour = 12;
  private hooks: SkiSchoolHooks;
  /** Staff pool fill x instructor training (Task 19 / 20); 1 = untouched. */
  capacityFactor: () => number = () => 1;
  /** Counters for tests / diagnostics. */
  dropoffs = 0; regroups = 0;

  constructor(private store: GuestStore, private host: FamilyHost, public provider: KidsAreaProvider, private bus?: Pick<GameBus, 'emit'>, earn?: (category: string, amount: number) => void) {
    this.ctrl = new Uint8Array(store.capacity);
    this.hooks = {
      earn: (c, a) => earn?.(c, a),
      onStarted: (schoolId, kids, instructors) => this.bus?.emit('lesson:started', { schoolId, kids: kids.map((k) => k), instructors }),
      onFinished: (schoolId, g, fee) => this.lessonFinished(schoolId, g, fee),
      capacityFactor: () => this.capacityFactor(),
    };
  }

  school(id: number): SkiSchool {
    let s = this.schools.get(id);
    if (!s) { s = new SkiSchool(id, this.hooks); this.schools.set(id, s); }
    return s;
  }

  /** True when the guest slot is driven by the family system (kids; followers) and the normal guest loop must skip it. */
  controls(slot: number): boolean { return this.ctrl[slot] === 1; }

  familyOf(slot: number): Family | undefined { return this.byGuest.get(this.store.id[slot]!); }
  isKid(slot: number): boolean { const f = this.familyOf(slot); return !!f && f.kids.includes(this.store.id[slot]!); }

  /** Max piste difficulty-skill a parent may use: without a school the parents stay on easy runs (skill cap 0). */
  skillCap(slot: number): number {
    const f = this.byGuest.get(this.store.id[slot]!);
    return f && f.noSchool && f.phase === FamilyPhase.Free ? 0 : 3;
  }

  /** Goal override for the family leader (walk to the venue / lunch spot / wait). */
  override(slot: number): FamilyOverride | null {
    const id = this.store.id[slot]!, f = this.byGuest.get(id);
    if (!f || f.leader !== id) return null;
    switch (f.phase) {
      case FamilyPhase.ToVenue: case FamilyPhase.Recall: return f.venue ? { kind: 'lesson', buildingId: f.venue.id } : null;
      case FamilyPhase.ToLunch: return f.lunchSpot ? { kind: 'eat', buildingId: f.lunchSpot.id } : null;
      case FamilyPhase.Lunch: case FamilyPhase.Together: return { kind: 'activity' };
      default: return null;
    }
  }

  /** Inspector text for family members, or null for non-family guests. */
  describe(slot: number): string | null {
    const id = this.store.id[slot]!, f = this.byGuest.get(id);
    if (!f) return null;
    const kid = f.kids.includes(id), v = f.venue ? KIDS_NAMES[f.venue.kind] : '';
    const mood = f.noSchool ? ' · no school/kids area available' : '';
    let what: string;
    switch (f.phase) {
      case FamilyPhase.Together: what = 'Arriving with the family'; break;
      case FamilyPhase.ToVenue: what = kid ? `Heading to ${v} with the family` : `Dropping off kids at ${v}`; break;
      case FamilyPhase.AtVenue: {
        const sc = f.venue?.kind === 'skiSchool' ? this.schools.get(f.venue.id) : undefined;
        const l = sc?.lessonOf(f.kids[0]!);
        what = kid ? (l === 'active' ? `In a lesson at ${v}` : l === 'queued' ? `Waiting for a lesson at ${v}` : `Playing at ${v}`) : `Parents' free time (kids at ${v})`;
        break;
      }
      case FamilyPhase.Recall: what = kid ? `Waiting at ${v} for the parents` : `Going back to pick up the kids at ${v}`; break;
      case FamilyPhase.ToLunch: what = 'Heading to lunch with family'; break;
      case FamilyPhase.Lunch: what = 'Lunch with family'; break;
      case FamilyPhase.Leaving: what = 'Leaving with the family'; break;
      default: what = kid ? 'With the parents' : 'Together with the kids';
    }
    return `Family #${f.group} (${kid ? 'kid' : 'parent'}): ${what}${mood}`;
  }

  /** Mean happiness of a family's members (diagnostics / A-B tests). */
  happinessOf(group: number): number {
    const f = this.groups.get(group);
    if (!f) return 0;
    let sum = 0, n = 0;
    for (const id of [...f.parents, ...f.kids]) { const s = this.store.slotOf(id); if (s >= 0) { sum += this.store.happiness[s]!; n++; } }
    return n ? sum / n : 0;
  }

  // ------------------------------------------------------------------ save / load (Task 33)

  serialize(): unknown {
    return {
      groups: [...this.groups.values()].map((f) => ({ ...f, parents: [...f.parents], kids: [...f.kids], failed: [...f.failed], venue: f.venue ? { ...f.venue } : null, lunchSpot: f.lunchSpot ? { ...f.lunchSpot } : null })),
      schools: [...this.schools.entries()].map(([id, s]) => [id, s.serialize()]), ignored: [...this.ignored], dropoffs: this.dropoffs, regroups: this.regroups,
    };
  }
  load(data: unknown): void {
    const d = data as { groups: Array<Omit<Family, 'failed'> & { failed: number[] }>; schools: Array<[number, ReturnType<SkiSchool['serialize']>]>; ignored: number[]; dropoffs: number; regroups: number } | undefined;
    this.groups.clear(); this.byGuest.clear(); this.schools.clear(); this.ignored.clear(); this.ctrl.fill(0);
    if (!d) return;
    for (const g of d.groups) {
      const f: Family = { ...g, parents: [...g.parents], kids: [...g.kids], failed: new Set(g.failed), venue: g.venue ? { ...g.venue } : null, lunchSpot: g.lunchSpot ? { ...g.lunchSpot } : null };
      this.groups.set(f.group, f);
      for (const id of [...f.parents, ...f.kids]) this.byGuest.set(id, f);
    }
    for (const [id, s] of d.schools) this.school(id).load(s);
    for (const g of d.ignored) this.ignored.add(g);
    this.dropoffs = d.dropoffs; this.regroups = d.regroups;
  }

  // ------------------------------------------------------------------ update

  update(tick: number, hour: number, day = 0): void {
    this.tick = tick; this.hour = hour;
    this.register();
    for (const sc of this.schools.values()) { sc.newDay(day); sc.update(tick); }
    this.ctrl.fill(0);
    for (const f of this.groups.values()) this.step(f);
    for (const f of [...this.groups.values()]) if (!f.parents.length) this.dissolve(f);
  }

  /** End-of-tick pass (after the guest loop moved the leaders): followers and escorted kids snap to their leader. */
  sync(): void {
    const s = this.store;
    for (const f of [...this.groups.values()]) {
      if (!f.parents.some((id) => s.slotOf(id) >= 0)) { this.dissolve(f); continue; }
      const ls = s.slotOf(f.leader);
      if (ls < 0) continue;
      const atVenue = f.phase === FamilyPhase.AtVenue || f.phase === FamilyPhase.Recall;
      const lx = s.x[ls]!, ly = s.y[ls]!;
      if (!atVenue) this.gather(this.slots(f.kids), lx, ly);
      if (f.phase !== FamilyPhase.AtVenue) this.gather(this.slots(f.parents).filter((sl) => sl !== ls), lx, ly);
    }
  }

  private register(): void {
    const s = this.store, by = new Map<number, number[]>();
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i] || s.type[i] !== GuestType.Family) continue;
      const g = s.group[i]!;
      if (g <= 0 || this.groups.has(g) || this.ignored.has(g)) continue;
      let a = by.get(g); if (!a) by.set(g, a = []);
      a.push(s.id[i]!);
    }
    for (const [g, ids] of by) {
      if (ids.length < 2) { this.ignored.add(g); continue; }
      ids.sort((a, b) => a - b);
      const np = ids.length >= 3 ? 2 : 1;
      const parents = ids.slice(0, np), kids = ids.slice(np, np + FAMILY.maxKids);
      for (const id of ids.slice(np + FAMILY.maxKids)) parents.push(id);
      const f: Family = {
        group: g, parents, kids, leader: parents[0]!, phase: FamilyPhase.Together, phaseTick: this.tick, venue: null, failed: new Set(),
        sessions: 0, lunchDone: false, noSchool: false, lessonDone: false, regroupReason: 'lunch', lunchSpot: null, lastRetry: this.tick,
      };
      this.groups.set(g, f);
      for (const id of [...parents, ...kids]) this.byGuest.set(id, f);
      for (const k of kids) { const sl = s.slotOf(k); if (sl >= 0) { s.skill[sl] = 0; s.skillXp[sl] = 0; } }
    }
  }

  private dissolve(f: Family): void {
    for (const id of f.kids) { const sl = this.store.slotOf(id); if (sl >= 0) this.host.despawn(sl); }
    if (f.venue?.kind === 'skiSchool') this.schools.get(f.venue.id)?.withdraw(f.group);
    for (const id of [...f.parents, ...f.kids]) this.byGuest.delete(id);
    this.groups.delete(f.group);
  }

  private setPhase(f: Family, phase: number): void { f.phase = phase; f.phaseTick = this.tick; }

  private slots(ids: number[]): number[] { const o: number[] = []; for (const id of ids) { const s = this.store.slotOf(id); if (s >= 0) o.push(s); } return o; }

  /** Follow the leader: place each member on the leader's spot. */
  private gather(slots: number[], lx: number, ly: number): void {
    for (const sl of slots) { this.host.place(sl, lx + ((sl % 3) - 1) * 0.25, ly + (((sl >> 1) % 3) - 1) * 0.25); }
  }

  private pickVenue(f: Family): KidsArea | null {
    const all = this.provider.areas();
    const order: KidsKind[] = ['skiSchool', 'kidsGround', 'playground', 'childcare'];
    const used = new Map<number, number>();
    for (const o of this.groups.values()) if (o.venue && o.phase === FamilyPhase.AtVenue) used.set(o.venue.id, (used.get(o.venue.id) ?? 0) + o.kids.length);
    for (const k of order) {
      for (const a of all.filter((x) => x.kind === k && x.open && !f.failed.has(x.id)).sort((p, q) => p.id - q.id)) {
        if (k === 'skiSchool' && !this.school(a.id).isOpen()) continue;
        if ((used.get(a.id) ?? 0) + f.kids.length > a.capacity) continue;
        return a;
      }
    }
    return null;
  }

  private venueStillOpen(f: Family): boolean {
    const v = f.venue;
    if (!v) return false;
    const a = this.provider.areas().find((x) => x.id === v.id);
    if (!a || !a.open) return false;
    return v.kind !== 'skiSchool' || this.school(v.id).isOpen();
  }

  private pickLunch(f: Family, lx: number, ly: number): LunchSpot | null {
    const spots = this.provider.lunchSpots();
    const rank = (k: LunchSpot['kind']): number => (k === 'restaurant' ? 0 : k === 'hut' ? 1 : k === 'playground' ? 2 : k === 'rink' ? 2 : 3);
    spots.sort((a, b) => rank(a.kind) - rank(b.kind) || rectDist(a, lx, ly) - rectDist(b, lx, ly) || a.id - b.id);
    void f;
    return spots[0] ?? null;
  }

  private spot(a: KidsArea, kidId: number): [number, number] {
    const t = this.tick * 0.15 + kidId;
    return [a.x + 0.5 + (a.w - 1) * (0.5 + 0.45 * Math.sin(t * 1.3 + kidId)), a.y + 0.5 + (a.h - 1) * (0.5 + 0.45 * Math.cos(t + kidId * 2))];
  }

  private bump(slots: number[], d: number): void { for (const sl of slots) this.store.happiness[sl] = Math.max(0, Math.min(1, this.store.happiness[sl]! + d)); }

  /** Staff escort: kids rejoin the leader (used for regroup, venue closing, pick-up before leaving). */
  private reunite(f: Family, reason: 'lunch' | 'lessonEnd' | 'venueClosed' | 'timeout' | 'leaving' | 'unhappy', lx: number, ly: number): void {
    const v = f.venue;
    if (v?.kind === 'skiSchool') this.schools.get(v.id)?.withdraw(f.group);
    this.gather(this.slots(f.kids), lx, ly);
    this.regroups++;
    this.bus?.emit('family:regroup', { group: f.group, reason, venueId: v?.id ?? 0 });
  }

  private step(f: Family): void {
    const s = this.store;
    const pslots = this.slots(f.parents), kslots = this.slots(f.kids);
    // dead members: drop them; a family without parents dissolves
    f.parents = f.parents.filter((id) => s.slotOf(id) >= 0);
    f.kids = f.kids.filter((id) => s.slotOf(id) >= 0);
    if (!f.parents.length) { f.parents = []; return; }
    let ls = s.slotOf(f.leader);
    if (ls < 0) { f.leader = f.parents[0]!; ls = s.slotOf(f.leader); }
    // any leaving parent makes the whole family leave together
    if (f.phase !== FamilyPhase.Leaving) {
      let leaver = -1;
      for (const sl of pslots) if (s.state[sl] === GState.Leaving) { leaver = sl; break; }
      if (leaver < 0) for (const sl of kslots) if (s.happiness[sl]! < FAMILY.kidUnhappy) { leaver = -2; break; }
      if (leaver === -2 && s.state[ls] !== GState.Leaving) { if (f.phase === FamilyPhase.AtVenue) { this.reunite(f, 'unhappy', s.x[ls]!, s.y[ls]!); } this.host.startLeaving(ls, Leave.Bored); leaver = ls; }
      if (leaver >= 0) {
        f.leader = s.id[leaver]!; ls = leaver;
        if (f.phase === FamilyPhase.AtVenue) this.reunite(f, 'leaving', s.x[ls]!, s.y[ls]!);
        this.setPhase(f, FamilyPhase.Leaving);
        for (const sl of pslots) if (sl !== ls && s.state[sl] !== GState.Leaving) this.host.startLeaving(sl, s.leaveReason[ls]!);
      }
    }
    const lx = s.x[ls]!, ly = s.y[ls]!;
    const followers = pslots.filter((sl) => sl !== ls);
    const tick = this.tick, hour = this.hour, age = tick - f.phaseTick;
    if (f.phase === FamilyPhase.ToVenue || f.phase === FamilyPhase.Recall) { if (f.venue) this.host.direct(ls, 'lesson', f.venue.id); }
    else if (f.phase === FamilyPhase.ToLunch && f.lunchSpot) this.host.direct(ls, 'eat', f.lunchSpot.id);
    const allKids = (): number[] => this.slots(f.kids);
    const markKids = (): void => { for (const sl of allKids()) this.ctrl[sl] = 1; };
    const follow = (): void => { this.gather(followers, lx, ly); for (const sl of followers) this.ctrl[sl] = 1; };

    switch (f.phase) {
      case FamilyPhase.Together:
        markKids(); follow(); this.gather(allKids(), lx, ly);
        if (age >= 3) {
          if (hour >= FAMILY.secondSessionBefore) { this.setPhase(f, FamilyPhase.Free); break; }
          const v = this.pickVenue(f);
          if (v) { f.venue = v; this.setPhase(f, FamilyPhase.ToVenue); } else { f.noSchool = true; this.setPhase(f, FamilyPhase.Free); }
        }
        break;
      case FamilyPhase.ToVenue: {
        markKids(); follow(); this.gather(allKids(), lx, ly);
        const v = f.venue;
        if (!v || !this.venueStillOpen(f)) { this.failVenue(f); break; }
        if (rectDist(v, lx, ly) <= FAMILY.reach) this.dropoff(f, v);
        else if (age > FAMILY.toVenueTimeout) this.failVenue(f);
        break;
      }
      case FamilyPhase.AtVenue: {
        markKids();
        const v = f.venue!;
        if (!this.venueStillOpen(f)) { // closed under us: staff escort the kids back to their parents, family regroups
          this.reunite(f, 'venueClosed', lx, ly); this.bump([...pslots, ...kslots], -0.1);
          f.failed.add(v.id); f.venue = null; f.lessonDone = false; this.setPhase(f, FamilyPhase.Free); break;
        }
        const sc = v.kind === 'skiSchool' ? this.school(v.id) : null;
        for (const sl of kslots) {
          const id = s.id[sl]!, [x, y] = this.spot(v, id);
          this.host.place(sl, x, y);
          const lesson = sc?.lessonOf(id);
          this.bump([sl], lesson === 'queued' ? -FAMILY.waitDrain : FAMILY.playGain);
        }
        this.bump(pslots, 0.0003);
        const lunchTime = hour >= FAMILY.lunchStart && hour <= FAMILY.lunchEnd && !f.lunchDone;
        const done = !sc || f.lessonDone;
        if (f.sessions <= 1 && lunchTime && done) { f.regroupReason = 'lunch'; this.setPhase(f, FamilyPhase.Recall); }
        else if (f.sessions >= 2 && f.lessonDone) { f.regroupReason = 'lessonEnd'; this.setPhase(f, FamilyPhase.Recall); }
        else if (age > (f.sessions >= 2 ? FAMILY.venueAfternoonStay : FAMILY.venueMaxStay)) { f.regroupReason = 'timeout'; this.setPhase(f, FamilyPhase.Recall); }
        break;
      }
      case FamilyPhase.Recall: {
        markKids(); follow();
        const v = f.venue!;
        for (const sl of kslots) { const [x, y] = this.spot(v, s.id[sl]!); this.host.place(sl, x, y); }
        if (!this.venueStillOpen(f)) { this.reunite(f, 'venueClosed', lx, ly); f.failed.add(v.id); f.venue = null; this.setPhase(f, FamilyPhase.Free); break; }
        if (rectDist(v, lx, ly) <= FAMILY.reach || age > FAMILY.recallTimeout) { // arrived (or timeout: staff escort)
          this.reunite(f, age > FAMILY.recallTimeout && rectDist(v, lx, ly) > FAMILY.reach ? 'timeout' : f.regroupReason, lx, ly);
          f.venue = v; this.bump([...pslots, ...kslots], 0.04);
          const lunchOk = !f.lunchDone && hour >= 10.5 && hour <= FAMILY.lunchEnd + 0.7;
          const spot = lunchOk ? this.pickLunch(f, lx, ly) : null;
          if (spot) { f.lunchSpot = spot; this.setPhase(f, FamilyPhase.ToLunch); } else this.afterReunion(f);
        }
        break;
      }
      case FamilyPhase.ToLunch: {
        markKids(); follow(); this.gather(allKids(), lx, ly);
        if (!f.lunchSpot || rectDist(f.lunchSpot, lx, ly) <= FAMILY.reach || age > FAMILY.toLunchTimeout) this.setPhase(f, FamilyPhase.Lunch);
        break;
      }
      case FamilyPhase.Lunch: {
        markKids(); follow(); this.gather(allKids(), lx, ly);
        if (age >= FAMILY.lunchTicks) {
          f.lunchDone = true;
          for (const sl of [...pslots, ...kslots]) { s.hunger[sl] = Math.min(s.hunger[sl]!, 0.05); }
          for (const sl of pslots) { s.budget[sl] = s.budget[sl]! - 8; this.host.onSpend?.(8, 'food'); }
          this.bump([...pslots, ...kslots], 0.12);
          this.afterReunion(f);
        }
        break;
      }
      case FamilyPhase.Free: {
        markKids(); follow(); this.gather(allKids(), lx, ly);
        if (f.noSchool) this.bump([...pslots, ...kslots], -FAMILY.noSchoolDrain);
        if (tick - f.lastRetry >= FAMILY.retryEvery && hour < FAMILY.secondSessionBefore && f.sessions < 2 && (f.noSchool || f.sessions === 1 && f.lunchDone)) {
          f.lastRetry = tick;
          const v = this.pickVenue(f);
          if (v) { f.venue = v; this.setPhase(f, FamilyPhase.ToVenue); }
        }
        break;
      }
      case FamilyPhase.Leaving:
        markKids(); follow(); this.gather(allKids(), lx, ly);
        for (const sl of [...followers, ...kslots]) { s.state[sl] = GState.Leaving; }
        break;
    }
  }

  private afterReunion(f: Family): void {
    f.lessonDone = false;
    if (this.hour < FAMILY.secondSessionBefore && f.sessions < 2) {
      const v = this.pickVenue(f);
      if (v) { f.venue = v; f.regroupReason = 'lessonEnd'; this.setPhase(f, FamilyPhase.ToVenue); return; }
    }
    this.setPhase(f, FamilyPhase.Free);
  }

  private failVenue(f: Family): void {
    if (f.venue) f.failed.add(f.venue.id);
    const v = this.pickVenue(f);
    if (v) { f.venue = v; this.setPhase(f, FamilyPhase.ToVenue); return; }
    f.venue = null; f.noSchool = f.sessions === 0; this.setPhase(f, FamilyPhase.Free);
  }

  private dropoff(f: Family, v: KidsArea): void {
    f.sessions++; f.lessonDone = false;
    this.dropoffs++;
    for (const sl of this.slots(f.kids)) { const [x, y] = this.spot(v, this.store.id[sl]!); this.host.place(sl, x, y); }
    if (v.kind === 'skiSchool') this.school(v.id).enroll(f.group, [...f.kids], this.tick);
    this.setPhase(f, FamilyPhase.AtVenue);
    this.bus?.emit('family:dropoff', { group: f.group, venueId: v.id, venue: v.kind, kids: f.kids.length, parents: f.parents.length });
  }

  private lessonFinished(schoolId: number, g: LessonGroup, fee: number): void {
    const f = this.groups.get(g.group);
    const quality = this.school(schoolId).quality();
    if (f) {
      f.lessonDone = true;
      for (const id of g.kids) {
        const sl = this.store.slotOf(id);
        if (sl < 0) continue;
        addLessonXp(this.store, sl, SKI_SCHOOL.lessonXp);
        this.bump([sl], 0.1 + 0.12 * quality);
      }
      this.bump(this.slots(f.parents), 0.05 * quality);
    }
    this.bus?.emit('lesson:finished', { schoolId, kids: [...g.kids], fee });
  }

  /**
   * Safety invariant: every kid is either inside an OPEN kid-safe venue (AtVenue/Recall) or within `tol` tiles of a living parent.
   * Returns the ids of violating kids.
   */
  unaccompaniedKids(tol = 1.5): number[] {
    const s = this.store, bad: number[] = [];
    for (const f of this.groups.values()) {
      for (const id of f.kids) {
        const sl = s.slotOf(id);
        if (sl < 0) continue;
        const inVenue = (f.phase === FamilyPhase.AtVenue || f.phase === FamilyPhase.Recall) && f.venue !== null && rectDist(f.venue, s.x[sl]!, s.y[sl]!) <= 0.01 && this.venueStillOpen(f);
        if (inVenue) continue;
        let near = false;
        for (const pid of f.parents) { const ps = s.slotOf(pid); if (ps >= 0 && Math.hypot(s.x[ps]! - s.x[sl]!, s.y[ps]! - s.y[sl]!) <= tol) near = true; }
        if (!near) bad.push(id);
      }
    }
    return bad;
  }
}
