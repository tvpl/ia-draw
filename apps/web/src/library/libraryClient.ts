/**
 * HTTP client for `GET /libraries` (CLIB-01) — the global library plus, when a
 * `workspaceId` is supplied, that workspace's own libraries (server-side scoping
 * already implemented and verified, `library.int.spec.ts`). Molded on
 * `resourceClient.ts`/`aiDockClient.ts`: injectable `fetchImpl`, throws on any
 * non-2xx response so `LibraryPanel` (T4) can render its error-with-retry state
 * (CLIB-07) from a single rejected promise.
 */

/** Mirrors the server's `LibraryRow` (`apps/server/src/modules/library/libraries.ts`) — `manifestJson` stays `unknown` here too; `LibraryPanel` parses it into `LibraryItem[]` via `@arch-canvas/library-content`'s schema. */
export interface LibraryRow {
  id: string;
  workspaceId: string | null;
  name: string;
  version: string;
  license: string;
  manifestJson: unknown;
  enabled: boolean;
}

interface LibrariesResponseBody {
  items: LibraryRow[];
}

export interface LibraryClient {
  list(workspaceId?: string): Promise<LibraryRow[]>;
}

/** Creates a library client instance; `fetchImpl` defaults to the global `fetch` (same binding rationale as `DiagramSyncClient`/`AiDockClient`: a bare reference loses `window` as receiver in real browsers). */
export function createLibraryClient(fetchImpl?: typeof fetch): LibraryClient {
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function list(workspaceId?: string): Promise<LibraryRow[]> {
    const url = workspaceId
      ? `/libraries?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/libraries';
    const response = await doFetch(url);
    if (!response.ok) throw new Error(`list failed: ${response.status}`);
    const body = (await response.json()) as LibrariesResponseBody;
    return body.items;
  }

  return { list };
}
