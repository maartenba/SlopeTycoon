import { WHATS_NEW, type WhatsNewEntry } from '../config/whatsNew';
import { siteUrl } from './siteLink';

/** Full changelog: only offered when the game is served under the website (`<site>/play/`), like the other site links. */
export const CHANGELOG_URL = 'https://github.com/maartenba/SlopeTycoon/blob/main/CHANGELOG.md';
export const changelogUrl = (loc?: { pathname: string }): string | null => (siteUrl('', loc) ? CHANGELOG_URL : null);

/** Version headings + bullet lists, plain text only (textContent). */
export function highlightsList(sections: readonly WhatsNewEntry[], withHeadings = sections.length > 1): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'wn-list';
  for (const s of sections) {
    if (withHeadings) { const h = document.createElement('div'); h.className = 'wn-ver'; h.textContent = `${s.version}${s.date ? ` \u00B7 ${s.date}` : ''}`; wrap.append(h); }
    const ul = document.createElement('ul');
    for (const t of s.highlights) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
    wrap.append(ul);
  }
  return wrap;
}

/** "What's new" block for the About dialog: a button that reveals the bundled highlights of the newest release. */
export function whatsNewSection(): HTMLElement {
  const box = document.createElement('div'); box.className = 'wn-about';
  const latest = WHATS_NEW[0];
  if (!latest) return box;
  const btn = document.createElement('button'); btn.dataset.action = 'whats-new'; btn.textContent = `What\u2019s new in ${latest.version}`; btn.setAttribute('aria-expanded', 'false');
  const body = document.createElement('div'); body.hidden = true; body.style.cssText = 'text-align:left;margin-top:8px;font-size:13px;line-height:1.45';
  body.append(highlightsList([latest]));
  const url = changelogUrl();
  if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.dataset.changelogLink = ''; a.textContent = 'Full changelog'; a.style.color = '#ffd070'; body.append(a); }
  btn.addEventListener('click', () => { body.hidden = !body.hidden; btn.setAttribute('aria-expanded', String(!body.hidden)); });
  box.append(btn, body);
  return box;
}
