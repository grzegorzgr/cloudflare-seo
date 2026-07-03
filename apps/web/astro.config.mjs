// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { seoConfig } from '../../config/seo.config.ts';

// Deterministyczny, w pe\u0142ni statyczny build (SSG).
// Brak adaptera SSR = wszystkie strony generowane na etapie build.
export default defineConfig({
  output: 'static',
  site: seoConfig.siteUrl,
  vite: {
    resolve: {
      alias: {
        // Alias do warstwy danych: packages/data
        '@data': fileURLToPath(new URL('../../packages/data', import.meta.url)),
        // Alias do logiki generatora: packages/generator
        '@generator': fileURLToPath(
          new URL('../../packages/generator/src/index.ts', import.meta.url),
        ),
        // Alias do warstwy konfiguracji: config
        '@config': fileURLToPath(new URL('../../config', import.meta.url)),
      },
    },
    server: {
      fs: {
        // Pozw\u00f3l Vite czyta\u0107 pliki spoza apps/web (monorepo root),
        // aby import danych z packages/data dzia\u0142a\u0142 w dev i build.
        allow: [fileURLToPath(new URL('../../', import.meta.url))],
      },
    },
  },
});
