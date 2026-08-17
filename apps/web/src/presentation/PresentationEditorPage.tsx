import type { SceneElement } from '@arch-canvas/editor-adapter';
import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { frameLabel } from './frameLabel.js';
import {
  createPresentationClient,
  type FrameSummary,
  type PresentationSummary,
} from './presentationClient.js';

export interface PresentationEditorPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as every other page). */
  fetchImpl?: typeof fetch;
}

interface BootstrapResponseBody {
  scene?: SceneElement[];
  mutatePermissions?: { allowed: boolean };
}

/** A canvas `type: 'frame'` element from the live diagram scene, offered as an `elementId` source. */
interface CanvasFrameOption {
  id: string;
  displayName: string;
}

function extractCanvasFrames(scene: readonly SceneElement[]): CanvasFrameOption[] {
  return scene
    .filter((el) => (el as { type?: string }).type === 'frame')
    .map((el) => {
      const name = (el as { name?: string | null }).name;
      return { id: el.id, displayName: name || el.id };
    });
}

/**
 * Route `/w/:workspaceId/d/:diagramId/present/:presentationId` (design.md). Frame CRUD
 * (PRZ-05..12), reorder (PRZ-13..17) and prototype-navigation configuration (PRZ-18..21)
 * all live on this one page — publish/share/export join in later tasks (T13/T14/T24).
 *
 * The "add frame" source is exactly the schema's own duality (`packages/database/src/
 * schema.ts`): a real canvas `type: 'frame'` element (`elementId`, listed by fetching the
 * diagram's LIVE scene once via `GET /diagrams/:id/bootstrap` — never a full
 * `DiagramSyncClient`, this page never mutates the diagram itself) or a free-text logical
 * label (`frameId`) when there's nothing to point at on the canvas.
 */
export function PresentationEditorPage({
  fetchImpl: fetchImplProp,
}: PresentationEditorPageProps): JSX.Element | null {
  const { workspaceId, diagramId, presentationId } = useParams<{
    workspaceId: string;
    diagramId: string;
    presentationId: string;
  }>();
  const { t } = useTranslation();
  const fetchImpl = useMemo(() => fetchImplProp ?? fetch.bind(globalThis), [fetchImplProp]);
  const client = useMemo(() => createPresentationClient(fetchImplProp), [fetchImplProp]);

  const [presentation, setPresentation] = useState<PresentationSummary | null>(null);
  const [frames, setFrames] = useState<FrameSummary[] | null>(null);
  const [canMutate, setCanMutate] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [canvasFrames, setCanvasFrames] = useState<CanvasFrameOption[]>([]);
  const [announcement, setAnnouncement] = useState('');

  const [sourceCanvasId, setSourceCanvasId] = useState('');
  const [sourceLogical, setSourceLogical] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addInFlight, setAddInFlight] = useState(false);

  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const [editingNavLinksId, setEditingNavLinksId] = useState<string | null>(null);
  const [navLinksDraft, setNavLinksDraft] = useState<string[]>([]);
  const [navLinksError, setNavLinksError] = useState<string | null>(null);

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
      setPresentation(result.presentation);
      setFrames(result.frames);

      const bootstrapResponse = await fetchImpl(
        `/diagrams/${result.presentation.diagramId}/bootstrap`,
      );
      if (cancelled || !bootstrapResponse.ok) return;
      const body = (await bootstrapResponse.json()) as BootstrapResponseBody;
      if (cancelled) return;
      setCanMutate(body.mutatePermissions?.allowed ?? false);
      setCanvasFrames(extractCanvasFrames(body.scene ?? []));
    })();

    return () => {
      cancelled = true;
    };
  }, [presentationId, client, fetchImpl]);

  if (!workspaceId || !diagramId || !presentationId) return null;

  async function handleAddFrame(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (addInFlight) return;
    if (!presentationId || !frames) return;

    const logical = sourceLogical.trim();
    if (!sourceCanvasId && !logical) {
      setAddError(t('presentation.editor.error.missingSource'));
      return;
    }

    setAddInFlight(true);
    setAddError(null);
    try {
      const result = await client.addFrame(presentationId, {
        elementId: sourceCanvasId || null,
        frameId: sourceCanvasId ? null : logical,
        position: frames.length,
      });

      if (result.status === 'ok') {
        setFrames([...frames, result.frame]);
        setSourceCanvasId('');
        setSourceLogical('');
        setAnnouncement(t('presentation.editor.announcement.frameAdded'));
        return;
      }
      if (result.status === 'invalid') {
        setAddError(t('presentation.editor.error.invalidNavLink'));
      } else {
        setAddError(t('presentation.editor.error.generic'));
      }
      setAnnouncement(t('presentation.editor.error.generic'));
    } finally {
      setAddInFlight(false);
    }
  }

  function startEditNotes(frame: FrameSummary): void {
    setEditingNotesId(frame.id);
    setNotesDraft(frame.notes ?? '');
    setNotesError(null);
  }

  async function saveNotes(frameId: string): Promise<void> {
    if (!presentationId || !frames) return;
    const result = await client.updateFrame(presentationId, frameId, { notes: notesDraft });
    if (result.status === 'ok') {
      setFrames(frames.map((frame) => (frame.id === frameId ? result.frame : frame)));
      setEditingNotesId(null);
      setAnnouncement(t('presentation.editor.announcement.frameUpdated'));
      return;
    }
    setNotesError(t('presentation.editor.error.generic'));
    setAnnouncement(t('presentation.editor.error.generic'));
  }

  async function handleDeleteFrame(frame: FrameSummary): Promise<void> {
    if (!presentationId || !frames) return;
    if (!window.confirm(t('presentation.editor.deleteFrameConfirm'))) return;

    const result = await client.deleteFrame(presentationId, frame.id);
    if (result.status === 'ok') {
      setFrames(frames.filter((f) => f.id !== frame.id));
      setAnnouncement(t('presentation.editor.announcement.frameDeleted'));
      return;
    }
    setDeleteError(t('presentation.editor.error.generic'));
    setAnnouncement(t('presentation.editor.error.generic'));
  }

  /** PRZ-14: recomputes ALL positions (never just the moved frame's) and PATCHes the
   * whole array in one bulk request — same reorder rule as the server's bulkReorderFrames. */
  async function moveFrame(index: number, direction: -1 | 1): Promise<void> {
    if (!presentationId || !frames) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= frames.length) return;

    const reordered = [...frames];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);
    const previous = frames;

    setFrames(reordered);
    const updates = reordered.map((frame, i) => ({ id: frame.id, position: i }));
    const result = await client.reorderFrames(presentationId, updates);

    if (result.status === 'ok') {
      setFrames(result.frames);
      setAnnouncement(t('presentation.editor.announcement.framesReordered'));
      setReorderError(null);
      return;
    }
    // Revert the optimistic reorder to the last server-confirmed order (PRZ-17).
    setFrames(previous);
    setReorderError(t('presentation.editor.error.generic'));
    setAnnouncement(t('presentation.editor.error.generic'));
  }

  function startEditNavLinks(frame: FrameSummary): void {
    setEditingNavLinksId(frame.id);
    setNavLinksDraft(frame.navLinksJson.map((link) => link.targetFrameId));
    setNavLinksError(null);
  }

  async function saveNavLinks(frameId: string): Promise<void> {
    if (!presentationId || !frames) return;
    const result = await client.updateFrame(presentationId, frameId, {
      navLinksJson: navLinksDraft.map((targetFrameId) => ({ targetFrameId })),
    });
    if (result.status === 'ok') {
      setFrames(frames.map((frame) => (frame.id === frameId ? result.frame : frame)));
      setEditingNavLinksId(null);
      setAnnouncement(t('presentation.editor.announcement.navLinksSaved'));
      return;
    }
    // PRZ-20: keep the previously-saved links displayed (`frames` state is untouched) — only
    // the inline error changes, the target picker stays open with the draft as typed.
    if (result.status === 'invalid') {
      setNavLinksError(t('presentation.editor.error.invalidNavLink'));
    } else {
      setNavLinksError(t('presentation.editor.error.generic'));
    }
  }

  if (notFound) {
    return (
      <div>
        <Link to={`/w/${workspaceId}/d/${diagramId}/present`}>
          {t('presentation.editor.backToList')}
        </Link>
        <p>{t('presentation.list.error.generic')}</p>
      </div>
    );
  }

  return (
    <div>
      <Link to={`/w/${workspaceId}/d/${diagramId}/present`}>
        {t('presentation.editor.backToList')}
      </Link>
      {presentation && <h2>{t('presentation.editor.title', { name: presentation.name })}</h2>}
      <div aria-live="polite" data-testid="presentation-editor-announcement">
        {announcement}
      </div>

      <h3>{t('presentation.editor.framesTitle')}</h3>
      {deleteError && <p>{deleteError}</p>}
      {reorderError && <p>{reorderError}</p>}
      {frames && frames.length === 0 && <p>{t('presentation.list.empty')}</p>}
      {frames && frames.length > 0 && (
        <ol data-testid="frame-list">
          {frames.map((frame, index) => {
            const descriptor = frameLabel(frame, index + 1);
            const isEditingNotes = editingNotesId === frame.id;
            return (
              <li key={frame.id} data-testid={`frame-row-${frame.id}`}>
                <span>{t(descriptor.key, descriptor.params)}</span>

                {canMutate && (
                  <>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => void moveFrame(index, -1)}
                    >
                      {t('presentation.editor.moveUp')}
                    </button>
                    <button
                      type="button"
                      disabled={index === frames.length - 1}
                      onClick={() => void moveFrame(index, 1)}
                    >
                      {t('presentation.editor.moveDown')}
                    </button>
                  </>
                )}

                {isEditingNotes ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveNotes(frame.id);
                    }}
                  >
                    <label>
                      {t('presentation.editor.notesLabel')}
                      <textarea
                        value={notesDraft}
                        onChange={(event) => setNotesDraft(event.target.value)}
                      />
                    </label>
                    <button type="submit">{t('presentation.editor.saveNotes')}</button>
                    {notesError && <p>{notesError}</p>}
                  </form>
                ) : (
                  canMutate &&
                  frame.notes !== null && (
                    <p data-testid={`frame-notes-${frame.id}`}>{frame.notes}</p>
                  )
                )}

                {canMutate && !isEditingNotes && (
                  <button type="button" onClick={() => startEditNotes(frame)}>
                    {t('presentation.editor.editNotes')}
                  </button>
                )}

                {canMutate && (
                  <button type="button" onClick={() => void handleDeleteFrame(frame)}>
                    {t('presentation.editor.deleteFrame')}
                  </button>
                )}

                {canMutate &&
                  (editingNavLinksId === frame.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveNavLinks(frame.id);
                      }}
                    >
                      <label>
                        {t('presentation.editor.navLinksTargetLabel')}
                        <select
                          multiple
                          value={navLinksDraft}
                          onChange={(event) =>
                            setNavLinksDraft(
                              Array.from(event.target.selectedOptions, (option) => option.value),
                            )
                          }
                        >
                          {/* PRZ-21: a frame never targets itself. */}
                          {frames
                            .filter((candidate) => candidate.id !== frame.id)
                            .map((candidate) => {
                              const candidateDescriptor = frameLabel(
                                candidate,
                                frames.indexOf(candidate) + 1,
                              );
                              return (
                                <option key={candidate.id} value={candidate.id}>
                                  {t(candidateDescriptor.key, candidateDescriptor.params)}
                                </option>
                              );
                            })}
                        </select>
                      </label>
                      <button type="submit">{t('presentation.editor.navLinksSave')}</button>
                      {navLinksError && <p>{navLinksError}</p>}
                    </form>
                  ) : (
                    <button type="button" onClick={() => startEditNavLinks(frame)}>
                      {t('presentation.editor.navLinksTitle')}
                    </button>
                  ))}
              </li>
            );
          })}
        </ol>
      )}

      {canMutate && frames && (
        <form onSubmit={(event) => void handleAddFrame(event)}>
          <h4>{t('presentation.editor.addFrameTitle')}</h4>
          <label>
            {t('presentation.editor.sourceCanvasLabel')}
            <select
              value={sourceCanvasId}
              onChange={(event) => setSourceCanvasId(event.target.value)}
            >
              <option value="">{t('presentation.editor.sourceCanvasSelectPlaceholder')}</option>
              {canvasFrames.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('presentation.editor.sourceLogicalLabel')}
            <input
              value={sourceLogical}
              onChange={(event) => setSourceLogical(event.target.value)}
              disabled={sourceCanvasId !== ''}
            />
          </label>
          <button type="submit" disabled={addInFlight}>
            {t('presentation.editor.addFrame')}
          </button>
          {addError && <p>{addError}</p>}
        </form>
      )}
    </div>
  );
}
