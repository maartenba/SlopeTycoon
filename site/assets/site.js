/* Slope Tycoon website: lightbox (keyboard accessible) + guide search. Everything also works without JS (images link to the full size). */
(function () {
  var links = [].slice.call(document.querySelectorAll('a[data-lightbox]'));
  if (links.length && typeof HTMLDialogElement === 'function') {
    var dlg = document.createElement('dialog'); dlg.className = 'lb'; dlg.setAttribute('aria-label', 'Screenshot viewer');
    dlg.innerHTML = '<div class="lb-in"><img alt=""><div class="lb-cap" aria-live="polite"></div></div><button class="x" aria-label="Close">×</button><button class="p" aria-label="Previous screenshot">‹</button><button class="n" aria-label="Next screenshot">›</button>';
    document.body.appendChild(dlg);
    var img = dlg.querySelector('img'), cap = dlg.querySelector('.lb-cap'), cur = 0;
    var show = function (i) { cur = (i + links.length) % links.length; var a = links[cur], t = a.querySelector('img'); img.src = a.getAttribute('href'); img.alt = t ? t.alt : ''; var f = a.parentElement && a.parentElement.querySelector('figcaption'); cap.textContent = (f && f.textContent) || (t && t.alt) || ''; };
    links.forEach(function (a, i) { a.addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); show(i); dlg.showModal(); }); });
    dlg.querySelector('.x').onclick = function () { dlg.close(); };
    dlg.querySelector('.p').onclick = function () { show(cur - 1); };
    dlg.querySelector('.n').onclick = function () { show(cur + 1); };
    dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.className === 'lb-in') dlg.close(); });
    dlg.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1); });
  }
  var box = document.querySelector('[data-search]');
  if (box) {
    var input = box.querySelector('input'), out = box.querySelector('.results'), data = null, root = box.getAttribute('data-root') || '';
    var load = function () { if (data) return Promise.resolve(data); return fetch(root + 'assets/search-index.json').then(function (r) { return r.json(); }).then(function (d) { data = d; return d; }); };
    var run = function () {
      var q = input.value.trim().toLowerCase(); if (q.length < 2) { out.hidden = true; return; }
      load().then(function (d) {
        var words = q.split(/\s+/), hits = [];
        d.forEach(function (e) { var hay = (e.t + ' ' + e.h + ' ' + e.x).toLowerCase(), s = 0; for (var i = 0; i < words.length; i++) { if (hay.indexOf(words[i]) < 0) { s = -1; break; } s += (e.h.toLowerCase().indexOf(words[i]) >= 0 ? 5 : 0) + (e.t.toLowerCase().indexOf(words[i]) >= 0 ? 2 : 1); } if (s > 0) hits.push([s, e]); });
        hits.sort(function (a, b) { return b[0] - a[0]; });
        out.innerHTML = ''; hits.slice(0, 8).forEach(function (h) { var e = h[1], a = document.createElement('a'); a.href = root + e.u; var at = e.x.toLowerCase().indexOf(words[0]); a.innerHTML = '<b></b><small></small>'; a.firstChild.textContent = e.t + (e.h ? ' › ' + e.h : ''); a.lastChild.textContent = e.x.slice(Math.max(0, at - 30), Math.max(0, at - 30) + 110) + '…'; out.appendChild(a); });
        if (!hits.length) out.textContent = 'Nothing found. Try another word.';
        out.hidden = false;
      });
    };
    input.addEventListener('input', run); input.addEventListener('focus', function () { load(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { out.hidden = true; } else if (e.key === 'ArrowDown') { var a = out.querySelector('a'); if (a) { e.preventDefault(); a.focus(); } } });
    out.addEventListener('keydown', function (e) { var t = e.target; if (e.key === 'ArrowDown' && t.nextElementSibling) { e.preventDefault(); t.nextElementSibling.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); (t.previousElementSibling || input).focus(); } else if (e.key === 'Escape') { out.hidden = true; input.focus(); } });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) out.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); input.focus(); } });
  }
})();
