/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate bodies poke the untyped window.__slope debug API */
/* Rig for scripts/touch-e2e.ts: real CDP touch primitives + shadow-piercing DOM helpers + result recording. */
import { mkdirSync } from 'node:fs';
import type { Page, TouchHandle } from 'puppeteer-core';

export const VIEWPORTS: Record<string, { w: number; h: number }> = { phone: { w: 390, h: 844 }, land: { w: 844, h: 390 }, tablet: { w: 1024, h: 768 } };
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Result { vp: string; group: string; name: string; pass: boolean; detail: string }
export const results: Result[] = [];
let failShots = 0;

export class Rig {
  logs: string[] = [];
  errors: string[] = [];
  group = '';
  winter = true;
  constructor(readonly page: Page, readonly vp: string, readonly base: string) {
    page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; this.logs.push(t); if (m.type() === 'error' && !/GPU stall|ReadPixels/i.test(t)) this.errors.push(t); });
    page.on('error', (e) => { this.errors.push(`[page crashed] ${String(e)}`); console.log(`  !! page crashed: ${String(e)}`); });
    page.on('pageerror', (e) => this.errors.push(`[pageerror] ${String(e)}`));
  }
  s<T>(fn: (s: any, a: any) => T, a?: any): Promise<T> { return this.page.evaluate(`(${fn.toString()})(window.__slope, ${JSON.stringify(a ?? null)})`) as Promise<T>; }
  ev<T>(code: string): Promise<T> { return this.page.evaluate(code) as Promise<T>; }
  get size(): { w: number; h: number } { return VIEWPORTS[this.vp]!; }

  async check(name: string, pass: boolean, detail = ''): Promise<boolean> {
    results.push({ vp: this.vp, group: this.group, name, pass, detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'} [${this.vp}/${this.group}] ${name}${detail ? ` -- ${detail}` : ''}`);
    if (!pass) { mkdirSync('.weave/shots', { recursive: true }); await this.page.screenshot({ path: `.weave/shots/touch2-FAIL-${this.vp}-${this.group}-${++failShots}.png` }).catch(() => undefined); }
    return pass;
  }
  async shot(name: string): Promise<void> { mkdirSync('.weave/shots', { recursive: true }); await this.page.screenshot({ path: `.weave/shots/touch2-${name}.png` }); }

  // ---- touch primitives (real CDP touch events) ----
  async tap(x: number, y: number): Promise<void> { await this.page.touchscreen.tap(x, y); await sleep(120); }
  async hold(x: number, y: number, ms: number): Promise<void> { const t = await this.page.touchscreen.touchStart(x, y); await sleep(ms); await t.end(); await sleep(120); }
  /** One finger through a polyline of points. */
  async drag(pts: Array<[number, number]>, stepMs = 16, wait = 0): Promise<void> {
    const t = await this.page.touchscreen.touchStart(pts[0]![0], pts[0]![1]);
    if (wait) await sleep(wait);
    for (let i = 1; i < pts.length; i++) { await t.move(pts[i]![0], pts[i]![1]); await sleep(stepMs); }
    await t.end(); await sleep(120);
  }
  line(x1: number, y1: number, x2: number, y2: number, n = 12): Array<[number, number]> { return Array.from({ length: n + 1 }, (_, k) => [x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n] as [number, number]); }
  async swipe(x1: number, y1: number, x2: number, y2: number, n = 10, stepMs = 16): Promise<void> { await this.drag(this.line(x1, y1, x2, y2, n), stepMs); }
  /** Two fingers: centre (cx,cy), start/end spread (px) and start/end angle (rad, 0 = horizontal), optional centre drift. */
  async two(cx: number, cy: number, d1: number, d2: number, a1 = 0, a2 = 0, drift: [number, number] = [0, 0], n = 12, stepMs = 16): Promise<void> {
    const pos = (k: number, sgn: number): [number, number] => { const f = k / n, d = d1 + (d2 - d1) * f, a = a1 + (a2 - a1) * f; return [cx + drift[0] * f + sgn * Math.cos(a) * d / 2, cy + drift[1] * f + sgn * Math.sin(a) * d / 2]; };
    const A = await this.page.touchscreen.touchStart(...pos(0, -1)), B = await this.page.touchscreen.touchStart(...pos(0, 1));
    for (let k = 1; k <= n; k++) { await A.move(...pos(k, -1)); await B.move(...pos(k, 1)); await sleep(stepMs); }
    await A.end(); await B.end(); await sleep(150);
  }
  async twoTap(cx: number, cy: number, d = 80): Promise<void> {
    const A = await this.page.touchscreen.touchStart(cx - d / 2, cy), B = await this.page.touchscreen.touchStart(cx + d / 2, cy);
    await sleep(60); await A.end(); await B.end(); await sleep(150);
  }
  async hands(): Promise<{ a: TouchHandle; b: TouchHandle }> { return { a: await this.page.touchscreen.touchStart(10, 10), b: await this.page.touchscreen.touchStart(20, 20) }; }

  // ---- DOM helpers (pierce shadow roots) ----
  /** Centre of the first visible element matching css / text (title, aria-label, text). `within` limits to a custom-element tag. */
  async rect(q: { css?: string; text?: string; tag?: string; role?: string; nth?: number; card?: boolean; scroll?: boolean }): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return this.page.evaluate((qq) => {
      const all: Element[] = [];
      const walk = (r: Document | ShadowRoot | Element): void => { for (const e of Array.from(r.querySelectorAll('*'))) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
      walk(document);
      const vis = (e: Element): DOMRect | null => {
        const el = e as HTMLElement; if (el.hidden) return null;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
        if (r.left + r.width / 2 < 0 || r.left + r.width / 2 > innerWidth || r.top + r.height / 2 < 0 || r.top + r.height / 2 > innerHeight) return null;
        for (let p: Element | null = el; p; p = p.parentElement || ((p.getRootNode() as ShadowRoot).host ?? null)) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') return null; }
        return r;
      };
      const hitAt = (x: number, y: number): Element | null => {
        let root: Document | ShadowRoot = document, el: Element | null = null;
        for (let i = 0; i < 12; i++) { const h: Element | null = root.elementFromPoint(x, y); if (!h) break; el = h; if (h.shadowRoot) { const inner = h.shadowRoot.elementFromPoint(x, y); if (inner && inner !== h) { root = h.shadowRoot; continue; } } break; }
        return el;
      };
      /** The element is the topmost thing at its centre (not under a header, drawer, toast...). */
      const exposed = (e: Element): boolean => {
        const r = e.getBoundingClientRect(); const hit = hitAt(r.left + r.width / 2, r.top + r.height / 2);
        for (let p: Node | null = hit; p; p = p.parentNode || (p as ShadowRoot).host || null) if (p === e) return true;
        return false;
      };
      const low = (qq.text ?? '').toLowerCase();
      const inTag = (e: Element): boolean => !qq.tag || ((e.getRootNode() as ShadowRoot).host?.tagName.toLowerCase() === qq.tag) || !!e.closest(qq.tag);
      const hits = all.filter((e) => {
        if (!inTag(e)) return false;
        if (qq.css) { try { if (!e.matches(qq.css)) return false; } catch { return false; } }
        if (qq.card && !e.classList.contains('card')) return false;
        if (qq.role && (e as HTMLElement).dataset.role !== qq.role) return false;
        if (qq.text) { const h = e as HTMLElement; if (!e.matches('button,[role=button],summary,a,label,.card,.tab')) return false; if (![h.innerText, e.getAttribute('title'), e.getAttribute('aria-label')].some((t) => t && t.toLowerCase().includes(low))) return false; }
        return !!vis(e) && exposed(e);
      });
      let e = hits[qq.nth ?? 0];
      if (!e && qq.scroll) { const any = all.find((x) => x instanceof HTMLElement && (qq.css ? x.matches(qq.css) : true) && inTag(x) && (!qq.card || x.classList.contains('card')) && x.matches('button,[role=button],summary,a,label,.card,.tab') && [x.innerText, x.getAttribute('title'), x.getAttribute('aria-label')].some((t) => t && t.toLowerCase().includes(low)) && x.getBoundingClientRect().width > 4); if (any) { (any as HTMLElement).scrollIntoView({ inline: 'center', block: 'nearest' }); e = any; } }
      if (!e) return null;
      const r = vis(e)!; return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }, q);
  }
  async tapEl(q: Parameters<Rig['rect']>[0]): Promise<boolean> { const r = await this.rect(q); if (!r) return false; await this.tap(r.x, r.y); return true; }

  /** Wait for n rendered frames (the camera matrices only follow state changes once a frame has run). */
  async frames(n = 2): Promise<void> { await this.page.evaluate((k) => new Promise<void>((res) => { let i = 0; const f = (): void => { if (++i >= k) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n); }
  /** Project a world point (tile units, y from terrain) to client px. */
  async project(x: number, z: number): Promise<{ x: number; y: number }> {
    await this.frames(3);
    return this.s((s, a) => { const h = s.grid.getCorner(Math.max(0, Math.min(s.grid.size, Math.round(a.x))), Math.max(0, Math.min(s.grid.size, Math.round(a.z)))) * 0.5; const v = s.renderer.camera.position.clone().set(a.x, h, a.z).project(s.renderer.camera); const r = s.renderer.webgl.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, { x, z });
  }
  async cam(): Promise<{ yaw: number; zoom: number; tx: number; tz: number }> { return this.s((s) => { const c = s.renderer.controls; return { yaw: c.yaw, zoom: c.zoom, tx: c.target.x, tz: c.target.z }; }); }
  tool(): Promise<string> { return this.s((s) => s.tools.current); }
  async setTool(id: string): Promise<void> { await this.s((s, a) => s.tools.activate(a), id); await sleep(150); }
  /** SwiftShader renders ~8 fps: CDP acks every touch event through the (busy) main thread, so a 100 ms tap arrives 300+ ms long. resetView relaxes tapMs and longPressMs; the long-press scenarios restore longPressMs. */
  async longPressMs(ms: number): Promise<void> { await this.s((s, a) => { const g = s.touch.controller.gestures; g.cfg = { ...g.cfg, longPressMs: a }; }, ms); }
  /** Every visible interactive element (any shadow root) smaller than `min` px in either direction: `tag text WxH`. */
  async smallTargets(min = 44, within?: string): Promise<string[]> {
    return this.page.evaluate((a) => {
      const all: Element[] = [];
      const walk = (r: Document | ShadowRoot | Element): void => { for (const e of Array.from(r.querySelectorAll('*'))) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
      walk(document);
      const out: string[] = [];
      for (const e of all) {
        const el = e as HTMLElement;
        if (!el.matches('button,input:not([type=hidden]),select,textarea,a[href],summary,[role=button],[role=option],[role=tab],[role=menuitem],[role=switch],[role=checkbox],st-select')) continue;
        if (el.tagName === 'A' && el.closest('p, li')) continue; // inline text links are exempt
        if (a.within && !((el.getRootNode() as ShadowRoot).host?.tagName.toLowerCase() === a.within || el.closest(a.within))) continue;
        let hidden = false;
        for (let p: Element | null = el; p; p = p.parentElement || ((p.getRootNode() as ShadowRoot).host ?? null)) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || (p as HTMLElement).hidden) { hidden = true; break; } }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        if (el.matches('input[type=checkbox]')) { const b = getComputedStyle(el, '::before'); if (parseFloat(b.width) >= a.min - 1 && parseFloat(b.height) >= a.min - 1) continue; } // touch hit area grown by ::before
        if (el.matches('input[type=checkbox],input[type=radio]')) { const lab = el.closest('label'); if (lab) { const q = lab.getBoundingClientRect(); if (q.width >= a.min - 1 && q.height >= a.min - 1) continue; } }
        if (r.width < a.min - 1 || r.height < a.min - 1) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    }, { min, within });
  }
  /** The <input> under client point (x, y), through shadow roots: value / min / max (null when there is none). */
  async inputAt(x: number, y: number): Promise<{ value: number; min: number; max: number } | null> {
    return this.page.evaluate((p) => {
      let root: Document | ShadowRoot = document, el: Element | null = null;
      for (let i = 0; i < 12; i++) { const h: Element | null = root.elementFromPoint(p.x, p.y); if (!h) break; el = h; if (h.shadowRoot) { const inner = h.shadowRoot.elementFromPoint(p.x, p.y); if (inner && inner !== h) { root = h.shadowRoot; continue; } } break; }
      const i = el as HTMLInputElement | null;
      return i && i.tagName === 'INPUT' ? { value: Number(i.value), min: Number(i.min), max: Number(i.max) } : null;
    }, { x, y });
  }
  /** Put the camera back over the lodge (keeps the active tool). */
  async recenter(zoom = 2): Promise<void> {
    await this.s((s, a) => { const c = s.renderer.controls; const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); if (b) c.target.set(b.x + b.w / 2, 0, b.y + b.h / 2); c.yaw = 0.785398; c.zoom = 1; c.zoomBy(a); }, zoom);
    await sleep(400);
  }
  /** Reset the view to a known state: select tool, no modal, camera over the lodge at a fixed yaw / zoom. */
  async resetView(zoom = 2): Promise<void> {
    await this.s((s, a) => {
      s.tools.reset(); s.touch.controller.reset(); { const g = s.touch.controller.gestures; g.cfg = { ...g.cfg, longPressMs: 4000, tapMs: 1500 }; s.touch.tips.holdMs = 6000; } s.touch.controller.setMode('pan');
      const c = s.renderer.controls; const b = s.buildings.all().find((q: any) => q.type === 'baseLodge'); if (b) c.target.set(b.x + b.w / 2, 0, b.y + b.h / 2);
      c.yaw = 0.785398; c.zoom = 1; c.zoomBy(a); c.update?.(0.016);
    }, zoom);
    await sleep(300);
  }
}

