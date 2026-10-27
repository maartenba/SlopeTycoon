# Deploying to GitHub Pages

The deployment is ONE static site, `dist-site/`, built by `npm run build:site`:

| URL | What |
|---|---|
| `https://maartenba.github.io/SlopeTycoon/` | the website (landing page, `site/`) |
| `https://maartenba.github.io/SlopeTycoon/guide/` | the player guide |
| `https://maartenba.github.io/SlopeTycoon/play/` | the game (PWA: `sw.js` scope and manifest `start_url` are `/SlopeTycoon/play/`) |

`npm run build` still produces the standalone game in `dist/` (relative base `./`), and `vite dev` serves the game at `/`. Everything is relative, so the layout works at `/`, `/SlopeTycoon/` or any subfolder. Website sources, the screenshot pipeline and how to edit the guide: [`site/README.md`](../site/README.md). Nothing is built on GitHub except by the workflows below.

## One-time setup
1. Create an empty GitHub repository (no README/licence).
2. `git remote add origin git@github.com:maartenba/SlopeTycoon.git`
3. Commit your work, then `git push -u origin main`.
4. Repo → Settings → Pages → **Build and deployment → Source: GitHub Actions**.
5. The `Deploy to GitHub Pages` workflow runs on every push to `main` (or manually: Actions → Run workflow). The URL appears in the `deploy` job and under Settings → Pages:
   - project site: `https://maartenba.github.io/SlopeTycoon/`
   - (a repo named `<owner>.github.io` would instead serve at the root; not used here)
6. The README badge already points at `maartenba/SlopeTycoon`.

## Workflows (`.github/workflows`)
| file | trigger | does |
|---|---|---|
| `pages.yml` | push to `main`, manual | `npm ci`, typecheck, lint, test, build, verify:pwa, `build:site` (env `SITE_REPO`, `SITE_URL` from the repo), `site:check`, `verify:site`, upload `dist-site`, then `deploy` job (`pages: write`, `id-token: write`, environment `github-pages`) |
| `ci.yml` | pull requests | same checks, no deploy; cancels superseded runs |
| `site-shots.yml` | manual (optional `only` ids) | re-shoots `site/shots.json` with the preinstalled Chrome and uploads `site/assets/shots/` as an artifact (never part of the deploy; commit the files you like) |
| `extra-tests.yml` | manual (`suite`: both/perf/balance) | `npm run test:perf` / `test:balance` (slow, not in CI by default) |

Node version comes from `.nvmrc` (22); npm cache is keyed by `package-lock.json` through `setup-node`.

## Local commands
- `npm run build:site && npm run site:check && npm run verify:site`: the deployed layout + link/image/budget checks + an HTTP crawl under `/` and `/slopetycoon/`. `SITE_REPO=maartenba/SlopeTycoon` sets the footer links, `SITE_URL=https://owner.github.io/repo/` the canonical / og:image / sitemap URLs (the workflow sets both; `SITE_CNAME` writes a CNAME).
- `npm run site:dev`: serves `dist-site/` at `http://localhost:4190/` (`SITE_BASE=/repo/`, `PORT=`); the game is at `/play/`.
- `npm run build:pages`: typecheck + lint + test + build + 404/.nojekyll + verify:pwa (root and `/slopetycoon/`) + size report.
- `npm run build && npm run postbuild:pages && npm run deploy:check`: file list, sizes, SW cache version.
- `npm run preview:pages`: serves `dist/` at `http://localhost:4180/slopetycoon/` (`PAGES_BASE=/name/`, `PORT=...`); unknown paths return `404.html`.
- `npm run verify:pwa -- --base /SlopeTycoon/`: checks every precache entry under a subpath.
- `npm run deploy:gh-pages [-- --dry-run] [-- --force]`: manual deploy of `dist-site/` (website + game) to a `gh-pages` branch (temporary worktree; refuses a dirty tree without `--force`). Then set Pages source to "Deploy from a branch: gh-pages / root". Don't mix with the Actions source.
- `npm run release -- patch|minor|major [--dry-run]`: bumps `package.json`, adds `## [x.y.z] - date` under Unreleased, runs `build:pages`, commits `Release vX.Y.Z` and tags `vX.Y.Z`. Push with `git push origin main vX.Y.Z`. (`package-lock.json`'s own version field is not touched.)

## Manual GitHub steps
1. Settings → Pages → Source: **GitHub Actions**.
2. Push to `main` (the repo name is picked up from `github.repository`; locally use `SITE_REPO=maartenba/SlopeTycoon`).
3. The site is at `https://maartenba.github.io/SlopeTycoon/`; replace `maartenba/SlopeTycoon` in the README badge.

## Base path
All URLs are relative (`base: './'`, manifest `./`, SW registered as `./sw.js`), so the same build works at `/`, `/SlopeTycoon/` or any subfolder. No configuration needed.

## Custom domain
Set `SITE_CNAME=example.com` for `npm run build:site` (writes `dist-site/CNAME`), or for the standalone game add `public/CNAME`. Configure DNS (CNAME to `maartenba.github.io`, or A records), then Settings → Pages → Custom domain and enable **Enforce HTTPS**. Not created by default.

## Updates and cache busting
The SW cache name is `slope-tycoon-<package version>-<hash of all files>`: any changed file gives a new cache automatically; bump the version (`npm run release`) only to make it human-visible. Returning players get the "Update available" toast after the new SW installs; the old cache is deleted on activation. GitHub Pages serves `sw.js`/`index.html` with `max-age=600`, so a new deploy can take ~10 minutes to be noticed.

## Troubleshooting
- **Blank page / 404 for assets**: the build was made with an absolute base. Keep `base: './'`; run `npm run verify:pwa -- --base /SlopeTycoon/`.
- **Old version keeps showing**: wait for the 10 min cache, reload twice, or DevTools → Application → Service Workers → Unregister + Clear storage.
- **404 on deep links**: Pages is static; `dist/404.html` redirects unknown paths to the app root. Game state uses query strings (`?load=`), which work on `/`.
- **No install prompt / offline**: service workers need HTTPS (Pages provides it) or localhost; `file://` never works.
- **Workflow fails at deploy**: Pages source must be "GitHub Actions"; the environment `github-pages` must allow branch `main`.
- **Large `.weave/shots`** are git-ignored; plans and learnings in `.weave/` are tracked.

## Publishing checklist (maartenba/SlopeTycoon)

Nothing has been pushed or created on GitHub yet. The local clone already has `origin = git@github.com:maartenba/SlopeTycoon.git` and branch `main`.

1. On GitHub create the **empty** repository `maartenba/SlopeTycoon` (no README, no licence, no .gitignore).
2. `git push -u origin main`
3. Settings → Pages → **Build and deployment → Source: GitHub Actions**. Settings → Environments: the `github-pages` environment is created by the first deploy; leave its default branch rule (`main`).
4. Actions → wait for **Deploy to GitHub Pages** (build, then deploy). URLs: site <https://maartenba.github.io/SlopeTycoon/>, guide `.../guide/`, game `.../play/`.
5. Repo "About": description (e.g. "Cosy ski-resort tycoon in the browser: three.js, procedural, installable PWA"), website = the Pages URL, topics such as `three-js`, `typescript`, `game`, `tycoon`, `pwa`, `ski`.
6. Optional custom domain: set `SITE_CNAME` as a repository variable/env for the build step, DNS CNAME to `maartenba.github.io`, enable Enforce HTTPS (see above).
7. First release (when you want it): `npm run release -- ...` (see `scripts/release.ts`) then `git push origin main v0.2.0`. After the tag exists add compare links to `CHANGELOG.md` (`[Unreleased]: https://github.com/maartenba/SlopeTycoon/compare/v0.1.0...HEAD`); none exist yet because there are no tags.

### Double-check before going public
* **No secrets**: `.env*` is git-ignored; run `git log -p | grep -iE "api[_-]?key|secret|token|password"` and scan the output; nothing in `src/` or `public/` should contain credentials.
* **Licence (owner decision, no LICENSE file is added)**: the README says "not decided yet". Common choices, neutrally: *MIT* (very permissive, short), *Apache-2.0* (permissive plus an explicit patent grant), *GPL-3.0 / AGPL-3.0* (copyleft: derivatives must stay open), *CC BY 4.0 / CC BY-NC 4.0 / CC BY-SA 4.0* (Creative Commons suits art/content rather than code; the NC variants are not open-source), or *all rights reserved* (no file; others may not reuse it). Pick one, add `LICENSE`, and update README and `THIRD_PARTY_NOTICES.md` intro.
* **Fonts**: Nunito and Lilita One are OFL 1.1; the licence text is in `public/fonts/OFL.txt` and linked from the README and the site.
* **Asset provenance**: every image, sound and model in the game is generated procedurally in code; no third-party assets are bundled. `docs/img/` and `site/assets/shots/` contain only screenshots of this game.
* **Third-party**: three.js (MIT) is the only runtime dependency. `THIRD_PARTY_NOTICES.md` is generated by `npm run licenses` (re-run after dependency changes); the site footer links to it.

### Optional: shrink history before the first push
`.git` holds the earlier large PNGs in older commits (about 146 MB; docs/img is now about 12 MB of WebP). Nothing is pushed yet, so you may start the public history clean. These commands rewrite history: back up first (`cp -R . ../SlopeTycoon-backup`) and run them yourself, only when the working tree is committed.

```bash
# Option A: one fresh root commit (drops all old history)
git checkout --orphan clean-main
git add -A && git commit -m "Slope Tycoon 0.2.0"
git branch -M clean-main main          # replaces old main (backup first!)
git reflog expire --expire=now --all && git gc --prune=now --aggressive
du -sh .git

# Option B: keep history, squash into the first commit's tree state
#   git reset --soft $(git rev-list --max-parents=0 HEAD) && git commit --amend -m "Slope Tycoon 0.2.0"
#   (this also collapses everything into a single commit; the old blobs go away after the gc above)
```
