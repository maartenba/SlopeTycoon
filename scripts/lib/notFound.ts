/** Content of dist/404.html (GitHub Pages serves it for unknown paths). */
export const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Slope Tycoon: page not found</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>
// GitHub Pages serves this for unknown paths. Send visitors to the app root of this site (first path segment = repo name on project sites).
(function () {
  var seg = location.pathname.split('/')[1];
  var host = location.hostname;
  var project = /\\.github\\.io$/.test(host) && seg && seg.indexOf('.') < 0;
  location.replace(project ? '/' + seg + '/' : '/');
})();
</script></head>
<body style="font-family:sans-serif"><p>Page not found. <a href="./">Back to Slope Tycoon</a></p></body></html>
`;
