import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Comment, createCommentClient } from './commentClient.js';
import { buildThreads, type ThreadAnchor } from './commentThreads.js';

export interface CommentsSidebarProps {
  diagramId: string;
  /** The canvas's currently-selected element ids (`EditorSurface`'s `onSelectionChange`) — the pending anchor for a new comment (CMT2-13..15). */
  selection: readonly string[];
  /** Element ids of the scene this editor session loaded, used only to tell a live anchor from a removed one (CMT2-09/10). */
  liveElementIds: readonly string[];
  /** Injectable for tests; defaults to the global fetch (same convention as `AiDock`/`WorkspaceMembersPage`). */
  fetchImpl?: typeof fetch;
}

type ListState = 'loading' | 'ready' | 'error';

/**
 * The comments panel (spec.md, CMT2-05..19) — lists the diagram's threads and composes new
 * comments anchored to the canvas selection.
 *
 * It takes no permission input on purpose: `comment:create` and `comment:resolve` are granted to
 * all 5 roles in `packages/auth`, so a `reviewer`/`viewer` whose bootstrap reports
 * `mutatePermissions.allowed: false` still gets the full panel. That is the product proof of
 * "revisor comenta e nunca edita" (CMT2-11).
 *
 * The panel is REST-only: another user's comment shows up after a reload or an explicit refresh,
 * never on its own. Accepted and documented limitation (spec.md's Assumptions table), not a gap.
 */
export function CommentsSidebar({
  diagramId,
  selection,
  liveElementIds,
  fetchImpl,
}: CommentsSidebarProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createCommentClient(fetchImpl), [fetchImpl]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await client.list(diagramId);
      if (cancelled) return;
      if (result.status === 'ok') {
        setComments(result.comments);
        setListState('ready');
        return;
      }
      // CMT2-08: any non-200 leaves the list empty behind the generic error — including the 404
      // the IDOR convention returns for a diagram you cannot see.
      setListState('error');
    })();

    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  const threads = useMemo(() => buildThreads(comments, liveElementIds), [comments, liveElementIds]);

  // CMT2-13..15: a single selected element is the anchor; zero or several means no anchor at all,
  // because `elementId` is one scalar and picking "the first" of a multi-selection would be
  // arbitrary (spec.md's Assumptions table).
  const pendingAnchor = selection.length === 1 ? selection[0] : undefined;
  const anchorHintKey =
    selection.length === 0
      ? 'comments.composer.anchor.none'
      : selection.length === 1
        ? 'comments.composer.anchor.element'
        : 'comments.composer.anchor.multiple';

  const isBlank = draft.trim().length === 0;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (creating) return;
    const body = draft.trim();
    if (!body) return;

    setCreating(true);
    try {
      const result = await client.create(
        diagramId,
        pendingAnchor === undefined ? { body } : { body, elementId: pendingAnchor },
      );

      if (result.status === 'created') {
        setComments((current) => [...current, result.comment]);
        setDraft('');
        setAnnouncement(t('comments.announce.created'));
        return;
      }
      setAnnouncement(result.status === 'not_found' ? t('comments.notFound') : t('comments.error'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section aria-labelledby="comments-title">
      <h2 id="comments-title">{t('comments.title')}</h2>

      <div aria-live="polite" data-testid="comments-announcement">
        {announcement}
      </div>

      {listState === 'loading' && <p>{t('comments.loading')}</p>}
      {listState === 'error' && <p>{t('comments.error')}</p>}
      {listState === 'ready' && threads.length === 0 && <p>{t('comments.empty')}</p>}

      {listState === 'ready' && threads.length > 0 && (
        <ul>
          {threads.map((thread) => (
            <li key={thread.root.id} data-testid="comment-thread">
              <ThreadAnchorLabel anchor={thread.anchor} />
              <p>{thread.root.body}</p>
              {thread.replies.length > 0 && (
                <ul>
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>{reply.body}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <form data-testid="comment-composer" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          {t('comments.composer.label')}
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <p>{t(anchorHintKey, { elementId: pendingAnchor })}</p>
        <button type="submit" disabled={isBlank || creating}>
          {t('comments.composer.submit')}
        </button>
      </form>
    </section>
  );
}

function ThreadAnchorLabel({ anchor }: { anchor: ThreadAnchor }): JSX.Element | null {
  const { t } = useTranslation();
  if (anchor.kind === 'none') return null;
  return (
    <p data-testid="thread-anchor">
      {anchor.kind === 'element'
        ? t('comments.anchor', { elementId: anchor.elementId })
        : t('comments.anchorMissing', { elementId: anchor.elementId })}
    </p>
  );
}
