/**
 * HTTP client for the living-docs panel — `POST /diagrams/:id/specs:generate`, `GET
 * /diagrams/:id/specs`, and `POST /diagrams/:id/specs/:version:regenerate-section` (spec.md
 * "Rotas consumidas"). `spec.markdownUrl` on every returned row is the signed read URL T1 added to
 * all 3 routes — this client never fetches that URL itself (spec.md's Assumptions: the panel does,
 * lazily, only for the selected version).
 *
 * Molded on `snapshotClient.ts` (`apps/web/src/history/snapshotClient.ts`): injectable
 * `fetchImpl`, literal `fetchImpl(...)`/`doFetch(...)` calls (so `repo-tools`' web-consumer
 * extractor recognizes the call site), one discriminated result per method with one branch per
 * documented response status, never throwing on a resolved HTTP response.
 */

export type SpecDocumentStatus = 'draft' | 'current' | 'superseded';

export interface SpecDocumentRow {
  id: string;
  diagramId: string;
  sourceRevision: number;
  version: number;
  markdownKey: string;
  status: SpecDocumentStatus;
  generatedBy: string;
  createdAt: string;
  /** Signed GET URL for the Markdown object (T1) — TTL-limited, computed per request. */
  markdownUrl: string;
}

export type ListSpecsResult =
  | { status: 'ok'; specs: SpecDocumentRow[]; nextCursor: number | null }
  | { status: 'error' };

export type GenerateSpecResult =
  | { status: 'created'; spec: SpecDocumentRow }
  | { status: 'forbidden' }
  | { status: 'error' };

export type RegenerateSectionResult =
  | { status: 'created'; spec: SpecDocumentRow }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error' };

interface ListResponseBody {
  specs: SpecDocumentRow[];
  nextCursor: number | null;
}

interface SpecResponseBody {
  spec: SpecDocumentRow;
}

export interface DocgenClient {
  /** LDC-01/05: `GET /diagrams/:id/specs`, optionally paginated with a `version` cursor. */
  list(diagramId: string, cursor?: number): Promise<ListSpecsResult>;
  /** LDC-07..10: `POST /diagrams/:id/specs:generate` — no request body. */
  generate(diagramId: string): Promise<GenerateSpecResult>;
  /** LDC-22..27: `POST /diagrams/:id/specs/:version:regenerate-section` with `{section}`. */
  regenerateSection(
    diagramId: string,
    version: number,
    section: string,
  ): Promise<RegenerateSectionResult>;
}

/** Creates the docgen HTTP client. */
export function createDocgenClient(fetchImpl?: typeof fetch): DocgenClient {
  // Same binding rationale as every other client in this codebase: a bare function reference
  // loses `window` as `fetch`'s receiver in real browsers ("Illegal invocation").
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function list(diagramId: string, cursor?: number): Promise<ListSpecsResult> {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(String(cursor))}`;
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/specs${query}`);
    } catch {
      return { status: 'error' };
    }
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as ListResponseBody;
    return { status: 'ok', specs: body.specs, nextCursor: body.nextCursor };
  }

  async function generate(diagramId: string): Promise<GenerateSpecResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/specs:generate`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 201) {
      const body = (await response.json()) as SpecResponseBody;
      return { status: 'created', spec: body.spec };
    }
    if (response.status === 403) return { status: 'forbidden' };
    return { status: 'error' };
  }

  async function regenerateSection(
    diagramId: string,
    version: number,
    section: string,
  ): Promise<RegenerateSectionResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/specs/${version}:regenerate-section`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section }),
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 201) {
      const body = (await response.json()) as SpecResponseBody;
      return { status: 'created', spec: body.spec };
    }
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    return { status: 'error' };
  }

  return { list, generate, regenerateSection };
}
