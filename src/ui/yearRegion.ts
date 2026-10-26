import type { YearReport } from '../sim/meta/YearReport';

/** "The region" row of the year report (Task 23): your market position among the neighbours, one bar per resort. Null for reports without rivals. */
export function buildRegion(r: YearReport): HTMLElement | null {
  if (!r.rivals) return null;
  const box = document.createElement('div'); box.className = 'region';
  const top = Math.max(0.01, ...r.rivals.entries.map((e) => e.share));
  for (const e of r.rivals.entries) {
    const d = document.createElement('div'); d.className = `rg${e.you ? ' you' : ''}`; d.dataset.rival = e.you ? 'you' : e.name;
    d.title = e.you ? `Your market position over the year (a fair slice is ${Math.round(r.rivals.fair * 100)}%)` : `${e.name}: average rating ${e.stars.toFixed(1)} stars`;
    const b = document.createElement('b'); b.textContent = e.name;
    const t = document.createElement('span'); t.textContent = `${Math.round(e.share * 100)}% of guests \u00b7 ${e.stars.toFixed(1)}\u2605`;
    const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('i'); fill.style.width = `${Math.round((e.share / top) * 100)}%`; bar.append(fill);
    d.append(b, t, bar); box.append(d);
  }
  return box;
}
