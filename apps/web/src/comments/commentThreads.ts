import type { Comment } from './commentClient.js';

/**
 * How a thread's root relates to the scene loaded for this editor session.
 * `missing` exists because `comments.element_id` is a plain nullable column, not a foreign key:
 * a comment outlives the element it anchored, and that is a normal state, not corruption
 * (spec.md, CMT2-10).
 */
export type ThreadAnchor =
  | { kind: 'none' }
  | { kind: 'element'; elementId: string }
  | { kind: 'missing'; elementId: string };

export interface CommentThread {
  root: Comment;
  /** Every descendant of `root`, flattened to one level, in the order the list came in. */
  replies: Comment[];
  anchor: ThreadAnchor;
}

/**
 * Walks up `parentId` until it reaches a comment with no parent, or one whose parent is absent
 * from this response. An absent parent makes that comment the root of its own thread rather than
 * dropping it (spec.md's Edge Cases). The chain is acyclic by construction: the server only
 * accepts a `parentId` that already references an existing comment on the same diagram.
 */
function resolveRootId(comment: Comment, byId: Map<string, Comment>): string {
  let current = comment;
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent) return current.id;
    current = parent;
  }
  return current.id;
}

function classifyAnchor(root: Comment, liveElementIds: ReadonlySet<string>): ThreadAnchor {
  if (root.elementId === null) return { kind: 'none' };
  if (liveElementIds.has(root.elementId)) return { kind: 'element', elementId: root.elementId };
  return { kind: 'missing', elementId: root.elementId };
}

/**
 * Turns the server's flat, oldest-first comment list into threads (CMT2-06).
 * `GET /diagrams/:id/comments` deliberately returns a flat list with each row carrying its own
 * `parentId` and leaves reconstruction to the caller; this is that caller.
 *
 * Threads are flattened to two levels on purpose (spec.md's Assumptions table): the server puts no
 * bound on `parentId` depth, and a deeper chain created by another client still shows up whole,
 * inside the thread its chain leads to.
 */
export function buildThreads(
  comments: readonly Comment[],
  liveElementIds: readonly string[],
): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const liveIds = new Set(liveElementIds);

  const threads: CommentThread[] = [];
  const byRootId = new Map<string, CommentThread>();

  for (const comment of comments) {
    const rootId = resolveRootId(comment, byId);
    if (rootId === comment.id) {
      const thread: CommentThread = {
        root: comment,
        replies: [],
        anchor: classifyAnchor(comment, liveIds),
      };
      threads.push(thread);
      byRootId.set(comment.id, thread);
      continue;
    }
    byRootId.get(rootId)?.replies.push(comment);
  }

  return threads;
}
