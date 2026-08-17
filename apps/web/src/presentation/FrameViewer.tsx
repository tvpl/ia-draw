import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { frameLabel } from './frameLabel.js';

/** The minimal structural shape `FrameViewer` needs — satisfied by both
 * `presentationClient.ts`'s `FrameSummary` (presenter mode, live scene) and
 * `shareLinkClient.ts`'s `PublicFrame` (public view, frozen scene) without either
 * importing the other's type (design.md — one shared navigation component, two
 * different scene sources). */
export interface ViewableFrame {
  id: string;
  frameId: string | null;
  navLinksJson: readonly { targetFrameId: string }[];
}

export interface FrameViewerProps<TFrame extends ViewableFrame> {
  frames: readonly TFrame[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  /** Renders the canvas for the CURRENT frame — a live, scrollable `EditorSurface` in
   * presenter mode, or a statically-cropped read-only one in the public view. */
  renderCanvas: (frame: TFrame) => ReactNode;
}

/**
 * presentation-mode/T17 (design.md) — the ONE frame-navigation UI shared by
 * `PresenterModePage` and `SharedResourcePage`'s published-presentation branch:
 * position indicator, previous/next, and a button per prototype navigation link on
 * the current frame (PRZ-31, PRZ-33, PRZ-38, PRZ-40). Purely presentational — it owns
 * no fetch, no state beyond what its props already carry, and every navigation
 * (linear or via a nav link) goes through the SAME `onNavigate` callback, so a
 * caller never needs two different "jump to frame" code paths.
 */
export function FrameViewer<TFrame extends ViewableFrame>({
  frames,
  currentIndex,
  onNavigate,
  renderCanvas,
}: FrameViewerProps<TFrame>): JSX.Element | null {
  const { t } = useTranslation();
  const current = frames[currentIndex];
  if (!current) return null;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === frames.length - 1;

  return (
    <div>
      <p data-testid="frame-viewer-position">
        {t('presentation.viewer.position', { current: currentIndex + 1, total: frames.length })}
      </p>

      <div>
        <button type="button" disabled={isFirst} onClick={() => onNavigate(currentIndex - 1)}>
          {t('presentation.viewer.prev')}
        </button>
        <button type="button" disabled={isLast} onClick={() => onNavigate(currentIndex + 1)}>
          {t('presentation.viewer.next')}
        </button>
      </div>

      {current.navLinksJson.length > 0 && (
        <div data-testid="frame-viewer-nav-links">
          {current.navLinksJson.map((link) => {
            const targetIndex = frames.findIndex((frame) => frame.id === link.targetFrameId);
            if (targetIndex === -1) return null;
            const targetFrame = frames[targetIndex];
            if (!targetFrame) return null;
            const descriptor = frameLabel(targetFrame, targetIndex + 1);
            const label = t(descriptor.key, descriptor.params);
            return (
              <button
                type="button"
                key={link.targetFrameId}
                onClick={() => onNavigate(targetIndex)}
              >
                {t('presentation.viewer.navLinkTo', { label })}
              </button>
            );
          })}
        </div>
      )}

      {renderCanvas(current)}
    </div>
  );
}
