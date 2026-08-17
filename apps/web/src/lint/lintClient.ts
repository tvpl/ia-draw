/**
 * HTTP client for `GET /diagrams/:id/lint` (ALNT-01..04). Molded on
 * `metadataClient.ts`/`commentClient.ts`: injectable `fetchImpl`, one branch per documented
 * response status. The route already exists and is verified server-side (`lint.int.spec.ts`,
 * `LNT-01/02/03` in `architecture-canvas/spec.md`) — this client changes no server behavior.
 */

/** Mirrors `apps/server/src/modules/lint/engine.ts`'s `LintRuleName` exactly. */
export type LintRuleName =
  | 'orphan-component'
  | 'unclear-direction'
  | 'connector-no-protocol'
  | 'missing-trust-boundary'
  | 'spof'
  | 'secret-in-label'
  | 'mixed-environments'
  | 'c4-level-mismatch';

/** Mirrors `apps/server/src/modules/lint/engine.ts`'s `LintWarning` exactly — `severity` is
 * always `'warning'`, the engine never produces a blocking error. */
export interface LintWarning {
  rule: LintRuleName;
  severity: 'warning';
  message: string;
  elementIds: string[];
}

export type ListLintResult = { status: 'ok'; warnings: LintWarning[] } | { status: 'error' };

interface LintResponseBody {
  warnings: LintWarning[];
}

export interface LintClient {
  /** ALNT-01..04: `ok` on 200 (`warnings` may be empty — spec.md AC P1-3). Any other status or a
   * network failure resolves `{status: 'error'}` — never throws, mirroring `metadataClient`'s
   * `patch()` convention for a UI-facing result the caller renders directly. */
  list(diagramId: string): Promise<ListLintResult>;
}

/** Creates a lint client instance; `fetchImpl` defaults to the global `fetch` (same binding
 * rationale as `DiagramSyncClient`/`AiDockClient`/`createMetadataClient`). */
export function createLintClient(fetchImpl?: typeof fetch): LintClient {
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function list(diagramId: string): Promise<ListLintResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/lint`);
    } catch {
      return { status: 'error' };
    }
    if (!response.ok) return { status: 'error' };
    const body = (await response.json()) as LintResponseBody;
    return { status: 'ok', warnings: body.warnings };
  }

  return { list };
}
