import type { ElementDelta } from '@arch-canvas/editor-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMutationQueue, type MutationBatch } from './mutationQueue.js';
import { createSaveStatusStore } from './saveStatus.js';
import { DiagramSyncClient, type ReconciliationReport } from './syncClient.js';

function delta(elementId: string): ElementDelta {
  return { elementId, kind: 'upsert', version: 1, versionNonce: 1, element: undefined };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof DiagramSyncClient>[0]> = {},
) {
  const queue = createMutationQueue({ onFlush: () => {} });
  const status = createSaveStatusStore();
  // No-op by default — a test that cares about the scheduled retry actually firing
  // passes its own scheduleRetryTimer (or reads the captured callback) via `extra`.
  const client = new DiagramSyncClient({
    diagramId: 'diagram-1',
    queue,
    status,
    fetchImpl,
    retryDelayMs: () => 0,
    scheduleRetryTimer: () => {},
    ...extra,
  });
  return { client, queue, status };
}

describe('DiagramSyncClient (T25, EDT-05/REC-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaches "saved" only after the server responds 2xx — a pending response keeps "saving"', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    const { client, status } = makeClient(fetchImpl);

    const batch: MutationBatch = {
      clientMutationId: 'cmid-1',
      baseRevision: 0,
      deltas: [delta('el-1')],
    };
    const sendPromise = client.sendBatch(batch);

    expect(status.getState().kind).toBe('saving');

    resolveFetch?.(
      jsonResponse(200, {
        acks: [{ clientMutationId: 'cmid-1', sequence: 1 }],
        rejected: [],
        currentRevision: 1,
        missingOperations: [],
      }),
    );
    await sendPromise;

    expect(status.getState().kind).toBe('saved');
  });

  it('a network failure transitions to "offline" with the correct pending count and requeues the deltas', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch;
    const { client, status, queue } = makeClient(fetchImpl);

    const batch: MutationBatch = {
      clientMutationId: 'cmid-2',
      baseRevision: 0,
      deltas: [delta('el-1'), delta('el-2')],
    };
    await client.sendBatch(batch);

    expect(status.getState()).toMatchObject({ kind: 'offline', pendingCount: 2 });
    expect(queue.getState().pendingCount).toBe(2);
  });

  it('schedules a retry that resends the pending queue once invoked (REC-03)', async () => {
    let scheduled: (() => void) | undefined;
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch;
    const { client, queue } = makeClient(fetchImpl, {
      scheduleRetryTimer: (cb) => {
        scheduled = cb as () => void;
      },
    });

    await client.sendBatch({
      clientMutationId: 'cmid-retry',
      baseRevision: 0,
      deltas: [delta('el-1')],
    });
    expect(queue.getState().pendingCount).toBe(1);

    const flushSpy = vi.spyOn(queue.getState(), 'flush');
    scheduled?.();

    expect(flushSpy).toHaveBeenCalled();
  });

  it('a non-2xx (non-403) server response also transitions to "offline", never "saved"', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, {})),
    ) as unknown as typeof fetch;
    const { client, status } = makeClient(fetchImpl);

    await client.sendBatch({
      clientMutationId: 'cmid-3',
      baseRevision: 0,
      deltas: [delta('el-1')],
    });

    expect(status.getState().kind).toBe('offline');
  });

  it('a 403 response transitions to "readOnly", never "saved"', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(403, {})),
    ) as unknown as typeof fetch;
    const { client, status } = makeClient(fetchImpl);

    await client.sendBatch({
      clientMutationId: 'cmid-4',
      baseRevision: 0,
      deltas: [delta('el-1')],
    });

    expect(status.getState().kind).toBe('readOnly');
  });

  it('reconnecting resends the pending queue and reports the reconciliation result without touching newer pending edits', async () => {
    const reports: ReconciliationReport[] = [];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, { operations: [{ sequence: 5, clientMutationId: 'server-op-a' }] }),
      ),
    ) as unknown as typeof fetch;
    const { client, queue } = makeClient(fetchImpl, { onReconcile: (r) => reports.push(r) });

    // A local edit is still pending (not yet sent) when catch-up runs.
    queue.getState().enqueue([delta('local-pending-el')]);
    const pendingBefore = queue.getState().pendingCount;

    await client.catchUp();

    expect(reports).toEqual([{ appliedCount: 1, revision: 5 }]);
    // The pending local edit is NOT silently discarded/overwritten by reconciliation.
    expect(queue.getState().pendingCount).toBe(pendingBefore);
    expect(queue.getState().baseRevision).toBe(5);
  });

  it('resendPendingQueue() flushes whatever is pending in the local queue', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { client, queue } = makeClient(fetchImpl);
    const flushSpy = vi.spyOn(queue.getState(), 'flush');

    queue.getState().enqueue([delta('el-1')]);
    client.resendPendingQueue();

    expect(flushSpy).toHaveBeenCalled();
  });
});
