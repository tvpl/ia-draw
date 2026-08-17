/**
 * HTTP client for the semantic-metadata routes (CLIB-08/09/10, CLIB-14/16):
 * `GET`/`PATCH /diagrams/:id/elements/:elementId/metadata` and
 * `GET /diagrams/:id/inventory` (json/csv). Molded on `resourceClient.ts`/
 * `aiDockClient.ts`: injectable `fetchImpl`, one branch per documented response
 * status. All three routes already exist and are verified server-side
 * (`library.int.spec.ts`) — this client changes no server behavior.
 */

/** Client-side shape of a semantic metadata record (design.md "Data Models"). */
export interface ElementMetadata {
  diagramId: string;
  elementId: string;
  semanticType: string | null;
  metadataJson: Record<string, unknown>;
  revision: number;
}

/** One row of `GET /diagrams/:id/inventory` (mirrors the server's `InventoryRow`). */
export interface InventoryRow {
  elementId: string;
  /** `null` when the element no longer exists in the current scene (CLIB-15: "removido do canvas"). */
  elementType: string | null;
  semanticType: string | null;
  metadataJson: unknown;
  revision: number;
}

export interface PatchMetadataInput {
  semanticType?: string | null;
  metadataJson?: Record<string, unknown>;
}

export type PatchMetadataResult = { status: 'ok'; metadata: ElementMetadata } | { status: 'error' };

interface MetadataResponseBody {
  metadata: ElementMetadata;
}

interface InventoryResponseBody {
  items: InventoryRow[];
}

export interface MetadataClient {
  /** CLIB-08/09: `null` on 404 ("not classified yet", never a visible error) — never throws for that case. Throws on any other non-2xx. */
  get(diagramId: string, elementId: string): Promise<ElementMetadata | null>;
  /** CLIB-10: reflects only the value the server returns, never applied optimistically. `error` covers 403 (role revoked mid-session) and any other non-2xx/network failure alike (design.md Error Handling Strategy). */
  patch(
    diagramId: string,
    elementId: string,
    input: PatchMetadataInput,
  ): Promise<PatchMetadataResult>;
  /** CLIB-14/16: `'json'` resolves the parsed rows, `'csv'` resolves the raw CSV text (same content, `toCsv`'s format server-side). */
  inventory(diagramId: string, format: 'json'): Promise<InventoryRow[]>;
  inventory(diagramId: string, format: 'csv'): Promise<string>;
}

/** Creates a metadata client instance; `fetchImpl` defaults to the global `fetch` (same binding rationale as `DiagramSyncClient`/`AiDockClient`). */
export function createMetadataClient(fetchImpl?: typeof fetch): MetadataClient {
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function get(diagramId: string, elementId: string): Promise<ElementMetadata | null> {
    const response = await doFetch(`/diagrams/${diagramId}/elements/${elementId}/metadata`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`get metadata failed: ${response.status}`);
    const body = (await response.json()) as MetadataResponseBody;
    return body.metadata;
  }

  async function patch(
    diagramId: string,
    elementId: string,
    input: PatchMetadataInput,
  ): Promise<PatchMetadataResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/elements/${elementId}/metadata`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      return { status: 'error' };
    }

    if (!response.ok) return { status: 'error' };
    const body = (await response.json()) as MetadataResponseBody;
    return { status: 'ok', metadata: body.metadata };
  }

  async function inventory(
    diagramId: string,
    format: 'json' | 'csv',
  ): Promise<InventoryRow[] | string> {
    const response = await doFetch(`/diagrams/${diagramId}/inventory?format=${format}`);
    if (!response.ok) throw new Error(`inventory failed: ${response.status}`);
    if (format === 'csv') return response.text();
    const body = (await response.json()) as InventoryResponseBody;
    return body.items;
  }

  // The overloaded public signature above already pins the precise per-`format` return type for
  // callers; the implementation itself has to handle both in one function body, same pattern
  // TypeScript's own overload docs use.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const typedInventory = inventory as any;

  return { get, patch, inventory: typedInventory };
}
