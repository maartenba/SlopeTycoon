/* Dialog / UI-kit screenshot suite (docs/visual-qa.md, 'UI kit & dialogs'): npm run ui2:suite [-- filter] -> .weave/shots/<prefix>-*.png.
 * Every shot also prints font status (document.fonts.check) and the overlap report. */
import { launch, shot, startServer, type ShotOpts } from './lib/harness';

const prefix = process.env.UI2_PREFIX ?? 'ui2';
const V1280 = '1280x800', V1920 = '1920x1080', V1000 = '1000x700';
const fonts = "document.fonts.ready.then(()=>console.log('[fonts]', 'Nunito', document.fonts.check('16px Nunito'), 'Lilita', document.fonts.check('16px \"Lilita One\"')))";
const menu: ShotOpts = { bare: true, evalJs: fonts };
const game: ShotOpts = { start: 'summer', hour: 12, zoom: 2, target: 'lodge', extra: 'starter=1', overlap: true, evalJs: fonts };
export const SET: Array<ShotOpts & { out: string }> = [
  ...[V1280, V1920, V1000].flatMap((v) => [
    { ...menu, viewport: v, out: `menu-${v}` },
    { ...menu, viewport: v, steps: 'click:New game;wait:600', out: `menu-newgame-${v}` },
    { ...menu, viewport: v, steps: 'click:Settings;wait:500', out: `menu-settings-${v}` },
  ]),
  { ...menu, viewport: V1280, steps: 'click:New game;wait:500;click:Terrain preset;wait:400', out: 'newgame-terrain-dropdown' },
  { ...menu, viewport: V1280, steps: 'click:New game;wait:500;click:Difficulty;wait:400', out: 'newgame-difficulty-dropdown' },
  { ...menu, viewport: V1280, steps: 'click:Load game;wait:600', out: 'menu-load' },
  { ...menu, viewport: V1280, steps: 'click:Help & keys;wait:500', out: 'menu-help' },
  { ...menu, viewport: V1280, steps: 'click:About;wait:500', out: 'menu-about' },
  { ...game, viewport: V1280, out: 'game-topbar' },
  { ...game, viewport: V1280, steps: 'click:Graphics quality;wait:400', out: 'game-gfx-dropdown' },
  { ...game, viewport: V1280, steps: 'key:Escape;wait:500', out: 'pause' },
  { ...game, viewport: V1280, steps: 'key:Escape;wait:400;click:Settings;wait:500', out: 'pause-settings-stacked' },
  { ...game, viewport: V1280, steps: 'key:Escape;wait:400;click:Save game;wait:500', out: 'pause-save' },
  { ...game, viewport: V1280, steps: 'click:Save game (Ctrl;wait:500;type:Weekend resort;click:Save as new;wait:900;click:Load;wait:500', out: 'save-then-load-tab' },
  { ...game, viewport: V1280, steps: 'click:Save game (Ctrl;wait:500;type:Weekend resort;click:Save as new;wait:900;click:Load;wait:500;click:Delete;wait:500', out: 'confirm-delete' },
  { ...game, viewport: V1280, steps: 'click:Back to the main menu;wait:700', out: 'game-menu' },
  { ...game, viewport: V1280, steps: 'click:Back to the main menu;wait:700;click:Settings;wait:500', out: 'game-menu-settings' },
  { ...game, viewport: V1280, steps: 'click:Sound & settings;wait:500', out: 'game-settings' },
  { ...game, viewport: V1280, steps: 'click:Keyboard shortcuts;wait:500', out: 'game-help' },
  { ...game, viewport: V1280, steps: 'click:button[data-drawer=ops];wait:600', out: 'ops-selects' },
];
const only = process.argv[2];
const srv = await startServer();
const br = await launch();
let bad = 0;
try {
  for (const s of SET.filter((x) => !only || x.out.includes(only))) {
    const r = await shot(br, srv.url, { ...s, out: `${prefix}-${s.out}` });
    const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e));
    console.log(`${r.file}: ${real.length} errors ${r.logs.filter((l) => /\[(overlap|harness|fonts)\]/.test(l)).join(' ; ')}`);
    for (const e of new Set(real)) console.log('   ' + e.slice(0, 300));
    bad += real.length;
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
