import { expect, test } from '@playwright/test';
import {
  E2E_DIAGRAM_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  E2E_WORKSPACE_ID,
  TEST_SERVER_ORIGIN,
} from './support/fixedSeed.js';

/**
 * ESTB-05/12/13: the editor route must mount its canvas and emit nothing to
 * `console.error` / no uncaught page error while doing it.
 *
 * This exists because the render loop it guards against (React error #185,
 * "Maximum update depth exceeded") shipped and survived for weeks: every unit
 * test passed, because the loop only closes when the real `<Excalidraw/>` is
 * mounted and its `onChange` feeds a consumer that lifts the selection into
 * state. A console-level assertion is the cheapest check that sees it.
 *
 * The assertion is deliberately not written against the #185 message. A filter
 * for one known error would not catch the next variation of the same class of
 * defect; anything the page logs as an error is a failure here.
 */

/**
 * ESTB-13: empty on purpose, and it starts empty.
 *
 * Adding an entry silences a real signal, so an entry may only be added with a
 * written justification naming why the message is emitted by something outside
 * this application's control AND why it cannot be fixed. "It's noisy" is not a
 * justification.
 */
const TOLERATED_CONSOLE_MESSAGES: readonly RegExp[] = [];

function isTolerated(text: string): boolean {
  return TOLERATED_CONSOLE_MESSAGES.some((pattern) => pattern.test(text));
}

test('the editor route mounts its canvas without logging any error', async ({ page }) => {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!isTolerated(text)) errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => {
    if (!isTolerated(error.message)) errors.push(`pageerror: ${error.message}`);
  });

  const login = await page.request.post(`${TEST_SERVER_ORIGIN}/auth/login`, {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  await page.goto(`/w/${E2E_WORKSPACE_ID}/d/${E2E_DIAGRAM_ID}`);

  // ESTB-05: the canvas mounts at all. Before the selection-emission guard this
  // never resolved, because React aborted the route mid-render.
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 15_000 });

  // The loop was not a single throw: it re-entered until React gave up. Staying
  // on the page after it settled is what proves it is no longer looping.
  await expect(page.getByTestId('save-status')).toBeVisible();

  // ESTB-07: the recovery screen is never reached on a healthy route.
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(errors).toEqual([]);
});
