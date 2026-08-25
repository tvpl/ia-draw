import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  E2E_PROJECT_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  TEST_SERVER_ORIGIN,
} from './support/fixedSeed.js';

/**
 * SRF-04 (spec.md): the ONE proof no unit test can give, because every unit test of
 * this component mocks `<Excalidraw/>` (a plain function that re-reads props on every
 * render — exactly what hid the original bug, see `EditorSurface.spec.tsx`'s comment
 * on the ESTB-04 test). This test runs the REAL `<Excalidraw/>` in a real browser
 * against a published, multi-frame presentation, and asserts the CANVAS PIXELS it
 * paints change with the frame — not a prop, not a mock capture, the actual rendered
 * bitmap.
 *
 * Two frames, each with one big solid-fill rectangle in a distinct color at the exact
 * same scene coordinates (so scroll/zoom differences between mounts can't explain the
 * result away): frame 1 is red, frame 2 is blue. `cropSceneForFrame` (unchanged by
 * this feature) means the published scene handed to `EditorSurface` for a given frame
 * contains ONLY that frame's own elements — so if `key={frame.id}` (T1) is ever
 * reverted, the canvas would stay pinned to frame 1's red rectangle forever, and this
 * test would catch it: navigating would never make blue appear, and red would never
 * disappear.
 */

const RED = { r: 224, g: 49, b: 49 }; // #e03131
const BLUE = { r: 25, g: 113, b: 194 }; // #1971c2
const COLOR_TOLERANCE = 6;

function rectElement(id: string, frameId: string, hex: string) {
  return {
    id,
    type: 'rectangle',
    x: 50,
    y: 50,
    width: 200,
    height: 150,
    angle: 0,
    strokeColor: hex,
    backgroundColor: hex,
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function frameElement(id: string, name: string) {
  return {
    id,
    type: 'frame',
    name,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    angle: 0,
    strokeColor: '#868e96',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

/** SRF-04: scans every `<canvas>` under `.excalidraw` for a pixel matching `target`
 * within `COLOR_TOLERANCE` per channel — a direct "is this color actually painted
 * anywhere on screen" check, not an inference from props or React state. */
async function canvasHasColor(
  page: Page,
  target: { r: number; g: number; b: number },
): Promise<boolean> {
  return page.evaluate(
    ({ r, g, b, tol }) => {
      const canvases = Array.from(document.querySelectorAll('.excalidraw canvas'));
      for (const canvas of canvases) {
        const ctx = (canvas as HTMLCanvasElement).getContext('2d');
        if (!ctx) continue;
        const { width, height } = canvas as HTMLCanvasElement;
        if (width === 0 || height === 0) continue;
        const { data } = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha === 0) continue;
          const dr = data[i] as number;
          const dg = data[i + 1] as number;
          const db = data[i + 2] as number;
          if (Math.abs(dr - r) <= tol && Math.abs(dg - g) <= tol && Math.abs(db - b) <= tol) {
            return true;
          }
        }
      }
      return false;
    },
    { r: target.r, g: target.g, b: target.b, tol: COLOR_TOLERANCE },
  );
}

test('navigating a published presentation changes the real canvas pixels — not just a prop (SRF-01, SRF-04)', async ({
  browser,
}) => {
  // ---- setup: an authenticated context that seeds the scene and publishes it ----
  const setupContext = await browser.newContext();
  const login = await setupContext.request.post(`${TEST_SERVER_ORIGIN}/auth/login`, {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  // A diagram of this test's own, never the shared `E2E_DIAGRAM_ID` fixture other e2e
  // specs (crash-recovery.spec.ts, editor-console.spec.ts) mutate against the SAME
  // long-lived server process — writing this test's elements into that shared diagram
  // would pollute their element counts across a parallel Playwright run.
  const createDiagram = await setupContext.request.post(`${TEST_SERVER_ORIGIN}/diagrams`, {
    data: { projectId: E2E_PROJECT_ID, title: 'SRF E2E Presentation Diagram' },
  });
  expect(createDiagram.ok()).toBe(true);
  const diagramId = (await createDiagram.json()).diagram.id as string;

  // ---- seed a scene with two frames, each carrying one distinctly colored rectangle ----
  const batch = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/diagrams/${diagramId}/operations:batch`,
    {
      data: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: randomUUID(),
        deltas: [
          frameElement('frame-red', 'Frame Red'),
          rectElement('rect-red', 'frame-red', '#e03131'),
          frameElement('frame-blue', 'Frame Blue'),
          rectElement('rect-blue', 'frame-blue', '#1971c2'),
        ].map((element) => ({
          elementId: element.id,
          kind: 'upsert' as const,
          element,
          version: element.version,
          versionNonce: element.versionNonce,
        })),
      },
    },
  );
  expect(batch.ok()).toBe(true);

  // ---- publish a presentation with those two frames, in order ----
  const createPresentation = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/presentations`,
    { data: { diagramId, name: 'E2E Presentation' } },
  );
  expect(createPresentation.ok()).toBe(true);
  const presentationId = (await createPresentation.json()).presentation.id as string;

  const frame1 = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/presentations/${presentationId}/frames`,
    { data: { elementId: 'frame-red', position: 0, navLinksJson: [] } },
  );
  expect(frame1.ok()).toBe(true);
  const frame2 = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/presentations/${presentationId}/frames`,
    { data: { elementId: 'frame-blue', position: 1, navLinksJson: [] } },
  );
  expect(frame2.ok()).toBe(true);

  const publish = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/presentations/${presentationId}:publish`,
  );
  expect(publish.ok()).toBe(true);

  const shareLink = await setupContext.request.post(
    `${TEST_SERVER_ORIGIN}/presentations/${presentationId}/share-links`,
    { data: { role: 'viewer', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } },
  );
  expect(shareLink.ok()).toBe(true);
  const token = (await shareLink.json()).token as string;
  await setupContext.close();

  // ---- open the public link with NO session — a fresh, unauthenticated context ----
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();

  // NOT `publicPage.goto('/share/' + token)`: `/share` is a registered SERVER route
  // prefix (`packages/shared-contracts/src/routePrefixes.ts`, AD-013) — both the Vite
  // dev proxy AND the Caddy edge unconditionally forward EVERY request under `/share*`
  // to `apps/server`, with no distinction for a browser navigation vs. an XHR. A full
  // `goto` to this path never reaches the SPA at all; it returns the raw JSON the
  // backend's own `GET /share/:token` (share/routes.ts) sends, confirmed empirically
  // while writing this test (the page literally rendered the JSON body verbatim, no
  // `.excalidraw` in sight). That is a genuine, separate, pre-existing defect —
  // `SharedResourcePage` is unreachable via a real, cold, no-session visit to the exact
  // URL `ShareLinkPanel.tsx` hands out — but fixing it means touching `vite.config.ts`/
  // `Caddyfile`/`routePrefixes.ts`, all outside shared-resource-frame-fix's scope
  // (SRF's bug is the frame remount, not the edge route table). Reported separately.
  //
  // So this test loads the SPA shell from a path the edge does NOT own (`/login`),
  // then drives client-side routing directly — same React tree, same real
  // `<EditorSurface>`/`<Excalidraw/>`, same real `fetch('/share/:token')` XHR (which
  // SHOULD and does hit the backend — that one is correct, intentional behavior), just
  // without the separately-broken full-page load.
  await publicPage.goto('/login');
  await publicPage.waitForSelector('#root');
  await publicPage.evaluate((shareToken) => {
    window.history.pushState({}, '', `/share/${shareToken}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, token);

  await expect(publicPage.getByText('Frame 1 de 2')).toBeVisible();
  await expect(publicPage.locator('.excalidraw canvas').first()).toBeVisible();

  // Frame 1 (red) is on screen; frame 2's color has never been painted.
  await expect.poll(() => canvasHasColor(publicPage, RED), { timeout: 10_000 }).toBe(true);
  expect(await canvasHasColor(publicPage, BLUE)).toBe(false);

  await publicPage.getByRole('button', { name: 'Próximo' }).click();
  await expect(publicPage.getByText('Frame 2 de 2')).toBeVisible();

  // Frame 2 (blue) replaces frame 1 (red) — proves the canvas actually re-rendered
  // the new frame's content, not just that a position label changed.
  await expect.poll(() => canvasHasColor(publicPage, BLUE), { timeout: 10_000 }).toBe(true);
  expect(await canvasHasColor(publicPage, RED)).toBe(false);

  // Back to frame 1 — the exact same content reappears, proving this is a
  // deterministic remount per frame, not a one-way accident.
  await publicPage.getByRole('button', { name: 'Anterior' }).click();
  await expect(publicPage.getByText('Frame 1 de 2')).toBeVisible();
  await expect.poll(() => canvasHasColor(publicPage, RED), { timeout: 10_000 }).toBe(true);
  expect(await canvasHasColor(publicPage, BLUE)).toBe(false);

  await publicContext.close();
});
