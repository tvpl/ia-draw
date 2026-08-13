import { randomUUID } from 'node:crypto';
import type { PersistableAppState, SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { appendOperation } from '../diagram-sync/operations.js';
import { buildRestoreDeltas } from '../snapshot/index.js';
import { createDiagram, type Diagram } from '../workspace/index.js';
import { parseScene } from './sceneFile.js';

/** Carries `statusCode` so core's generic error handler renders it as problem+json, mirroring `AssetNotReadyError`/`SnapshotNotFoundError`. */
export class InvalidImportError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImportError';
  }
}

export interface ImportPreview {
  elementCount: number;
  appState: PersistableAppState;
}

interface ParsedImport {
  preview: ImportPreview;
  elements: readonly SceneElement[];
}

/**
 * Sanity ceiling on an imported scene's element count — well above spec.md's own
 * ~5,000-element scale target, purely to bound the cost of reconciling a pathological
 * import (spec.md Edge Cases: "an uploaded archive/import expanding beyond a
 * reasonable size must abort with a clear error" — the request body itself is already
 * capped at the Fastify layer, `core/server.ts`'s `MAX_REQUEST_BODY_BYTES`; this bounds
 * the parsed element count specifically, since a small but deeply-nested/repetitive
 * JSON payload could still stay under the byte cap while parsing to an excessive
 * element array).
 */
export const MAX_IMPORT_ELEMENTS = 20_000;

/**
 * Validates an uploaded `.excalidraw` file's schema (EXP-03) and returns a preview —
 * never persists anything. Rejects with a clear `InvalidImportError` (400) for
 * malformed JSON, a JSON file that isn't the expected scene envelope (`sceneFile.ts`'s
 * own `parseScene` validation), one whose `elements` field isn't an array, or one that
 * exceeds `MAX_IMPORT_ELEMENTS`.
 */
export function previewImport(fileContent: string): ParsedImport {
  let parsed: { elements: readonly SceneElement[]; appState: PersistableAppState };
  try {
    parsed = parseScene(fileContent);
  } catch (error) {
    throw new InvalidImportError(`malformed .excalidraw file: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.elements)) {
    throw new InvalidImportError('.excalidraw file has no "elements" array');
  }
  if (parsed.elements.length > MAX_IMPORT_ELEMENTS) {
    throw new InvalidImportError(
      `.excalidraw file has ${parsed.elements.length} elements, exceeding the ${MAX_IMPORT_ELEMENTS}-element import limit`,
    );
  }

  return {
    preview: { elementCount: parsed.elements.length, appState: parsed.appState },
    elements: parsed.elements,
  };
}

export interface ConfirmImportInput {
  projectId: string;
  title: string;
  ownerId: string;
  fileContent: string;
}

/**
 * Confirms an import (EXP-03: "creation is a separate call from the user
 * confirming"): re-validates `fileContent`, creates a new diagram in `projectId`, and
 * seeds it with the imported scene as its very first revision — reusing
 * `buildRestoreDeltas([], elements)` (T31) against an empty "current scene" (a brand
 * new diagram has none) and diagram-sync's own `appendOperation` (T22), the same
 * write path every other diagram mutation uses.
 */
export async function confirmImport(db: Db, input: ConfirmImportInput): Promise<Diagram> {
  const { elements } = previewImport(input.fileContent);

  const diagram = await createDiagram(db, {
    projectId: input.projectId,
    title: input.title,
    ownerId: input.ownerId,
  });

  const deltas = buildRestoreDeltas([], elements);
  if (deltas.length > 0) {
    await appendOperation(db, diagram.id, input.ownerId, {
      clientMutationId: randomUUID(),
      baseRevision: 0,
      actorId: input.ownerId,
      deltas,
    });
  }

  return diagram;
}
