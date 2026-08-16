import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AiDockState, PreviewSummary } from './aiDockStore.js';

interface AiRunResponse {
  id: string;
  status: string;
  errorCode?: string | null;
}

interface CreateRunResponseBody {
  run: AiRunResponse;
  patch: unknown;
  preview?: PreviewSummary;
  requiresExplicitApproval?: boolean;
  toolCallCount?: number;
}

interface ApproveResponseBody {
  run: AiRunResponse;
  snapshot: { id: string };
  batch: unknown;
}

interface BootstrapResponseBody {
  scene: SceneElement[];
}

export interface AiDockClientOptions {
  diagramId: string;
  store: UseBoundStore<StoreApi<AiDockState>>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * HTTP client for the AI dock — creates a run, approves/cancels it, restores
 * the undo snapshot, and refreshes the scene post-apply. Consumes the
 * `ai-engine`/`snapshot`/`diagram-sync` routes exactly as they already exist
 * (design.md: no route, schema, or behavior of those modules changes here).
 * Molded on `DiagramSyncClient` (`apps/web/src/sync/syncClient.ts`): injectable
 * `fetchImpl`, one branch per documented response status.
 */
export class AiDockClient {
  private readonly diagramId: string;
  private readonly store: UseBoundStore<StoreApi<AiDockState>>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AiDockClientOptions) {
    this.diagramId = options.diagramId;
    this.store = options.store;
    // Same binding rationale as DiagramSyncClient: a bare function reference loses
    // `window` as `fetch`'s receiver in real browsers ("Illegal invocation").
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  /** DOCK-01/03..05: POST /diagrams/:id/ai/runs — creates the run and lands the store in awaiting_approval, error, or rate_limited. */
  async submitRequest(userRequest: string, language: string, selection?: string[]): Promise<void> {
    this.store.getState().submitStart();

    const requestBody: { userRequest: string; language: string; selection?: string[] } = {
      userRequest,
      language,
    };
    // DOCK-03: omit `selection` entirely when there's nothing selected — an empty
    // array would silently disable the server's `outside_selection` rule instead.
    if (selection && selection.length > 0) requestBody.selection = selection;

    let response: Response;
    try {
      response = await this.fetchImpl(`/diagrams/${this.diagramId}/ai/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch {
      this.store.getState().submitFailed('network_error');
      return;
    }

    if (response.status === 429) {
      this.store.getState().rateLimited(Date.now() + RATE_LIMIT_WINDOW_MS);
      return;
    }
    if (response.status === 424) {
      this.store.getState().submitFailed('no_provider_configured');
      return;
    }
    if (response.status === 403) {
      this.store.getState().submitFailed('forbidden');
      return;
    }
    if (!response.ok) {
      this.store.getState().submitFailed('unknown');
      return;
    }

    const body = (await response.json()) as CreateRunResponseBody;
    // DOCK-09: a run that reached this endpoint but never got a preview (failed
    // before `previewing`) never offers approve — show its errorCode instead.
    if (!body.preview) {
      this.store.getState().submitFailed(body.run.errorCode ?? 'unknown');
      return;
    }

    this.store.getState().submitSuccess({
      run: { id: body.run.id, status: body.run.status },
      preview: body.preview,
      requiresExplicitApproval: body.requiresExplicitApproval ?? false,
    });
  }

  /** DOCK-13/15: POST /ai/runs/:runId:approve — only lands `applied`/`lastSnapshotId` after a resolved 200, never optimistically. */
  async approve(runId: string): Promise<void> {
    this.store.getState().approveStart();

    let response: Response;
    try {
      response = await this.fetchImpl(`/ai/runs/${runId}:approve`, { method: 'POST' });
    } catch {
      this.store.getState().submitFailed('network_error');
      return;
    }

    if (response.status === 409) {
      this.store.getState().approveConflict();
      return;
    }
    if (!response.ok) {
      this.store.getState().submitFailed('unknown');
      return;
    }

    const body = (await response.json()) as ApproveResponseBody;
    this.store.getState().approveSuccess(body.snapshot.id);
  }

  /** DOCK-14: POST /ai/runs/:runId:cancel — discards the run; nothing is ever applied, so any resolved response (any status) is treated as a successful discard. */
  async cancel(runId: string): Promise<void> {
    try {
      await this.fetchImpl(`/ai/runs/${runId}:cancel`, { method: 'POST' });
    } finally {
      this.store.getState().cancelled();
    }
  }

  /** DOCK-17..19: POST /diagrams/:id/snapshots/:snapshotId:restore — never reports success on a non-200; Desfazer stays available. */
  async undo(snapshotId: string): Promise<void> {
    this.store.getState().undoStart();

    let response: Response;
    try {
      response = await this.fetchImpl(
        `/diagrams/${this.diagramId}/snapshots/${snapshotId}:restore`,
        { method: 'POST' },
      );
    } catch {
      this.store.getState().undoFailed();
      return;
    }

    if (response.status === 200) {
      this.store.getState().undoSuccess();
      return;
    }
    this.store.getState().undoFailed();
  }

  /** Pure reuse of GET /diagrams/:id/bootstrap to fetch the fresh scene post-approve/undo — never touches the canvas itself; the caller merges it via `EditorSurfaceHandle.applyRemoteScene`. */
  async refreshScene(): Promise<{ scene: SceneElement[] }> {
    const response = await this.fetchImpl(`/diagrams/${this.diagramId}/bootstrap`);
    if (!response.ok) throw new Error(`refreshScene failed: ${response.status}`);
    const body = (await response.json()) as BootstrapResponseBody;
    return { scene: body.scene };
  }
}
