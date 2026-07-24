import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Anchor to this directory so the run works from the repo root too
  // (`npm test` invokes vitest with --config from the top level).
  // URL form, not import.meta.dirname: the client tsconfig has no node types,
  // so `dirname` would fail `tsc -p tsconfig.client.json`.
  root: new URL('.', import.meta.url).pathname,
  plugins: [svelte()],
  // Without the browser condition Vite resolves svelte's SERVER entry under
  // vitest and mount() throws lifecycle_function_unavailable.
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
