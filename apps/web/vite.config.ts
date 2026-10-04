import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Kanso Vite config.
 *
 * Deliberately minimal: React 19, the `@` -> `src` alias that every agent's imports
 * rely on, and Tailwind v4 (CSS-first config — the theme lives in
 * `src/styles/tokens.css`, not in a JS config file).
 *
 * `srcDir` is derived from `import.meta.url` rather than `node:path` so the project
 * needs no `@types/node` dependency.
 */
const srcDir = decodeURIComponent(new URL('./src', import.meta.url).pathname);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    // Google OAuth is registered against http://localhost:5173 (PLAN 2.1). If that port
    // is taken, Vite falls forward rather than failing the run.
    port: 5173,
    strictPort: false,
  },
});
