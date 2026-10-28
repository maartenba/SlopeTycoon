import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { precachePlugin } from './vite-plugins/precache';
import { whatsNewPlugin } from './vite-plugins/whatsNew';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // three.js in its own chunk: app-code changes don't invalidate it for the HTTP cache; the precache lists every chunk.
  build: { rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) } } },
  // QA harness (scripts/lib/harness.ts) sets SLOPE_NO_HMR: no file watching / live reload, so edits made while a screenshot runs never reload the page
  server: process.env.SLOPE_NO_HMR ? { hmr: false, watch: null } : {},
  plugins: [whatsNewPlugin(), precachePlugin()],
});
