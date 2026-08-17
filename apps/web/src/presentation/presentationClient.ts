/** Mirrors the server's `PresentationRow` (`apps/server/src/modules/presentation/presentations.ts`). */
export interface PresentationSummary {
  id: string;
  diagramId: string;
  name: string;
  publishedSnapshotId: string | null;
  settingsJson: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the server's `FrameRow` (`apps/server/src/modules/presentation/frames.ts`). `notes` is
 * already redacted (`null`) by the server for a role without `diagram:mutate` — never re-checked
 * here (design.md: the server is the single authority on redaction). */
export interface FrameSummary {
  id: string;
  presentationId: string;
  elementId: string | null;
  frameId: string | null;
  position: number;
  notes: string | null;
  navLinksJson: { targetFrameId: string }[];
  createdAt: string;
}

export interface PresentationWithFrames {
  presentation: PresentationSummary;
  frames: FrameSummary[];
}

export type ListResult =
  | { status: 'ok'; presentations: PresentationWithFrames[] }
  | { status: 'not_found' }
  | { status: 'error' };

export type CreateResult =
  | { status: 'ok'; presentation: PresentationSummary }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error' };

export type GetResult =
  | { status: 'ok'; presentation: PresentationSummary; frames: FrameSummary[] }
  | { status: 'not_found' }
  | { status: 'error' };

export type AddFrameInput = {
  elementId?: string | null;
  frameId?: string | null;
  position: number;
  notes?: string | null;
  navLinksJson?: { targetFrameId: string }[];
};

export type FrameResult =
  | { status: 'ok'; frame: FrameSummary }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'invalid' }
  | { status: 'error' };

export type DeleteResult =
  | { status: 'ok' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error' };

export type ReorderResult =
  | { status: 'ok'; frames: FrameSummary[] }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'invalid' }
  | { status: 'error' };

export type PublishResult =
  | { status: 'ok'; presentation: PresentationSummary }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error' };

export type ExportPdfResult =
  | { status: 'ok'; url: string; sizeBytes: number; pageCount: number }
  | { status: 'no_frames' }
  | { status: 'not_published' }
  | { status: 'error' };

export interface PresentationClient {
  list(diagramId: string): Promise<ListResult>;
  create(diagramId: string, name: string): Promise<CreateResult>;
  get(id: string): Promise<GetResult>;
  addFrame(presentationId: string, input: AddFrameInput): Promise<FrameResult>;
  updateFrame(
    presentationId: string,
    frameId: string,
    input: Partial<AddFrameInput>,
  ): Promise<FrameResult>;
  deleteFrame(presentationId: string, frameId: string): Promise<DeleteResult>;
  reorderFrames(
    presentationId: string,
    updates: readonly { id: string; position: number }[],
  ): Promise<ReorderResult>;
  publish(presentationId: string): Promise<PublishResult>;
  exportPdf(presentationId: string): Promise<ExportPdfResult>;
}

/**
 * Dedicated HTTP client for the `presentation` module's 8 routes this slice consumes
 * (design.md — `presentationClient.ts`), same `fetchImpl` injection convention as
 * `apps/web/src/share/shareLinkClient.ts`/`apps/web/src/nav/memberClient.ts`. Every call
 * site below reads `fetchImpl(...)` literally, which is what `repo-tools audit`'s
 * web-consumer extractor recognizes.
 *
 * `PATCH /presentations/:id` and `GET /presentations/:id/published` are the module's
 * remaining 2 routes — deliberately NOT implemented here (spec.md "Rotas consumidas":
 * neither has a UI control in this slice).
 */
export function createPresentationClient(fetchImplOption?: typeof fetch): PresentationClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(diagramId: string): Promise<ListResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations?diagramId=${encodeURIComponent(diagramId)}`);
    } catch {
      return { status: 'error' };
    }
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as { presentations?: PresentationWithFrames[] };
    return { status: 'ok', presentations: body.presentations ?? [] };
  }

  async function create(diagramId: string, name: string): Promise<CreateResult> {
    let response: Response;
    try {
      response = await fetchImpl('/presentations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ diagramId, name }),
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 201) return { status: 'error' };
    const body = (await response.json()) as { presentation?: PresentationSummary };
    if (!body.presentation) return { status: 'error' };
    return { status: 'ok', presentation: body.presentation };
  }

  async function get(id: string): Promise<GetResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${id}`);
    } catch {
      return { status: 'error' };
    }
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as {
      presentation?: PresentationSummary;
      frames?: FrameSummary[];
    };
    if (!body.presentation) return { status: 'error' };
    return { status: 'ok', presentation: body.presentation, frames: body.frames ?? [] };
  }

  async function addFrame(presentationId: string, input: AddFrameInput): Promise<FrameResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}/frames`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 400) return { status: 'invalid' };
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 201) return { status: 'error' };
    const body = (await response.json()) as { frame?: FrameSummary };
    if (!body.frame) return { status: 'error' };
    return { status: 'ok', frame: body.frame };
  }

  async function updateFrame(
    presentationId: string,
    frameId: string,
    input: Partial<AddFrameInput>,
  ): Promise<FrameResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}/frames/${frameId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 400) return { status: 'invalid' };
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as { frame?: FrameSummary };
    if (!body.frame) return { status: 'error' };
    return { status: 'ok', frame: body.frame };
  }

  async function deleteFrame(presentationId: string, frameId: string): Promise<DeleteResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}/frames/${frameId}`, {
        method: 'DELETE',
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 204) return { status: 'error' };
    return { status: 'ok' };
  }

  async function reorderFrames(
    presentationId: string,
    updates: readonly { id: string; position: number }[],
  ): Promise<ReorderResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}/frames`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frames: updates }),
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 400) return { status: 'invalid' };
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as { frames?: FrameSummary[] };
    return { status: 'ok', frames: body.frames ?? [] };
  }

  async function publish(presentationId: string): Promise<PublishResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}:publish`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as { presentation?: PresentationSummary };
    if (!body.presentation) return { status: 'error' };
    return { status: 'ok', presentation: body.presentation };
  }

  async function exportPdf(presentationId: string): Promise<ExportPdfResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}:export-pdf`, {
        method: 'POST',
      });
    } catch {
      return { status: 'error' };
    }
    if (response.status === 400) return { status: 'no_frames' };
    if (response.status === 404) return { status: 'not_published' };
    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as {
      url?: string;
      sizeBytes?: number;
      pageCount?: number;
    };
    if (!body.url) return { status: 'error' };
    return {
      status: 'ok',
      url: body.url,
      sizeBytes: body.sizeBytes ?? 0,
      pageCount: body.pageCount ?? 0,
    };
  }

  return {
    list,
    create,
    get,
    addFrame,
    updateFrame,
    deleteFrame,
    reorderFrames,
    publish,
    exportPdf,
  };
}
