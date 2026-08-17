/**
 * HTTP client for the history/snapshots panel — `GET`/`POST /diagrams/:id/snapshots`,
 * `POST .../:snapshotId:restore`, and `GET .../diff`. Consumes those four routes exactly as
 * they already exist (spec.md "Rotas consumidas": no route, schema, or behavior changes here).
 *
 * Molded on `AiDockClient`/`createResourceClient` (`apps/web/src/ai-dock/aiDockClient.ts`,
 * `apps/web/src/nav/resourceClient.ts`): injectable `fetchImpl`, one branch per documented
 * response status. Unlike those two, every method takes `diagramId` as an explicit argument
 * (tasks.md's T1 signatures) rather than binding it at construction — the history panel and
 * the diff view both read/write the same diagram, but neither owns a client instance scoped
 * to a single diagram identity the way `AiDock` does.
 */

export type SnapshotKind = 'auto' | 'named' | 'published' | 'pre_ai' | 'restore_point';

/** `SNAP-01`: the fields the timeline needs from each `diagram_snapshots` row the server returns. */
export interface SnapshotRow {
  id: string;
  revision: number;
  kind: SnapshotKind;
  name: string | null;
  createdAt: string;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  moved: string[];
  modified: string[];
}

export type RestoreResult =
  | { status: 'ok'; currentRevision: number; restoredFromSnapshotId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error' };

export type DiffFetchResult =
  | { status: 'ok'; diff: DiffResult }
  /** SNAP-13: carries the server's own `title` (RFC 9457 problem body) so the caller can show it verbatim. */
  | { status: 'not_found'; message: string }
  | { status: 'error' };

interface ListResponseBody {
  snapshots: SnapshotRow[];
}

interface CreateResponseBody {
  snapshot: SnapshotRow;
}

interface RestoreResponseBody {
  currentRevision: number;
  restoredFromSnapshotId: string;
}

interface ProblemBody {
  title?: string;
}

export interface SnapshotClient {
  /** SNAP-01: `GET /diagrams/:id/snapshots` — the server already orders most-recent-first (by revision). */
  list(diagramId: string): Promise<SnapshotRow[]>;
  /** SNAP-03/04: `POST /diagrams/:id/snapshots` — omits `name` entirely when blank; the server accepts an absent `name`. */
  create(diagramId: string, name?: string): Promise<SnapshotRow>;
  /** SNAP-07..09: `POST .../:snapshotId:restore` — branches on 200/404/403; never throws on a resolved HTTP response. */
  restore(diagramId: string, snapshotId: string, clientMutationId: string): Promise<RestoreResult>;
  /** SNAP-11/13: `GET .../diff?from=&to=` — branches on 200/404; never throws on a resolved HTTP response. */
  diff(diagramId: string, from: string, to: string): Promise<DiffFetchResult>;
}

export interface SnapshotClientOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Creates one snapshot-client instance (design.md: no per-diagram state to hold, so one instance serves every diagram the caller touches). */
export function createSnapshotClient(options: SnapshotClientOptions = {}): SnapshotClient {
  // Same binding rationale as AiDockClient/DiagramSyncClient: a bare function reference loses
  // `window` as `fetch`'s receiver in real browsers ("Illegal invocation").
  const doFetch = options.fetchImpl ?? fetch.bind(globalThis);

  async function list(diagramId: string): Promise<SnapshotRow[]> {
    const response = await doFetch(`/diagrams/${diagramId}/snapshots`);
    if (!response.ok) throw new Error(`list failed: ${response.status}`);
    const body = (await response.json()) as ListResponseBody;
    return body.snapshots;
  }

  async function create(diagramId: string, name?: string): Promise<SnapshotRow> {
    // SNAP-04: an empty/blank name is sent as no `name` field at all, not `name: ""`.
    const requestBody: { name?: string } = {};
    if (name && name.trim().length > 0) requestBody.name = name;

    const response = await doFetch(`/diagrams/${diagramId}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
    const body = (await response.json()) as CreateResponseBody;
    return body.snapshot;
  }

  async function restore(
    diagramId: string,
    snapshotId: string,
    clientMutationId: string,
  ): Promise<RestoreResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/snapshots/${snapshotId}:restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientMutationId }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 200) {
      const body = (await response.json()) as RestoreResponseBody;
      return {
        status: 'ok',
        currentRevision: body.currentRevision,
        restoredFromSnapshotId: body.restoredFromSnapshotId,
      };
    }
    if (response.status === 404) return { status: 'not_found' };
    if (response.status === 403) return { status: 'forbidden' };
    return { status: 'error' };
  }

  async function diff(diagramId: string, from: string, to: string): Promise<DiffFetchResult> {
    let response: Response;
    try {
      response = await doFetch(
        `/diagrams/${diagramId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
    } catch {
      return { status: 'error' };
    }

    if (response.status === 200) {
      const body = (await response.json()) as DiffResult;
      return {
        status: 'ok',
        diff: {
          added: body.added,
          removed: body.removed,
          moved: body.moved,
          modified: body.modified,
        },
      };
    }
    if (response.status === 404) {
      const body = (await response.json().catch(() => ({}))) as ProblemBody;
      return { status: 'not_found', message: body.title ?? '' };
    }
    return { status: 'error' };
  }

  return { list, create, restore, diff };
}
