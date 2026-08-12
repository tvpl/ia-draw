import { randomUUID } from 'node:crypto';
import type { Db } from '../auth/db.js';
import { svgPagesToPdfBuffer } from '../export/pdf.js';
import { type RenderElement, type RenderElements, renderSceneToSvg } from '../render/index.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { getPublishedPresentation } from './publish.js';

export class NoFramesToExportError extends Error {
  statusCode = 400;
  constructor(presentationId: string) {
    super(`presentation ${presentationId} has no frames to export`);
  }
}

const EXPORT_URL_TTL_SECONDS = 3600;

/**
 * Crops the published snapshot's scene down to one frame's elements. When
 * the presentation frame references a real canvas frame element
 * (`elementId`), membership is exactly Excalidraw's own `frameId` field:
 * every element whose `frameId` equals the frame's `elementId`, plus the
 * frame element itself so `exportToSvg` has correct bounds to compute
 * against. When the frame is only a LOGICAL frame (`frameId`, no
 * `elementId`) there is no geometric extent to crop by — documented
 * heuristic fallback: render the whole scene for that page rather than
 * silently produce an empty page.
 */
function sceneForFrame(
  scene: readonly RenderElement[],
  frame: { elementId: string | null },
): RenderElements {
  if (!frame.elementId) return scene;
  const members = scene.filter((el) => el.frameId === frame.elementId || el.id === frame.elementId);
  return members.length > 0 ? members : scene;
}

export interface ExportPresentationPdfResult {
  url: string;
  sizeBytes: number;
  pageCount: number;
}

/**
 * PRS-05: server-side multi-page PDF export — one page per frame, each
 * rendered from the PUBLISHED snapshot's frozen scene (never live), reusing
 * `render/svg.ts` (F1c/T10) and `export/pdf.ts`'s `svgPagesToPdfBuffer`
 * (F1c/AD-005 pipeline, T66 extension). Requires the presentation to already
 * be published (`publishPresentation`, T66) — an unpublished/expired
 * presentation throws the same `PresentationNotPublishedError`/
 * `PresentationExpiredError` (404) `getPublishedPresentation` already throws
 * for the read route, reused unchanged; a published-but-empty presentation
 * (zero frames) throws `NoFramesToExportError` (400) instead — that IS a
 * genuine bad request, not a "doesn't exist" case.
 */
export async function exportPresentationPdf(
  db: Db,
  storage: StorageClient,
  presentationId: string,
): Promise<ExportPresentationPdfResult> {
  // Not-published/expired (PresentationNotPublishedError/PresentationExpiredError, both 404)
  // propagate unwrapped — same "doesn't exist in this state" semantics as the read route.
  const { frames, scene } = await getPublishedPresentation(db, storage, presentationId);
  if (frames.length === 0) throw new NoFramesToExportError(presentationId);

  const renderElements = scene as RenderElement[];
  const svgs: string[] = [];
  for (const frame of frames) {
    const cropped = sceneForFrame(renderElements, frame);
    svgs.push(await renderSceneToSvg(cropped));
  }

  const pdf = await svgPagesToPdfBuffer(svgs);
  const exportId = randomUUID();
  const objectKey = `presentations/${presentationId}/exports/${exportId}.pdf`;
  await storage.putObject(EXPORT_BUCKET, objectKey, pdf, 'application/pdf');
  const url = await storage.getSignedUrl(EXPORT_BUCKET, objectKey, EXPORT_URL_TTL_SECONDS);

  return { url, sizeBytes: pdf.byteLength, pageCount: svgs.length };
}
