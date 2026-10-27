/** `npm run site:og`: renders the 1200x630 social cards (Open Graph / Twitter) into site/assets/og/*.png (card design: ogCards.ts) with the real fonts via headless Chrome; sharp optimises the PNGs. The PNGs are committed; `npm run build:site` copies them. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/harness';
import { CARDS, OG_DIR, cardHtml } from './ogCards';

{
  const sharp = (await import('sharp')).default; mkdirSync(OG_DIR, { recursive: true });
  const br = await launch();
  try {
    for (const key of Object.keys(CARDS)) {
      const page = await br.newPage(); await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      await page.setContent(cardHtml(key), { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready);
      const png = Buffer.from(await page.screenshot({ type: 'png' }));
      const out = await sharp(png).png({ palette: true, quality: 90, effort: 10, colours: 256 }).toBuffer();
      writeFileSync(join(OG_DIR, `${key}.png`), out); console.log(`[og] ${key}.png ${(out.length / 1024).toFixed(0)} kB`); await page.close();
    }
  } finally { await br.close(); }
}
