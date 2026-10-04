import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const srcDir = decodeURIComponent(new URL('./apps/web/src', import.meta.url).pathname);

/**
 * Two Vitest projects, deliberately separated by what they need to run:
 *
 * - `unit`      — jsdom + a mocked Supabase client. Runs the web app's suite in
 *                 `apps/web/tests/unit`. No Docker, no database. Always runnable.
 * - `functional`— node, hits the real local Supabase stack. Stays at the
 *                 repository root, next to the migrations and the Edge Function
 *                 it exercises. Needs Docker up and the connection values exported
 *                 (see `tests/functional/README.md`).
 *
 * They never share a run, so a machine without Docker still has `npm run test:unit`.
 *
 * This file stays at the repository root rather than moving into `apps/web`: it
 * is the only config that spans both trees, and `scripts/functional-env.mjs`
 * runs it with the repository root as its working directory.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { '@': srcDir } },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: false,
          include: ['apps/web/tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/tests/setup/unit.ts'],
          // These are jsdom renders of whole pages against mocked async hooks,
          // not pure functions, so the 5s Vitest default is tight. Under load it
          // produced red runs whose assertions were all still correct — three
          // concurrent suites on four cores put fifteen processes on the machine
          // and a handful of AccountPage and AuthCallbackPage cases crossed five
          // seconds. A CI runner is two cores, so this is a real exposure rather
          // than a symptom of one busy desktop. Generous, because a genuine
          // regression here fails by never rendering, not by rendering slowly.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { '@': srcDir } },
        test: {
          name: 'functional',
          environment: 'node',
          globals: false,
          include: ['tests/functional/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup/functional.ts'],
          // The local stack has to boot before a functional test is meaningful.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // Functional tests share one database. Several of them assert on global
          // state (one active cart per user, inventory counts), so the whole project
          // runs in a single fork: one file at a time, one database.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
