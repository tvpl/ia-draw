import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDockClient } from './aiDockClient.js';
import { createAiDockStore, type PreviewSummary } from './aiDockStore.js';

const PREVIEW: PreviewSummary = {
  added: ['el-1'],
  removed: [],
  moved: [],
  modified: [],
  metadataChanged: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  const store = createAiDockStore();
  const client = new AiDockClient({ diagramId: 'diagram-1', store, fetchImpl });
  return { client, store };
}

describe('AiDockClient (T6, DOCK-01/03..20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('submitRequest', () => {
    it('sends userRequest/language and omits selection when nothing is selected, landing awaiting_approval on 201 w/ preview', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-1', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        ),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('draw three services', 'en');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/ai/runs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userRequest: 'draw three services', language: 'en' }),
        }),
      );
      expect(store.getState()).toMatchObject({
        phase: 'awaiting_approval',
        run: { id: 'run-1', status: 'awaiting_approval' },
        preview: PREVIEW,
        requiresExplicitApproval: false,
      });
    });

    it('includes selection with exactly the given ids when the canvas has a selection', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-2', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        ),
      ) as unknown as typeof fetch;
      const { client } = makeClient(fetchImpl);

      await client.submitRequest('resize these', 'pt-BR', ['el-a', 'el-b']);

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/ai/runs',
        expect.objectContaining({
          body: JSON.stringify({
            userRequest: 'resize these',
            language: 'pt-BR',
            selection: ['el-a', 'el-b'],
          }),
        }),
      );
    });

    it('201 without preview (run failed before previewing) -> error with the run.errorCode, never offering approve (DOCK-09)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-3', status: 'failed', errorCode: 'provider_timeout' },
            patch: {},
          }),
        ),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('do something', 'en');

      expect(store.getState()).toMatchObject({ phase: 'error', errorCode: 'provider_timeout' });
    });

    it('403 -> a generic error state (defensive only — the dock never renders without diagram:mutate)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(403, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('do something', 'en');

      expect(store.getState().phase).toBe('error');
    });

    it('424 (NoProviderConfiguredError) -> error with errorCode "no_provider_configured"', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(424, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('do something', 'en');

      expect(store.getState()).toMatchObject({
        phase: 'error',
        errorCode: 'no_provider_configured',
      });
    });

    it('429 -> rate_limited with rateLimitedUntil 60s in the future, re-enabling submit after that (DOCK-05)', async () => {
      vi.setSystemTime(1_000_000);
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(429, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('do something', 'en');

      expect(store.getState()).toMatchObject({
        phase: 'rate_limited',
        rateLimitedUntil: 1_000_000 + 60_000,
      });
    });

    it('a network failure -> error, never leaving submit disabled forever', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('offline')),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.submitRequest('do something', 'en');

      expect(store.getState()).toMatchObject({ phase: 'error', errorCode: 'network_error' });
    });
  });

  describe('approve', () => {
    it('200 -> applied with lastSnapshotId set only after the response resolves (DOCK-13, never optimistic)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-4', status: 'applied' },
            snapshot: { id: 'snapshot-4' },
            batch: {},
          }),
        ),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      const approvePromise = client.approve('run-4');
      // Before the response resolves, the phase is already 'approving' — never 'applied'.
      expect(store.getState().phase).toBe('approving');

      await approvePromise;

      expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-4:approve', { method: 'POST' });
      expect(store.getState()).toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-4' });
    });

    it('409 (stale sourceRevision) -> discards the preview, never applies the patch (DOCK-15)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(409, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);
      store.getState().submitSuccess({
        run: { id: 'run-5', status: 'awaiting_approval' },
        preview: PREVIEW,
        requiresExplicitApproval: false,
      });

      await client.approve('run-5');

      expect(store.getState()).toMatchObject({ phase: 'idle', preview: null, run: null });
    });

    it('a non-409 error status -> a generic error state, never applied', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.approve('run-5b');

      expect(store.getState().phase).toBe('error');
    });

    it('a network failure -> a generic error state, never applied', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('offline')),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.approve('run-5c');

      expect(store.getState()).toMatchObject({ phase: 'error', errorCode: 'network_error' });
    });
  });

  describe('cancel', () => {
    it('calls cancelled() unconditionally on a resolved response, whatever the status', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);

      await client.cancel('run-6');

      expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-6:cancel', { method: 'POST' });
      expect(store.getState().phase).toBe('idle');
    });
  });

  describe('undo', () => {
    it('200 -> undoSuccess, back to idle', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(200, { currentRevision: 9 })),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);
      store.getState().approveSuccess('snapshot-7');

      await client.undo('snapshot-7');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-7:restore', {
        method: 'POST',
      });
      expect(store.getState()).toMatchObject({ phase: 'idle', lastSnapshotId: null });
    });

    it('a non-200 status never calls undoSuccess — Desfazer stays available (DOCK-19)', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);
      store.getState().approveSuccess('snapshot-8');

      await client.undo('snapshot-8');

      expect(store.getState()).toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-8' });
    });

    it('a network failure never calls undoSuccess either', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('offline')),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);
      store.getState().approveSuccess('snapshot-9');

      await client.undo('snapshot-9');

      expect(store.getState()).toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-9' });
    });
  });

  describe('refreshScene', () => {
    it('GETs bootstrap and returns the scene without touching the canvas/store', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            scene: [{ id: 'el-1' }],
            revision: 3,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        ),
      ) as unknown as typeof fetch;
      const { client, store } = makeClient(fetchImpl);
      const phaseBefore = store.getState().phase;

      const result = await client.refreshScene();

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/bootstrap');
      expect(result).toEqual({ scene: [{ id: 'el-1' }] });
      expect(store.getState().phase).toBe(phaseBefore);
    });

    it('throws on a non-ok response', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const { client } = makeClient(fetchImpl);

      await expect(client.refreshScene()).rejects.toThrow();
    });
  });
});
