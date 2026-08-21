import {
  EditorSurface,
  type EditorSurfaceHandle,
  type SceneElement,
} from '@arch-canvas/editor-adapter';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { FrameViewer } from './FrameViewer.js';
import { createPresentationClient, type FrameSummary } from './presentationClient.js';

export interface PresenterModePageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as every other page). */
  fetchImpl?: typeof fetch;
}

interface BootstrapResponseBody {
  scene?: SceneElement[];
}

/**
 * Route `/w/:workspaceId/d/:diagramId/present/:presentationId/presenter` (design.md,
 * T19/PRZ-35..41) — tela cheia, fora do `AppShell`. Mounts the diagram's LIVE scene
 * (a single read-only `bootstrap` fetch, never `DiagramSyncClient` — this page has no
 * mutation queue and never opens a presence socket, same restraint
 * `PresentationEditorPage` already applies to its own read of the live scene) on an
 * `EditorSurface` with `viewModeEnabled` permanently `true`, and drives it through
 * `FrameViewer` (the same navigation component `SharedResourcePage`'s published view
 * uses) plus `scrollToFrame` on the imperative handle (AD-010) to move the viewport
 * frame-by-frame. Never emits a write request — there is nothing here to POST/PATCH/
 * DELETE.
 */
export function PresenterModePage({
  fetchImpl: fetchImplProp,
}: PresenterModePageProps): JSX.Element | null {
  const { workspaceId, diagramId, presentationId } = useParams<{
    workspaceId: string;
    diagramId: string;
    presentationId: string;
  }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchImpl = useMemo(() => fetchImplProp ?? fetch.bind(globalThis), [fetchImplProp]);
  const client = useMemo(() => createPresentationClient(fetchImplProp), [fetchImplProp]);
  const editorSurfaceRef = useRef<EditorSurfaceHandle>(null);

  const [frames, setFrames] = useState<FrameSummary[] | null>(null);
  const [scene, setScene] = useState<SceneElement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!presentationId) return;
    let cancelled = false;

    (async () => {
      const result = await client.get(presentationId);
      if (cancelled) return;
      if (result.status !== 'ok') {
        setNotFound(true);
        return;
      }
      setFrames(result.frames);

      const bootstrapResponse = await fetchImpl(
        `/diagrams/${result.presentation.diagramId}/bootstrap`,
      );
      if (cancelled || !bootstrapResponse.ok) return;
      const body = (await bootstrapResponse.json()) as BootstrapResponseBody;
      if (cancelled) return;
      setScene(body.scene ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [presentationId, client, fetchImpl]);

  const currentFrame = frames?.[currentIndex] ?? null;

  // PRZ-37: every frame change (linear nav, a prototype nav-link jump, or the initial
  // mount) moves the viewport through the SAME imperative handle AD-010 established —
  // never a second, parallel path onto the canvas.
  useEffect(() => {
    if (!currentFrame) return;
    editorSurfaceRef.current?.scrollToFrame(currentFrame.elementId);
  }, [currentFrame]);

  const exitPath = `/w/${workspaceId}/d/${diagramId}/present/${presentationId}`;

  // PRZ-38/39: a document-level listener (not a JSX handler on one element) so the
  // shortcuts work no matter where focus currently sits in this fullscreen page —
  // the same reasoning any "works anywhere in the view" keyboard shortcut needs.
  useEffect(() => {
    if (!frames) return;
    const frameCount = frames.length;

    function onKeyDown(event: KeyboardEvent): void {
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          setCurrentIndex((index) => Math.min(index + 1, frameCount - 1));
          return;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          setCurrentIndex((index) => Math.max(index - 1, 0));
          return;
        case 'Escape':
          event.preventDefault();
          navigate(exitPath);
          return;
        default:
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [frames, navigate, exitPath]);

  if (!workspaceId || !diagramId || !presentationId) return null;

  if (notFound) {
    return (
      <div>
        <p>{t('presentation.list.error.generic')}</p>
      </div>
    );
  }

  if (!frames) {
    return (
      <div>
        <p>{t('presentation.presenter.loading')}</p>
      </div>
    );
  }

  return (
    <div data-testid="presenter-shell">
      <button
        type="button"
        onClick={() => navigate(exitPath)}
        aria-label={t('presentation.presenter.exitLabel')}
      >
        {t('presentation.presenter.exit')}
      </button>
      <FrameViewer
        frames={frames}
        currentIndex={currentIndex}
        onNavigate={setCurrentIndex}
        renderCanvas={() => (
          <div style={{ height: '80vh' }}>
            <EditorSurface ref={editorSurfaceRef} initialElements={scene} viewModeEnabled />
          </div>
        )}
      />
    </div>
  );
}
