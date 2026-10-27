/* Slope Tycoon website: consent-first analytics (Google Analytics 4 via gtag.js, Consent Mode v2).
 * Nothing is loaded or sent until the visitor chooses "Allow". Shared contract with the game (/play/): localStorage 'slope.consent.analytics' = 'granted' | 'denied' | absent.
 * The pure functions below are unit-tested (tests/site/consent.test.ts); the DOM part only wires them up. Works without JS: no script, no tracking. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SlopeConsent = api; if (root.document) api.init(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  var KEY = 'slope.consent.analytics', ID = 'G-NX37ERE0S9';
  var COPY = { ask: 'Allow anonymous statistics?', body: 'Slope Tycoon would like to count visits and game usage anonymously (Google Analytics). No ads, no accounts, no personal data. Saves never leave your device.', granted: 'Anonymous statistics are on. Thank you!', denied: 'Anonymous statistics are off. Nothing is sent.' };

  function readConsent(storage) { try { var v = storage.getItem(KEY); return v === 'granted' || v === 'denied' ? v : null; } catch (e) { return null; } }
  function writeConsent(storage, value) { try { if (value === 'granted' || value === 'denied') { storage.setItem(KEY, value); return true; } } catch (e) { /* private mode */ } return false; }
  /** Analytics never runs on localhost, private/dev hosts, automation or headless browsers (so tests and agents do not pollute the data). */
  function envAllowsAnalytics(host, ua, webdriver) {
    host = String(host || '').toLowerCase();
    if (!host || host === 'localhost' || host === '[::1]' || host === '::1' || /\.local$/.test(host) || /\.localhost$/.test(host) || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (webdriver === true) return false;
    return !/HeadlessChrome|Headless|PhantomJS|Lighthouse|puppeteer|playwright/i.test(String(ua || ''));
  }
  /** What the page should do: show the bar (no stored choice, or the visitor reopened it) and/or load gtag (only when granted AND the environment allows). */
  function decide(state) {
    var stored = state.stored || null;
    return { showBar: stored === null || !!state.reopened, load: stored === 'granted' && envAllowsAnalytics(state.host, state.ua, state.webdriver) };
  }
  /** The gtag calls, in order, as plain data (Consent Mode v2: default denied, update to granted, page view only after consent, no Signals / ad personalisation). */
  function gtagPlan(id) {
    return [
      ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }],
      ['consent', 'update', { analytics_storage: 'granted' }],
      ['js', '$DATE'],
      ['config', id || ID, { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }],
    ];
  }

  function init(win) {
    var doc = win.document, loc = win.location, nav = win.navigator, store, me = doc.currentScript, rootPath = (me && me.getAttribute('data-root')) || '';
    try { store = win.localStorage; } catch (e) { store = null; }
    var mem = null, shim = { getItem: function () { return mem; }, setItem: function (k, v) { mem = v; } };
    var st = store || shim;
    var loaded = false;
    function load() {
      if (loaded) return; loaded = true;
      win.dataLayer = win.dataLayer || [];
      win.gtag = function () { win.dataLayer.push(arguments); };
      gtagPlan(ID).forEach(function (c) { var a = c.slice(); if (a[0] === 'js') a[1] = new Date(); win.gtag.apply(null, a); });
      var s = doc.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID; doc.head.appendChild(s);
    }
    function stop() {
      win['ga-disable-' + ID] = true;
      if (win.gtag && loaded) win.gtag('consent', 'update', { analytics_storage: 'denied' });
      try { doc.cookie.split(';').forEach(function (c) { var n = c.split('=')[0].trim(); if (n === '_ga' || n.indexOf('_ga_') === 0) { var h = loc.hostname.split('.'); for (var i = 0; i < h.length - 1; i++) doc.cookie = n + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + h.slice(i).join('.'); doc.cookie = n + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; } }); } catch (e) { /* ignore */ }
    }
    var bar = null;
    function close() { if (bar) { bar.remove(); bar = null; } }
    function choose(v) { writeConsent(st, v); if (v === 'granted') { win['ga-disable-' + ID] = false; if (envAllowsAnalytics(loc.hostname, nav.userAgent, nav.webdriver)) load(); } else stop(); render(true); setTimeout(close, 2600); }
    function render(done) {
      var cur = readConsent(st);
      close(); bar = doc.createElement('div'); bar.className = 'consent'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Analytics consent');
      var msg = done ? (cur === 'granted' ? COPY.granted : COPY.denied) : null;
      bar.innerHTML = '<div class="consent-in"><div class="consent-txt"><b></b><span></span> <a href="' + rootPath + 'privacy/">Privacy details</a></div><div class="consent-btns"></div></div>';
      bar.querySelector('b').textContent = done ? '' : COPY.ask; bar.querySelector('span').textContent = msg || (cur ? (cur === 'granted' ? COPY.granted : COPY.denied) + ' You can change this here.' : COPY.body);
      if (!done) {
        var btns = bar.querySelector('.consent-btns');
        [['granted', 'Allow', 'btn primary'], ['denied', 'No thanks', 'btn ghost']].forEach(function (d) { var b = doc.createElement('button'); b.type = 'button'; b.className = d[2]; b.textContent = d[1]; if (cur === d[0]) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', function () { choose(d[0]); }); btns.appendChild(b); });
      }
      doc.body.appendChild(bar);
    }
    var d = decide({ stored: readConsent(st), host: loc.hostname, ua: nav.userAgent, webdriver: nav.webdriver, reopened: false });
    if (d.load) load();
    if (d.showBar) render(false);
    doc.addEventListener('click', function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-consent-open]') : null; if (t) { e.preventDefault(); render(false); var b = bar && bar.querySelector('button'); if (b) b.focus(); } });
  }
  return { KEY: KEY, ID: ID, COPY: COPY, readConsent: readConsent, writeConsent: writeConsent, envAllowsAnalytics: envAllowsAnalytics, decide: decide, gtagPlan: gtagPlan, init: init };
});
