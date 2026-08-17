/**
 * A descriptor for `t(descriptor.key, descriptor.params)` — pure and testable without
 * an i18next instance (same "return a translation key, let the caller call `t()`"
 * convention as `apps/web/src/sync/saveStatus.ts`'s `saveStatusTranslationKey`).
 */
export interface FrameLabelDescriptor {
  key: 'presentation.frame.label' | 'presentation.frame.labelWithId';
  params: { position: number; frameId?: string };
}

/**
 * presentation-mode/T5 (design.md — single source of a frame's display label, used
 * by `PresentationEditorPage`, `FrameViewer` and `SharedResourcePage` so the 3
 * surfaces never drift into different wording for the same unnamed frame).
 *
 * `FrameRow`/`FrameSummary` carries no title field at all (schema comment,
 * `packages/database/src/schema.ts`) — every frame is labeled "Frame {{position}}"
 * (1-based, the number a person reads off a slide deck), with the frame's own
 * logical `frameId` (a free-text label, when set) shown alongside it.
 *
 * @param frame - only `frameId` matters for the label; `elementId` never appears
 *   in it (an internal Excalidraw element id is not something to show a person).
 * @param position - 1-based frame number to DISPLAY. Callers hold a 0-based array
 *   index (`frames[i]`) and pass `i + 1` — converting here instead would silently
 *   assume every caller's `position` field always starts at 0, which reordering
 *   already violates in general.
 */
export function frameLabel(
  frame: { frameId: string | null },
  position: number,
): FrameLabelDescriptor {
  if (frame.frameId) {
    return { key: 'presentation.frame.labelWithId', params: { position, frameId: frame.frameId } };
  }
  return { key: 'presentation.frame.label', params: { position } };
}
