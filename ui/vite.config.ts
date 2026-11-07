import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { darkThemePlugin } from './theme/dark.mjs';
import { localesPlugin } from './i18n-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { APP } from '../src/app-info.mjs';

// The local server serves fixed file names (registered in src/server.mjs and web/sw.mjs),
// so the build emits one script and one stylesheet without hashes.
export default defineConfig({
  plugins: [react(), darkThemePlugin(), localesPlugin(fileURLToPath(new URL('./src/i18n/locales', import.meta.url)))],
  // The product name (one place: src/app-info.mjs); shown at the foot of the help menu's "더 보기" with the app's
  // version (the top-level package.json, the one the downloads carry) and when this build was made.
  define: { __APP_NAME__: JSON.stringify(APP.name), __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version), __APP_BUILT__: JSON.stringify(new Date().toISOString()) },
  base: '/app/',
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
    license: { fileName: 'THIRD_PARTY_NOTICES.md' },
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      // Served by the local server (shared with the classic UI), loaded at runtime.
      external: ['/katex.mjs', '/katex-contrib/mhchem.mjs', '/vendor/pdf.min.mjs'],
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: 'app[extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
