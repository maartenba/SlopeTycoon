/* Slope Tycoon /support/: click-to-load Ko-fi widget. Nothing is requested from ko-fi.com until the visitor clicks the button. */
(function () {
  var box = document.getElementById('kofi-widget'), btn = document.getElementById('kofi-load');
  if (!box || !btn) return;
  btn.addEventListener('click', function () {
    if (box.querySelector('iframe')) return;
    var f = document.createElement('iframe');
    f.id = 'kofiframe'; f.src = box.getAttribute('data-kofi-src') || '';
    f.title = 'Support slopetycoon on Ko-fi'; f.setAttribute('height', '712'); f.setAttribute('loading', 'lazy'); f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('style', 'border:none;width:100%;padding:4px;background:#f9f9f9;');
    box.replaceChildren(f);
  });
})();
