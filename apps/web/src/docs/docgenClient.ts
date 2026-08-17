/**
 * HTTP client for the living-docs panel — `POST /diagrams/:id/specs:generate`, `GET
 * /diagrams/:id/specs`, and `POST /diagrams/:id/specs/:version:regenerate-section` (spec.md
 * "Rotas consumidas"). `spec.markdownUrl` on every returned row is the signed read URL T1 added to
 * all 3 routes — this client never fetches that URL itself (spec.md's Assumptions: the panel does,
 * lazily, only for the selected version).
 *
 * Molded on `snapshotClient.ts`'s shape, but follows `memberClient.ts`'s naming precedent instead
 * of `snapshotClient.ts`'s own for the local binding: `repo-tools`' web-consumer extractor
 * (`tools/repo-tools/src/webConsumers.ts`) only recognizes the literal identifiers `fetch(` /
 * `fetchImpl(` (bare or `this.`-qualified) — `snapshotClient.ts` names its local binding `doFetch`
 * and so its own routes never register as `consumed` in `docs/route-inventory.md` despite being
 * genuinely wired up (a pre-existing gap this task does not touch). The local `const` below is
 * named `fetchImpl` (the outer parameter renamed to `fetchImplOption` to avoid shadowing) so this
 * client's 3 routes actually land in the `consumed` bucket. Injectable `fetchImplOption`, one
 * discriminated result per method with one branch per documented response status, never throwing
 * on a resolved HTTP response.
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
export function createDocgenClient(fetchImplOption?: typeof fetch): DocgenClient {
  // Same binding rationale as every other client in this codebase: a bare function reference
  // loses `window` as `fetch`'s receiver in real browsers ("Illegal invocation").
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(diagramId: string, cursor?: number): Promise<ListSpecsResult> {
    let response: Response;
    try {
      // Two separate literal template call sites (not one template with a conditionally-empty
      // interpolated query suffix) so `repo-tools`' web-consumer extractor — which reads the
      // literal source text at each call site, not a runtime value — can resolve both to the
      // same `/diagrams/:param/specs` path instead of the cursor-suffixed one confusing it into
      // treating the trailing `${cursor}` as part of the path itself.
      response =
        cursor === undefined
          ? await fetchImpl(`/diagrams/${diagramId}/specs`)
          : await fetchImpl(
              `/diagrams/${diagramId}/specs?cursor=${encodeURIComponent(String(cursor))}`,
            );
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
      response = await fetchImpl(`/diagrams/${diagramId}/specs:generate`, { method: 'POST' });
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
      response = await fetchImpl(`/diagrams/${diagramId}/specs/${version}:regenerate-section`, {
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
