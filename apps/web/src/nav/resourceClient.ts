/**
 * Generic list/create/rename/archive HTTP client (design.md's `resourceClient.ts`) — one
 * implementation shared by the workspace, project, and diagram list pages instead of three
 * near-identical clients. Only the URLs and request-body shapes differ between resources
 * (`ResourceClientConfig`); the status-branching logic below is the same for all three.
 *
 * Molded on `DiagramSyncClient`/`AiDockClient` (`apps/web/src/sync/syncClient.ts`,
 * `apps/web/src/ai-dock/aiDockClient.ts`): injectable `fetchImpl`, one branch per documented
 * response status.
 */
export interface ResourceClientConfig {
  /** e.g. `/workspaces`, `/projects?workspaceId=${id}`, `/diagrams?projectId=${id}` */
  listUrl: string;
  createUrl: string;
  /** Builds the POST body from the name/title the user typed — e.g. `{name, slug}` | `{workspaceId, name}` | `{projectId, title}`. */
  createBody: (name: string) => object;
  /** `/workspaces/:id`, `/projects/:id`, `/diagrams/:id` — used for PATCH and DELETE. */
  itemUrl: (id: string) => string;
  /** Builds the PATCH body — `{name}` | `{title}`. */
  renameBody: (name: string) => object;
  /**
   * Key wrapping the single item in POST/PATCH response bodies — `workspace` | `project` |
   * `diagram`. Additive beyond design.md's `ResourceClientConfig` sketch: the three resources'
   * create/rename responses each wrap the item under a different key (`{workspace: {...}}`,
   * `{project: {...}}`, `{diagram: {...}}`), unlike their list responses, which are uniformly
   * `{items: [...]}`. A generic client has no other way to unwrap a single created/renamed item.
   */
  itemKey: string;
}

export interface CreateResultCreated<T> {
  status: 'created';
  item: T;
}
export interface CreateResultConflict {
  status: 'conflict';
}
export interface CreateResultError {
  status: 'error';
}
export type CreateResult<T> = CreateResultCreated<T> | CreateResultConflict | CreateResultError;

export interface RenameResultOk<T> {
  status: 'ok';
  item: T;
}
export type RenameResult<T> = RenameResultOk<T> | CreateResultConflict | CreateResultError;

export type ArchiveResult = { status: 'ok' } | CreateResultError;

export interface ResourceClient<T> {
  list(): Promise<T[]>;
  create(name: string): Promise<CreateResult<T>>;
  rename(id: string, name: string): Promise<RenameResult<T>>;
  archive(id: string): Promise<ArchiveResult>;
}

interface ListResponseBody<T> {
  items: T[];
}

/** Creates one resource client instance for a given resource shape (workspace/project/diagram). */
export function createResourceClient<T>(
  config: ResourceClientConfig,
  fetchImpl?: typeof fetch,
): ResourceClient<T> {
  // Same binding rationale as DiagramSyncClient/AiDockClient: a bare function reference loses
  // `window` as `fetch`'s receiver in real browsers ("Illegal invocation").
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function list(): Promise<T[]> {
    const response = await doFetch(config.listUrl);
    if (!response.ok) throw new Error(`list failed: ${response.status}`);
    const body = (await response.json()) as ListResponseBody<T>;
    return body.items;
  }

  async function create(name: string): Promise<CreateResult<T>> {
    let response: Response;
    try {
      response = await doFetch(config.createUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config.createBody(name)),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 409) return { status: 'conflict' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as Record<string, T>;
    return { status: 'created', item: body[config.itemKey] as T };
  }

  async function rename(id: string, name: string): Promise<RenameResult<T>> {
    let response: Response;
    try {
      response = await doFetch(config.itemUrl(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config.renameBody(name)),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 409) return { status: 'conflict' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as Record<string, T>;
    return { status: 'ok', item: body[config.itemKey] as T };
  }

  async function archive(id: string): Promise<ArchiveResult> {
    let response: Response;
    try {
      response = await doFetch(config.itemUrl(id), { method: 'DELETE' });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 204) return { status: 'error' };
    return { status: 'ok' };
  }

  return { list, create, rename, archive };
}
