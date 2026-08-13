import { defineConfig } from '@playwright/test';
import { TEST_SERVER_PORT } from './e2e/support/fixedSeed.js';

/**
 * T26: both the API and the frontend are started as Playwright `webServer`s
 * ("via um webServer do Playwright config", one of the two options the task text
 * sanctions). The API is a real apps/server instance (PGlite-backed, AD-007) — the
 * same buildServer + register*Module pattern every apps/server integration test
 * already uses — run via `vite-node` (see e2e/support/vite-node.config.ts's doc
 * comment for why: apps/server's diagram-sync transitively imports
 * @excalidraw/excalidraw, whose compiled bundle only resolves through a bundler-style
 * resolver, not Node's own). The frontend is Vite's real dev server, proxying API
 * calls to the port below (apps/web/vite.config.ts).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm exec vite-node --config e2e/support/vite-node.config.ts e2e/support/runTestServer.ts',
      url: `http://127.0.0.1:${TEST_SERVER_PORT}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
