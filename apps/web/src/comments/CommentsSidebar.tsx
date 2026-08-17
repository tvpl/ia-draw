import { type FormEvent, type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Comment,
  type CommentStatus,
  createCommentClient,
  type ListCommentsResult,
} from './commentClient.js';
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
  const [showResolved, setShowResolved] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);

  const applyList = useCallback((result: ListCommentsResult) => {
    if (result.status === 'ok') {
      setComments(result.comments);
      setListState('ready');
      return;
    }
    // CMT2-08: any non-200 leaves the list empty behind the generic error — including the 404
    // the IDOR convention returns for a diagram you cannot see.
    setListState('error');
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await client.list(diagramId);
      if (!cancelled) applyList(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [client, diagramId, applyList]);

  const allThreads = useMemo(
    () => buildThreads(comments, liveElementIds),
    [comments, liveElementIds],
  );
  // CMT2-27/28: the filter looks at the ROOT's status only — the thread is the unit of review
  // even though `status` is stored per comment (spec.md's Assumptions table).
  const threads = showResolved
    ? allThreads
    : allThreads.filter((thread) => thread.root.status === 'open');

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

  // CMT2-25: a reply always hangs off the thread ROOT, never off another reply, so every thread
  // stays exactly two levels deep no matter how the server-side chain was built.
  async function handleReplySubmit(event: FormEvent, rootId: string): Promise<void> {
    event.preventDefault();
    if (replying) return;
    const body = replyDraft.trim();
    if (!body) return;

    setReplying(true);
    try {
      const result = await client.create(diagramId, { body, parentId: rootId });
      if (result.status === 'created') {
        setComments((current) => [...current, result.comment]);
        setReplyDraft('');
        setReplyTarget(null);
        setAnnouncement(t('comments.announce.replied'));
        return;
      }
      setAnnouncement(result.status === 'not_found' ? t('comments.notFound') : t('comments.error'));
    } finally {
      setReplying(false);
    }
  }

  // CMT2-21..23: `PATCH` targets the thread root, and the new status only reaches the screen once
  // the server has answered 200 — a failure leaves the previous status in place.
  async function handleStatusChange(rootId: string, status: CommentStatus): Promise<void> {
    const result = await client.setStatus(diagramId, rootId, status);
    if (result.status === 'ok') {
      const updated = result.comment;
      setComments((current) =>
        current.map((comment) => (comment.id === rootId ? updated : comment)),
      );
      setAnnouncement(
        t(status === 'resolved' ? 'comments.announce.resolved' : 'comments.announce.reopened'),
      );
      return;
    }
    setAnnouncement(t('comments.announce.failed'));
  }

  async function handleRefresh(): Promise<void> {
    applyList(await client.list(diagramId));
  }

  return (
    <section aria-labelledby="comments-title">
      <h2 id="comments-title">{t('comments.title')}</h2>

      <div aria-live="polite" data-testid="comments-announcement">
        {announcement}
      </div>

      <label>
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(event) => setShowResolved(event.target.checked)}
        />
        {t('comments.showResolved')}
      </label>
      <button type="button" onClick={() => void handleRefresh()}>
        {t('comments.refresh')}
      </button>

      {listState === 'loading' && <p>{t('comments.loading')}</p>}
      {listState === 'error' && <p>{t('comments.error')}</p>}
      {listState === 'ready' && threads.length === 0 && <p>{t('comments.empty')}</p>}

      {listState === 'ready' && threads.length > 0 && (
        <ul>
          {threads.map((thread) => (
            <li key={thread.root.id} data-testid="comment-thread">
              <ThreadAnchorLabel anchor={thread.anchor} />
              <p>{thread.root.body}</p>
              {thread.root.status === 'resolved' && <span>{t('comments.resolvedBadge')}</span>}
              {thread.replies.length > 0 && (
                <ul>
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>{reply.body}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() =>
                  void handleStatusChange(
                    thread.root.id,
                    thread.root.status === 'open' ? 'resolved' : 'open',
                  )
                }
              >
                {t(thread.root.status === 'open' ? 'comments.resolve' : 'comments.reopen')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReplyTarget(thread.root.id);
                  setReplyDraft('');
                }}
              >
                {t('comments.reply.action')}
              </button>
              {replyTarget === thread.root.id && (
                <form
                  data-testid="reply-form"
                  onSubmit={(event) => void handleReplySubmit(event, thread.root.id)}
                >
                  <label>
                    {t('comments.reply.label')}
                    <textarea
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={replyDraft.trim().length === 0 || replying}>
                    {t('comments.reply.submit')}
                  </button>
                </form>
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
