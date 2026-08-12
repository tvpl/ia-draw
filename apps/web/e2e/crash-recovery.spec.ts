import { expect, test } from '@playwright/test';
import {
  E2E_DIAGRAM_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  E2E_WORKSPACE_ID,
  TEST_SERVER_ORIGIN,
} from './support/fixedSeed.js';

/**
 * REC-01's literal Independent Test (spec.md): "E2E Playwright — N edições com Salvo,
 * kill do browser, abrir em outro contexto → N edições presentes."
 *
 * N = 20 (documented choice): large enough to span several debounce/flush cycles
 * (the queue's window is 500-1000ms per T24, so 20 sequential confirmed edits already
 * exercises at least 20 separate op-log commits) while keeping the whole test under
 * ~30s in this sandbox — 100 edits would be ~3x slower for the same coverage of the
 * *mechanism* being proven (every batch's ack precedes the next edit, so batch count
 * scales linearly with edit count, and 20 already saturates that signal).
 *
 * The API is a real apps/server instance (PGlite-backed, AD-007) and the frontend is
 * Vite's real dev server — both started as Playwright `webServer`s (see
 * playwright.config.ts's doc comment for exactly how and why). The user/workspace/
 * project/diagram this test uses are seeded once, deterministically, by that API
 * server's own startup script (e2e/support/runTestServer.ts) — the fixed IDs/
 * credentials are shared via fixedSeed.ts.
 *
 * "Kill do browser" is simulated by closing the first BrowserContext outright (no
 * /auth/logout, no graceful unmount) — the closest thing to a crash Playwright can
 * simulate short of terminating an OS process — then opening a brand-new
 * BrowserContext (simulating "another machine") and re-authenticating.
 */

const EDIT_COUNT = 20;
const diagramPath = `/w/${E2E_WORKSPACE_ID}/d/${E2E_DIAGRAM_ID}`;
const bootstrapUrl = `${TEST_SERVER_ORIGIN}/diagrams/${E2E_DIAGRAM_ID}/bootstrap`;

test('N confirmed edits survive a hard browser-context kill and reopening in a fresh context', async ({
  browser,
}) => {
  // ---- first "machine": authenticate, open the diagram, make N confirmed edits ----
  const context1 = await browser.newContext();
  const login1 = await context1.request.post(`${TEST_SERVER_ORIGIN}/auth/login`, {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  });
  expect(login1.ok()).toBe(true);

  const page1 = await context1.newPage();
  await page1.goto(diagramPath);

  const saveStatus1 = page1.getByTestId('save-status');
  // Bootstrap completed (empty scene, no pending mutations) — first "Salvo".
  await expect(saveStatus1).toHaveText('Salvo', { timeout: 15_000 });

  const canvasBox = await page1.locator('.excalidraw').boundingBox();
  if (!canvasBox) throw new Error('Excalidraw canvas did not render');
  // Excalidraw's keyboard shortcuts (e.g. "r" for the rectangle tool) are ignored
  // until the page has received at least one prior pointer interaction — a bare
  // page.goto() leaves keyboard.press('r') silently unrecognized (the toolbar stays on
  // the selection tool). One inert click on the canvas establishes that first.
  await page1.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page1.waitForTimeout(100);

  for (let i = 0; i < EDIT_COUNT; i++) {
    await page1.keyboard.press('r'); // rectangle tool (Excalidraw reverts to selection after each draw)
    // A brief settle after selecting the tool — without it the very first draw of the
    // run is occasionally dropped (the tool-switch hasn't taken effect on the canvas
    // yet when the drag starts).
    await page1.waitForTimeout(50);
    // Offset well clear of the left-side shape-properties panel that opens once a
    // drawing tool is active (~230px wide) — drawing under it lands on the panel's
    // own UI, not the canvas, and silently creates nothing.
    const x = canvasBox.x + 400 + (i % 5) * 70;
    const y = canvasBox.y + 80 + Math.floor(i / 5) * 70;
    await page1.mouse.move(x, y);
    await page1.mouse.down();
    await page1.mouse.move(x + 40, y + 40, { steps: 5 });
    await page1.mouse.up();

    // Past the 500-1000ms debounce window, so the next "Salvo" reading provably
    // reflects THIS edit's flush having started/completed, not a stale prior read.
    await page1.waitForTimeout(650);
    await expect(saveStatus1).toHaveText('Salvo', { timeout: 10_000 });
  }

  const afterEdits = await context1.request.get(bootstrapUrl);
  expect(afterEdits.ok()).toBe(true);
  const sceneAfterEdits = (await afterEdits.json()).scene as unknown[];
  expect(sceneAfterEdits).toHaveLength(EDIT_COUNT);

  // ---- kill the browser: no logout, no graceful cleanup ----
  await context1.close();

  // ---- "another machine": brand-new context, re-authenticate, reopen the same diagram ----
  const context2 = await browser.newContext();
  const login2 = await context2.request.post(`${TEST_SERVER_ORIGIN}/auth/login`, {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  });
  expect(login2.ok()).toBe(true);

  const page2 = await context2.newPage();
  await page2.goto(diagramPath);

  const saveStatus2 = page2.getByTestId('save-status');
  await expect(saveStatus2).toHaveText('Salvo', { timeout: 15_000 });

  // Authoritative check: the server itself (not just the reopened page) has every
  // confirmed edit — REC-01's actual guarantee.
  const afterReopen = await context2.request.get(bootstrapUrl);
  expect(afterReopen.ok()).toBe(true);
  const sceneAfterReopen = (await afterReopen.json()).scene as Array<{ id: string }>;
  expect(sceneAfterReopen).toHaveLength(EDIT_COUNT);
  expect(new Set(sceneAfterReopen.map((el) => el.id)).size).toBe(EDIT_COUNT);

  await context2.close();
});
