import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { MutationBatch, MutationQueueState } from './mutationQueue.js';
import type { SaveStatusState } from './saveStatus.js';

export interface BootstrapResult {
  scene: SceneElement[];
  revision: number;
  assets: unknown[];
  permissions: { allowed: boolean; reason: string };
}

interface ServerOperation {
  sequence: number;
  clientMutationId: string;
}

interface BatchResponseBody {
  acks: Array<{ clientMutationId: string; sequence: number }>;
  rejected: unknown[];
  currentRevision: number;
  missingOperations: ServerOperation[];
}

/**
 * Reported whenever the server's response (an ack or a catch-up) carries
 * operations the client didn't already know about — the "reconciliation
 * result" EDT-05/REC-02 require the client report, never silently swallow.
 */
export interface ReconciliationReport {
  appliedCount: number;
  revision: number;
}

export interface DiagramSyncClientOptions {
  diagramId: string;
  queue: UseBoundStore<StoreApi<MutationQueueState>>;
  status: UseBoundStore<StoreApi<SaveStatusState>>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable backoff schedule for tests; defaults to capped exponential backoff. */
  retryDelayMs?: (attempt: number) => number;
  /** Injectable timer for tests. */
  scheduleRetryTimer?: (callback: () => void, delayMs: number) => unknown;
  onReconcile?: (report: ReconciliationReport) => void;
}

const DEFAULT_RETRY_DELAY = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

/**
 * The client half of the server-first invariant: calls bootstrap once, sends
 * every flushed batch from the local queue (T24) via `operations:batch`, and
 * reconciles catch-up results — always reporting, never silently overwriting
 * a newer server revision (EDT-05, REC-02).
 */
export class DiagramSyncClient {
  private readonly diagramId: string;
  private readonly queue: UseBoundStore<StoreApi<MutationQueueState>>;
  private readonly status: UseBoundStore<StoreApi<SaveStatusState>>;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly scheduleRetryTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly onReconcile?: (report: ReconciliationReport) => void;

  private actorId = '';
  private knownRevision = 0;
  private retryAttempt = 0;

  constructor(options: DiagramSyncClientOptions) {
    this.diagramId = options.diagramId;
    this.queue = options.queue;
    this.status = options.status;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY;
    this.scheduleRetryTimer = options.scheduleRetryTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.onReconcile = options.onReconcile;
  }

  /** Sets the authenticated actor id carried on outgoing envelopes (the server ignores this value and always uses the session's own user — it only needs to be a well-formed uuid). */
  setActorId(actorId: string): void {
    this.actorId = actorId;
  }

  /** WHEN a diagram is opened THEN bootstrap from the server before enabling editing (EDT-01). */
  async bootstrap(): Promise<BootstrapResult> {
    const response = await this.fetchImpl(`/diagrams/${this.diagramId}/bootstrap`);
    if (!response.ok) {
      this.status.getState().setOffline(this.queue.getState().pendingCount);
      throw new Error(`bootstrap failed: ${response.status}`);
    }
    const body = (await response.json()) as BootstrapResult;
    this.knownRevision = body.revision;
    this.queue.getState().setBaseRevision(body.revision);
    if (!body.permissions.allowed) this.status.getState().setReadOnly();
    else this.status.getState().setSaved();
    return body;
  }

  /** The queue's `onFlush` callback — sends one batch, drives save-status, and never marks `Salvo` without a 2xx ack. */
  sendBatch = async (batch: MutationBatch): Promise<void> => {
    this.status.getState().setSaving();

    let response: Response;
    try {
      response = await this.fetchImpl(`/diagrams/${this.diagramId}/operations:batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...batch, actorId: this.actorId }),
      });
    } catch {
      this.goOfflineAndRetry(batch);
      return;
    }

    if (response.status === 403) {
      this.status.getState().setReadOnly();
      return;
    }

    if (!response.ok) {
      this.goOfflineAndRetry(batch);
      return;
    }

    const body = (await response.json()) as BatchResponseBody;
    this.retryAttempt = 0;

    if (body.missingOperations.length > 0) {
      this.reconcile(body.missingOperations, body.currentRevision);
    } else {
      this.knownRevision = body.currentRevision;
      this.queue.getState().setBaseRevision(body.currentRevision);
    }

    this.status.getState().setSaved();
  };

  /** GET .../operations?afterSequence= — catches up a stale revision after a reconnect (REC-04). */
  async catchUp(): Promise<void> {
    const response = await this.fetchImpl(
      `/diagrams/${this.diagramId}/operations?afterSequence=${this.knownRevision}`,
    );
    if (!response.ok) throw new Error(`catch-up failed: ${response.status}`);

    const body = (await response.json()) as { operations: ServerOperation[] };
    if (body.operations.length === 0) return;

    const latest = body.operations.at(-1);
    this.reconcile(body.operations, latest?.sequence ?? this.knownRevision);
  }

  /**
   * IF the browser closes holding unconfirmed pending mutations THEN resend
   * the pending queue after authentication and report the result (REC-02) —
   * called once auth/bootstrap succeeds after a reconnect.
   */
  resendPendingQueue(): void {
    this.queue.getState().flush();
  }

  private goOfflineAndRetry(batch: MutationBatch): void {
    // Never claim Salvo on a failed/network-errored send — requeue the deltas so
    // they resend (REC-03: "resend the pending queue in order once the database
    // recovers") and reflect the real pending count.
    this.queue.getState().enqueue(batch.deltas);
    this.status.getState().setOffline(this.queue.getState().pendingCount);
    const delay = this.retryDelayMs(this.retryAttempt++);
    this.scheduleRetryTimer(() => this.queue.getState().flush(), delay);
  }

  /**
   * Reconciliation never silently overwrites a newer server revision: it only
   * advances `baseRevision`/`knownRevision` (so the next batch carries the
   * right base) and reports the result via `onReconcile` — it never touches
   * `pendingByElementId`, so locally pending (not-yet-sent) edits survive.
   */
  private reconcile(operations: ServerOperation[], revision: number): void {
    this.knownRevision = revision;
    this.queue.getState().setBaseRevision(revision);
    this.onReconcile?.({ appliedCount: operations.length, revision });
  }
}
