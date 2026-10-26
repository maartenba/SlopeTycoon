import { BUILDINGS } from '../config/buildings';
import { Layer } from '../world/Networks';
import { buildingTab } from '../ui/buildInfo';
import { monthIndex, seasonStartDay } from '../sim/Clock';
import type { LiftData } from '../sim/Lift';
import type { DoPlan, MapMark, ShowMeResult, Step, StepCtx } from './TutorialEngine';
import { centreOf, rectOf, type Pt, type Rect } from './queries';
import {
  anchors, buildLift, buildNetwork, findAlongPiste, findSite, networkCost, paintPiste, pisteSamples, placeSite, planLift, planPathBetween, planPathTo,
  planPiste, planRoadTo, planTrail, type ActionResult, type Site, type SiteOpts,
} from './suggest';
import { t } from './strings';

// ---------------------------------------------------------------- helpers

const markOf = (r: Rect, extra?: Rect | null, line?: Pt[] | null): MapMark => ({ x: r.x, y: r.y, w: r.w, h: r.h, ok: true, extra: extra ?? null, line: line ?? null });
const bounds = (pts: Pt[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
const sum = (a: ActionResult, b: ActionResult): ActionResult => ({ ok: a.ok && b.ok, cost: a.cost + b.cost, reason: a.reason ?? b.reason });

/** UI chain for a building item: dock button → its tab → the card. */
export const buildingChain = (type: string): string[] => {
  const def = BUILDINGS[type];
  return ['dock:buildings', ...(def ? [`drawer:tab:${buildingTab(def)}`] : []), `drawer:item:${type}`];
};
const networkChain = (item: string, drawer: 'paths' | 'pistes'): string[] => [`dock:${drawer}`, `drawer:item:${item}`];

const ok = (ui: string[], map: MapMark | null, valid = true): ShowMeResult => ({ ui, map, valid });

interface SiteStepOpts {
  id: string;
  type: string;
  anchor(ctx: StepCtx): Pt;
  site?: SiteOpts;
  /** Custom finder (e.g. along the piste). */
  find?(ctx: StepCtx): Site | null;
  /** After placing, connect the building by this kind of link. */
  link?: 'road' | 'path';
  complete(q: StepCtx['q']): boolean;
  applicable?: Step['isApplicable'];
  structural?: boolean;
}

/** Common 'place a building' lesson: finds a valid site with the real placement rules, shows it, places it (+ links it) on request. */
function siteStep(o: SiteStepOpts): Step {
  const find = (ctx: StepCtx): Site | null => (o.find ? o.find(ctx) : findSite(ctx.sim, o.type, o.anchor(ctx), o.site));
  const linkCost = (ctx: StepCtx, r: Rect): number => {
    if (o.link === 'road') { const p = planRoadTo(ctx.sim, r); return p ? networkCost(ctx.sim, 2, p) : 0; }
    if (o.link === 'path') { const p = planPathTo(ctx.sim, r); return p ? networkCost(ctx.sim, 1, p) : 0; }
    return 0;
  };
  return {
    id: o.id, ui: buildingChain(o.type), structural: o.structural ?? true,
    isApplicable: o.applicable, isComplete: o.complete,
    showMe(ctx): ShowMeResult {
      // A building of this kind already stands but is not working: point at it (and the link it needs), not at a second site.
      const lone = o.link ? ctx.q.buildings(o.type).find((b) => !b.active) : undefined;
      if (lone && o.link && !ctx.q.activeCount(o.type)) {
        const p = o.link === 'road' ? planRoadTo(ctx.sim, rectOf(lone)) : planPathTo(ctx.sim, rectOf(lone));
        return ok(buildingChain(o.type), markOf(rectOf(lone), null, p && p.length ? p : null), !!p);
      }
      const s = find(ctx);
      return ok(buildingChain(o.type), s ? markOf(s.rect) : null, !!s);
    },
    doItForMe(ctx): DoPlan | null {
      // A building of this kind already stands but is not connected: link it instead of building a second one.
      const lone = o.link ? ctx.q.buildings(o.type).find((b) => !b.active) : undefined;
      if (lone && o.link) {
        const kind = o.link === 'road' ? 2 : 1;
        const p = o.link === 'road' ? planRoadTo(ctx.sim, rectOf(lone)) : planPathTo(ctx.sim, rectOf(lone));
        if (p && p.length) return { cost: networkCost(ctx.sim, kind, p), perform: () => buildNetwork(ctx.sim, kind, p, ctx.sink) };
      }
      const s = find(ctx);
      if (!s) return null;
      return {
        cost: s.cost + linkCost(ctx, s.rect),
        perform: () => {
          const r = placeSite(ctx.sim, s, ctx.sink);
          if (!r.ok || !r.building) return r;
          const rect = rectOf(r.building);
          let link: ActionResult = { ok: true, cost: 0 };
          if (o.link === 'road') { const p = planRoadTo(ctx.sim, rect); if (p && p.length) link = buildNetwork(ctx.sim, 2, p, ctx.sink); }
          else if (o.link === 'path') { const p = planPathTo(ctx.sim, rect); if (p && p.length) link = buildNetwork(ctx.sim, 1, p, ctx.sink); }
          return sum({ ok: true, cost: r.cost }, link);
        },
      };
    },
  };
}

const lodgeAnchor = (ctx: StepCtx): Pt => anchors(ctx.sim).lodge;
const roadAnchor = (ctx: StepCtx): Pt => anchors(ctx.sim).road;

/** A lift that still needs its run: the first lift without a piste beside it. */
const liftNeedingPiste = (ctx: StepCtx): LiftData | undefined => ctx.q.lifts().find((l) => !ctx.q.pisteServesLift(l));

/** Site for the Magic Carpet: a gentle slope near the foot of the piste, else beside the ski school. */
function carpetSite(ctx: StepCtx): Site | null {
  const pts = pisteSamples(ctx.sim);
  const foot = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.85))];
  const hq = ctx.q.first('skiSchoolHQ');
  if (foot) { const s = findSite(ctx.sim, 'magicCarpet', foot, { avoidPiste: true, rmax: 12 }); if (s) return s; }
  if (hq) { const s = findSite(ctx.sim, 'magicCarpet', { x: hq.x + 2, y: hq.y + 2 }, { avoidPiste: true, rmax: 16 }); if (s) return s; }
  const l = ctx.q.lodge();
  return findSite(ctx.sim, 'magicCarpet', l ? centreOf(rectOf(l)) : anchors(ctx.sim).lodge, { avoidPiste: true, rmax: 24 });
}

// ---------------------------------------------------------------- the lessons (in order)

export const STEPS: Step[] = [
  {
    id: 'camera', ui: ['topbar:rotate'], expr: 'point',
    isComplete: (q) => q.flag('camera:rotate'),
    showMe: () => ok(['topbar:rotate'], null),
    doItForMe: (ctx) => ({ cost: 0, perform: () => { ctx.notify('camera:rotate'); return { ok: true, cost: 0 }; } }),
  },
  {
    id: 'lodge', ui: ['dock:buildings'], structural: true,
    isComplete: (q) => !!q.lodge(),
    showMe(ctx) {
      const l = ctx.q.lodge();
      if (l) return ok(['dock:buildings'], markOf(rectOf(l)));
      const s = findSite(ctx.sim, 'baseLodge', ctx.sim.terrainInfo.villageAnchor, { route: 'road', rmax: 20 });
      return ok(buildingChain('baseLodge'), s ? markOf(s.rect) : null, !!s);
    },
    doItForMe(ctx) {
      if (ctx.q.lodge()) return { cost: 0, perform: () => ({ ok: true, cost: 0 }) };
      const s = findSite(ctx.sim, 'baseLodge', ctx.sim.terrainInfo.villageAnchor, { route: 'road', rmax: 20 });
      return s ? { cost: s.cost, perform: () => placeSite(ctx.sim, s, ctx.sink) } : null;
    },
  },
  {
    id: 'select', ui: ['tool:status'],
    isComplete: (q) => q.flag('select:building'),
    showMe: (ctx) => { const l = ctx.q.lodge(); return ok(['tool:status'], l ? markOf(rectOf(l)) : null); },
    doItForMe: (ctx) => ({ cost: 0, perform: () => { ctx.notify('select:building'); return { ok: true, cost: 0 }; } }),
  },
  siteStep({ id: 'parking', type: 'parking', anchor: roadAnchor, site: { route: 'road', rmax: 16 }, complete: (q) => q.count('parking') >= 1 }),
  {
    id: 'parkingRoad', ui: networkChain('road', 'paths'), structural: true,
    isApplicable: (q) => q.has('parking'),
    isComplete: (q) => q.parkingRoadServed(),
    showMe(ctx) {
      const p = ctx.q.unservedParking();
      const route = p ? planRoadTo(ctx.sim, rectOf(p)) : null;
      return ok(networkChain('road', 'paths'), p ? markOf(rectOf(p), null, route && route.length ? route : null) : null, !!route);
    },
    doItForMe(ctx) {
      const p = ctx.q.unservedParking();
      const route = p ? planRoadTo(ctx.sim, rectOf(p)) : null;
      return route ? { cost: networkCost(ctx.sim, 2, route), perform: () => buildNetwork(ctx.sim, 2, route, ctx.sink) } : null;
    },
  },
  {
    id: 'footpath', ui: networkChain('path', 'paths'), structural: true,
    isApplicable: (q) => q.has('parking') && !!q.lodge(),
    isComplete: (q) => q.parkingLinkedToLodge(),
    showMe(ctx) {
      const p = ctx.q.first('parking'), l = ctx.q.lodge();
      const route = p && l ? planPathBetween(ctx.sim, rectOf(l), rectOf(p)) : null;
      return ok(networkChain('path', 'paths'), p && l && route ? markOf(bounds(route), null, route) : null, !!route);
    },
    doItForMe(ctx) {
      const p = ctx.q.first('parking'), l = ctx.q.lodge();
      const route = p && l ? planPathBetween(ctx.sim, rectOf(l), rectOf(p)) : null;
      return route ? { cost: networkCost(ctx.sim, 1, route), perform: () => buildNetwork(ctx.sim, 1, route, ctx.sink) } : null;
    },
  },
  siteStep({ id: 'ticket', type: 'ticketOffice', anchor: lodgeAnchor, site: { route: 'path', rmax: 12 }, link: 'path', complete: (q) => q.activeCount('ticketOffice') >= 1 }),
  {
    id: 'lift', ui: ['dock:lifts', 'drawer:item:chair4'], structural: true,
    isComplete: (q) => q.liftCount() >= 1,
    showMe(ctx) {
      const plan = planLift(ctx.sim);
      if (!plan) return { ...ok(['dock:lifts', 'drawer:item:chair4'], null, false), noteKey: 'msg.noLift' };
      return ok(['dock:lifts', `drawer:item:${plan.kind}`], markOf({ x: plan.bottom.x, y: plan.bottom.y, w: 2, h: 2 }, { x: plan.top.x, y: plan.top.y, w: 2, h: 2 }));
    },
    doItForMe(ctx) {
      const plan = planLift(ctx.sim);
      return plan ? { cost: plan.cost, perform: () => buildLift(ctx.sim, plan, ctx.sink) } : null;
    },
  },
  {
    id: 'piste', ui: networkChain('ski', 'pistes'), structural: true,
    isApplicable: (q) => q.liftCount() >= 1,
    isComplete: (q) => q.anyLiftServedByPiste(),
    showMe(ctx) {
      const l = liftNeedingPiste(ctx);
      const plan = l ? planPiste(ctx.sim, l) : null;
      return ok(networkChain('ski', 'pistes'), plan ? markOf(bounds(plan.full), null, plan.full) : null, !!plan);
    },
    doItForMe(ctx) {
      const l = liftNeedingPiste(ctx);
      const plan = l ? planPiste(ctx.sim, l) : null;
      return plan ? { cost: plan.cost, perform: () => paintPiste(ctx.sim, plan.stroke, plan.foot, Layer.Ski, ctx.sink) } : null;
    },
  },
  {
    id: 'namePiste', ui: ['tool:status'],
    isApplicable: (q) => q.connectedPistes() >= 1,
    isComplete: (q) => q.namedPiste(),
    showMe(ctx) {
      const pts = pisteSamples(ctx.sim);
      return ok(['tool:status'], pts.length ? markOf(bounds(pts), null, null) : null, pts.length > 0);
    },
    doItForMe(ctx) {
      const pts = pisteSamples(ctx.sim);
      const p = pts[Math.floor(pts.length / 2)];
      if (!p) return null;
      return { cost: 0, perform: () => ({ ok: ctx.sim.renamePisteAt(p.x, p.y, t('name.piste')), cost: 0, reason: t('reason.noPiste') }) };
    },
  },
  siteStep({ id: 'school', type: 'skiSchoolHQ', anchor: (c) => { const a = anchors(c.sim).lodge; return { x: a.x + 6, y: a.y }; }, site: { route: 'path', rmax: 14 }, link: 'path', complete: (q) => q.activeCount('skiSchoolHQ') >= 1 }),
  {
    id: 'carpet', ui: buildingChain('magicCarpet'), structural: true,
    isApplicable: (q) => q.has('skiSchoolHQ'),
    isComplete: (q) => q.activeCount('magicCarpet') >= 1,
    showMe(ctx) { const s = carpetSite(ctx); return ok(buildingChain('magicCarpet'), s ? markOf(s.rect) : null, !!s); },
    doItForMe(ctx) {
      const s = carpetSite(ctx);
      if (!s) return null;
      return {
        cost: s.cost,
        perform: () => {
          const r = placeSite(ctx.sim, s, ctx.sink);
          if (r.ok && r.building && !ctx.sim.networks.serves('path', rectOf(r.building)) && !ctx.sim.networks.serves('piste', rectOf(r.building))) {
            const p = planPathTo(ctx.sim, rectOf(r.building));
            if (p && p.length) return sum(r, buildNetwork(ctx.sim, 1, p, ctx.sink));
          }
          return r;
        },
      };
    },
  },
  siteStep({ id: 'patrol', type: 'patrolHub', anchor: roadAnchor, site: { route: 'road', rmax: 18 }, link: 'road', complete: (q) => q.activeCount('patrolHub') >= 1 }),
  siteStep({
    id: 'firstAid', type: 'firstAid', anchor: lodgeAnchor, find: (c) => findAlongPiste(c.sim, 'firstAid', 7) ?? findSite(c.sim, 'firstAid', anchors(c.sim).lodge, { rmax: 16 }),
    applicable: (q) => q.has('patrolHub'), complete: (q) => q.activeCount('firstAid') >= 1,
  }),
  {
    id: 'overlay', ui: ['dock:view'],
    isComplete: (q) => q.flag('overlay:cycled'),
    showMe: () => ok(['dock:view'], null),
    doItForMe: (ctx) => ({ cost: 0, perform: () => { ctx.host.setOverlay?.('patrol'); ctx.notify('overlay:cycled'); return { ok: true, cost: 0 }; } }),
  },
  siteStep({ id: 'restaurant', type: 'lodge', anchor: (c) => { const a = anchors(c.sim).lodge; return { x: a.x - 6, y: a.y + 6 }; }, site: { route: 'road', rmax: 16 }, link: 'road', complete: (q) => q.activeCount('lodge', 'mountainHut') >= 1 }),
  siteStep({ id: 'rental', type: 'rental', anchor: roadAnchor, site: { route: 'road', rmax: 18 }, link: 'road', complete: (q) => q.activeCount('rental') >= 1 }),
  {
    id: 'speed', ui: ['hud:speed'],
    isComplete: (q) => q.flag('speed:2') && q.flag('speed:0'),
    showMe: () => ok(['hud:speed'], null),
    doItForMe: (ctx) => ({
      cost: 0,
      perform: () => {
        const set = (s: 0 | 1 | 2 | 3): void => { if (ctx.host.setSpeed) ctx.host.setSpeed(s); else ctx.sim.loop.setSpeed(s); };
        set(2); set(0); set(1);
        return { ok: true, cost: 0 };
      },
    }),
  },
  {
    id: 'guests', ui: ['hud:guests'],
    isComplete: (q) => q.anyGuests(),
    showMe: () => ok(['hud:guests'], null),
    doItForMe: (ctx) => ({
      cost: 0,
      perform: () => {
        if (ctx.host.fastForward) {
          for (let d = 0; d < 4 && !ctx.q.anyGuests(); d++) ctx.host.fastForward(240);
          return ctx.q.anyGuests() ? { ok: true, cost: 0 } : { ok: false, cost: 0, reason: t('reason.noGuests') };
        }
        if (ctx.sim.loop.speed < 3) { if (ctx.host.setSpeed) ctx.host.setSpeed(3); else ctx.sim.loop.setSpeed(3); }
        return { ok: true, cost: 0 };
      },
    }),
  },
  { id: 'daynight', ui: ['hud:speed'], ack: true, isComplete: (q) => q.flag('ack:daynight'), showMe: () => ok(['hud:speed'], null) },
  { id: 'seasons', ui: ['hud:season'], ack: true, isComplete: (q) => q.flag('ack:seasons'), showMe: () => ok(['hud:season'], null) },
  {
    id: 'pricing', ui: ['dock:pricing', 'panel:pricing'],
    isComplete: (q) => q.dayPassChanged(),
    showMe: () => ok(['dock:pricing', 'panel:pricing'], null),
    doItForMe: (ctx) => ({
      cost: 0,
      perform: () => {
        const d = ctx.sim.pricing.defaultOf('dayPass');
        ctx.sim.priceApi.set('dayPass', Math.round(d * 1.1) === Math.round(d) ? d + 1 : Math.round(d * 1.1));
        return { ok: ctx.q.dayPassChanged(), cost: 0, reason: t('reason.priceUnchanged') };
      },
    }),
  },
  {
    id: 'loan', ui: ['dock:finance', 'panel:loans'],
    isComplete: (q) => q.flag('loan:taken') || q.activeLoans > 0,
    showMe: () => ok(['dock:finance', 'panel:loans'], null),
    doItForMe(ctx) {
      const offer = ctx.sim.loans.offers(ctx.sim.creditCtx()).find((o) => o.available);
      if (!offer) return null;
      return {
        cost: 0,
        perform: () => {
          const r = ctx.sim.loans.take(offer.id, ctx.sim.creditCtx(), { year: ctx.sim.game.date.year, month: monthIndex(ctx.sim.game.date) });
          return r.ok ? { ok: true, cost: 0 } : { ok: false, cost: 0, reason: r.reason };
        },
      };
    },
  },
  siteStep({ id: 'groomer', type: 'groomerGarage', anchor: roadAnchor, site: { route: 'road', rmax: 20 }, link: 'road', complete: (q) => q.activeCount('groomerGarage') >= 1 }),
  {
    id: 'snowmaking', ui: buildingChain('reservoir'), structural: true,
    isComplete: (q) => q.count('reservoir') >= 1 && q.activeCount('snowCannon') >= 1,
    showMe(ctx) {
      const needRes = ctx.q.count('reservoir') < 1;
      const s = needRes ? findAlongPiste(ctx.sim, 'reservoir', 18) ?? findSite(ctx.sim, 'reservoir', anchors(ctx.sim).lodge, { rmax: 20 }) : findAlongPiste(ctx.sim, 'snowCannon', 3, [0.3, 0.5, 0.7, 0.15, 0.85]);
      return ok(buildingChain(needRes ? 'reservoir' : 'snowCannon'), s ? markOf(s.rect) : null, !!s);
    },
    doItForMe(ctx) {
      const needRes = ctx.q.count('reservoir') < 1;
      const res = needRes ? findAlongPiste(ctx.sim, 'reservoir', 18) ?? findSite(ctx.sim, 'reservoir', anchors(ctx.sim).lodge, { rmax: 20 }) : null;
      if (needRes && !res) return null;
      return {
        cost: (res?.cost ?? 0) + 800 * 3 * ctx.sim.economy.constructionMultiplier(),
        perform: () => {
          let total: ActionResult = { ok: true, cost: 0 };
          if (res) total = sum(total, placeSite(ctx.sim, res, ctx.sink));
          if (!total.ok) return total;
          let made = 0;
          for (const f of [[0.3, 0.5, 0.7], [0.2, 0.4, 0.6, 0.8], [0.1, 0.9]]) {
            for (const fr of f) {
              if (made >= 3) break;
              const c = findAlongPiste(ctx.sim, 'snowCannon', 3, [fr]);
              if (!c) continue;
              const r = placeSite(ctx.sim, c, ctx.sink);
              if (r.ok) { made++; total = sum(total, r); }
            }
          }
          return made > 0 ? total : { ok: false, cost: total.cost, reason: t('reason.noCannon') };
        },
      };
    },
  },
  {
    id: 'marketing', ui: ['dock:marketing', 'panel:marketing'],
    isComplete: (q) => q.flag('marketing:started') || q.campaignsStarted() > 0,
    showMe: () => ok(['dock:marketing', 'panel:marketing'], null),
    doItForMe(ctx) {
      const id = ['families', 'brand'].find((c) => !ctx.sim.marketing.blocker(c));
      const def = id ? ctx.sim.marketing.list().find((c) => c.id === id) : undefined;
      if (!id || !def) return null;
      return { cost: def.cost, perform: () => { const err = ctx.sim.marketing.start(id); return err ? { ok: false, cost: 0, reason: err } : { ok: true, cost: def.cost }; } };
    },
  },
  {
    id: 'summer', ui: ['dock:view'], doLabel: 'jump',
    isComplete: (q) => q.flag('season:summer') || q.season === 'summer',
    showMe: () => ok(['dock:view'], null),
    doItForMe: (ctx) => ({
      cost: 0,
      perform: () => {
        const day = seasonStartDay('summer') + 10;
        if (ctx.host.jumpToDay) ctx.host.jumpToDay(day); else ctx.sim.jumpToDay(day);
        ctx.notify('season:summer');
        return { ok: true, cost: 0 };
      },
    }),
  },
  {
    id: 'trails', ui: networkChain('hike', 'pistes'),
    isApplicable: (q) => q.skiTiles() > 0,
    isComplete: (q) => q.trailTiles() >= 4,
    showMe(ctx) {
      const plan = planTrail(ctx.sim);
      return ok(networkChain('hike', 'pistes'), plan ? markOf(bounds(plan.stroke), null, null) : null, !!plan);
    },
    doItForMe(ctx) {
      const plan = planTrail(ctx.sim);
      return plan ? { cost: plan.cost, perform: () => paintPiste(ctx.sim, plan.stroke, null, Layer.Hike, ctx.sink) } : null;
    },
  },
  {
    id: 'save', ui: ['topbar:save'],
    isComplete: (q) => q.flag('game:saved'),
    showMe: () => ok(['topbar:save'], null),
    doItForMe: (ctx) => ({
      cost: 0,
      perform: () => {
        try { void ctx.host.save?.(); } catch { /* the save toast reports problems */ }
        ctx.notify('game:saved');
        return { ok: true, cost: 0 };
      },
    }),
  },
  { id: 'goals', ui: ['hud:rating'], ack: true, isComplete: (q) => q.flag('ack:goals'), showMe: () => ok(['hud:rating'], null) },
  { id: 'finish', ui: ['hud:rating'], ack: true, expr: 'cheer', isComplete: (q) => q.flag('ack:finish'), showMe: () => ok(['hud:rating'], null) },
];

export const STEP_IDS = STEPS.map((s) => s.id);
