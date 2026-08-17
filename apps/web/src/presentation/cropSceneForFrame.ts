import type { SceneElement } from '@arch-canvas/editor-adapter';

/**
 * presentation-mode/T5 (design.md). Mirrors
 * `apps/server/src/modules/presentation/exportPdf.ts`'s `sceneForFrame` byte for
 * byte — KEEP THE TWO IN SYNC (cross-referenced from both files' doc comments).
 * The server crops the same way when it renders one PDF page per frame; this
 * copy crops for the SAME purpose on the client (presenter mode's viewport,
 * design.md), never for anything that decides what gets exported — that
 * decision stays server-side.
 *
 * `frame.elementId` set: every element whose `frameId` equals it (real
 * Excalidraw frame membership), plus the frame element itself (by `id`) so a
 * caller has a concrete bounding box to fit a viewport to. Zero members, or
 * `elementId: null` (a purely logical frame, or a canvas frame element deleted
 * since the presentation frame was created) — no geometric extent to crop by,
 * same documented heuristic fallback as the server: return the WHOLE scene
 * rather than an empty crop.
 */
export function cropSceneForFrame(
  scene: readonly SceneElement[],
  frame: { elementId: string | null },
): readonly SceneElement[] {
  if (!frame.elementId) return scene;
  const members = scene.filter((el) => el.frameId === frame.elementId || el.id === frame.elementId);
  return members.length > 0 ? members : scene;
}
