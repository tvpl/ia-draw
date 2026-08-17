/**
 * HTTP client for export/bundle/import (T1, XPRT-01/05/07/13) — consumes the 4 already-
 * implemented, already-verified server routes exactly as documented in spec.md's Problem
 * Statement: `POST /diagrams/:id/exports` always generates all 4 formats in one call (no
 * per-format parameter), `POST /projects/:id/import` is preview-then-confirm on the same
 * endpoint, and `POST /workspaces/:id/bundles` is fire-and-forget with no status/download
 * route.
 *
 * Molded on `resourceClient.ts` (`apps/web/src/nav/resourceClient.ts`): a plain factory
 * function (no store coupling — the export/import components own their own local state),
 * injectable `fetchImpl`, one discriminated result per operation with one branch per
 * documented response status.
 */

export interface ExportFormatResult {
  url: string;
  checksum: string;
  sizeBytes: number;
  contentType: string;
}

export interface ExportFormats {
  excalidraw: ExportFormatResult;
  svg: ExportFormatResult;
  png: ExportFormatResult;
  pdf: ExportFormatResult;
}

export type GenerateExportsResult =
  | { status: 'ok'; exportId: string; revision: number; formats: ExportFormats }
  | { status: 'rate_limited' }
  | { status: 'error' };

export type GenerateBundleResult =
  | { status: 'ok'; bundleId: string; url: string; sizeBytes: number; manifest: unknown }
  | { status: 'error' };

export interface ImportPreview {
  elementCount: number;
  appState: unknown;
}

export type PreviewImportResult =
  | { status: 'ok'; preview: ImportPreview }
  | { status: 'invalid'; message: string }
  | { status: 'error' };

export interface ImportedDiagram {
  id: string;
  projectId: string;
  title: string;
}

export type ConfirmImportResult =
  | { status: 'ok'; preview: ImportPreview; diagram: ImportedDiagram }
  | { status: 'invalid'; message: string }
  | { status: 'error' };

export type RequestWorkspaceBundleResult =
  | { status: 'ok'; jobId: string }
  | { status: 'unavailable' }
  | { status: 'error' };

interface GenerateExportsResponseBody {
  exportId: string;
  revision: number;
  formats: ExportFormats;
}

interface GenerateBundleResponseBody {
  bundleId: string;
  url: string;
  sizeBytes: number;
  manifest: unknown;
}

interface ImportResponseBody {
  preview: ImportPreview;
  diagram?: ImportedDiagram;
}

interface ProblemDetailsBody {
  title: string;
}

interface RequestWorkspaceBundleResponseBody {
  jobId: string;
  status: string;
}

export interface ExportClient {
  /** XPRT-01/03: single call to `POST /diagrams/:id/exports`; a `429` maps to `rate_limited`. */
  generateExports(diagramId: string): Promise<GenerateExportsResult>;
  /** XPRT-05: `POST /diagrams/:id/bundle` — one diagram's `.zip`. */
  generateBundle(diagramId: string): Promise<GenerateBundleResult>;
  /** XPRT-07/08: `POST /projects/:id/import` without `confirm` — preview only, never persists. */
  previewImport(projectId: string, fileContent: string): Promise<PreviewImportResult>;
  /** XPRT-09/10: `POST /projects/:id/import` with `confirm: true` + `title` — creates the diagram. */
  confirmImport(
    projectId: string,
    fileContent: string,
    title: string,
  ): Promise<ConfirmImportResult>;
  /** XPRT-13/14: `POST /workspaces/:id/bundles` — fire-and-forget queue trigger, no status/download route exists. */
  requestWorkspaceBundle(workspaceId: string): Promise<RequestWorkspaceBundleResult>;
}

/** Creates the export/bundle/import HTTP client. */
export function createExportClient(fetchImpl?: typeof fetch): ExportClient {
  // Same binding rationale as DiagramSyncClient/AiDockClient/resourceClient: a bare
  // function reference loses `window` as `fetch`'s receiver in real browsers.
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function generateExports(diagramId: string): Promise<GenerateExportsResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/exports`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 429) return { status: 'rate_limited' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as GenerateExportsResponseBody;
    return {
      status: 'ok',
      exportId: body.exportId,
      revision: body.revision,
      formats: body.formats,
    };
  }

  async function generateBundle(diagramId: string): Promise<GenerateBundleResult> {
    let response: Response;
    try {
      response = await doFetch(`/diagrams/${diagramId}/bundle`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as GenerateBundleResponseBody;
    return {
      status: 'ok',
      bundleId: body.bundleId,
      url: body.url,
      sizeBytes: body.sizeBytes,
      manifest: body.manifest,
    };
  }

  async function sendImport(
    projectId: string,
    fileContent: string,
    confirm?: { title: string },
  ): Promise<Response | null> {
    try {
      return await doFetch(`/projects/${projectId}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          confirm ? { fileContent, confirm: true, title: confirm.title } : { fileContent },
        ),
      });
    } catch {
      return null;
    }
  }

  async function previewImport(
    projectId: string,
    fileContent: string,
  ): Promise<PreviewImportResult> {
    const response = await sendImport(projectId, fileContent);
    if (!response) return { status: 'error' };

    if (response.status === 400) {
      const body = (await response.json()) as ProblemDetailsBody;
      return { status: 'invalid', message: body.title };
    }
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as ImportResponseBody;
    return { status: 'ok', preview: body.preview };
  }

  async function confirmImport(
    projectId: string,
    fileContent: string,
    title: string,
  ): Promise<ConfirmImportResult> {
    const response = await sendImport(projectId, fileContent, { title });
    if (!response) return { status: 'error' };

    if (response.status === 400) {
      const body = (await response.json()) as ProblemDetailsBody;
      return { status: 'invalid', message: body.title };
    }
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as ImportResponseBody;
    if (!body.diagram) return { status: 'error' };
    return { status: 'ok', preview: body.preview, diagram: body.diagram };
  }

  async function requestWorkspaceBundle(
    workspaceId: string,
  ): Promise<RequestWorkspaceBundleResult> {
    let response: Response;
    try {
      response = await doFetch(`/workspaces/${workspaceId}/bundles`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 503) return { status: 'unavailable' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as RequestWorkspaceBundleResponseBody;
    return { status: 'ok', jobId: body.jobId };
  }

  return {
    generateExports,
    generateBundle,
    previewImport,
    confirmImport,
    requestWorkspaceBundle,
  };
}
