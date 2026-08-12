// Fixed IDs/credentials shared between the API test-server bootstrap (run via
// vite-node — see runTestServer.ts) and the Playwright test file (run in Playwright's
// own Node process). This file has zero heavy imports (no editor-adapter/excalidraw
// chain) so it's safe to import directly from the Playwright test process — unlike
// runTestServer.ts, which transitively imports @excalidraw/excalidraw (via
// diagram-sync -> diagram-domain -> editor-adapter) and can only run under vite-node's
// SSR transform (see vite-node.config.ts's doc comment for why).
export const E2E_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const E2E_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
export const E2E_PROJECT_ID = '00000000-0000-4000-8000-000000000003';
export const E2E_DIAGRAM_ID = '00000000-0000-4000-8000-000000000004';
export const E2E_USER_EMAIL = 'e2e@example.com';
export const E2E_USER_PASSWORD = 'e2e-password-123';

/** Matches apps/web/vite.config.ts's API_PROXY_TARGET and the port runTestServer.ts listens on. */
export const TEST_SERVER_PORT = 3000;
// Host is deliberately "localhost", matching the frontend's own origin
// (playwright.config.ts's baseURL) — the session cookie apps/server sets carries no
// explicit Domain attribute, so it's scoped to whichever hostname issued the request.
// Using "127.0.0.1" here while the page navigates to "localhost:5173" would set a
// cookie the browser then refuses to attach to the page's own same-host fetches,
// since cookie domain matching is a literal hostname string, not an IP resolution.
export const TEST_SERVER_ORIGIN = `http://localhost:${TEST_SERVER_PORT}`;
