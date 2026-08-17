import { describe, expect, it } from 'vitest';
import type { Comment } from './commentClient.js';
import { buildThreads } from './commentThreads.js';

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    diagramId: 'd-1',
    elementId: null,
    frameId: null,
    parentId: null,
    body: `body of ${id}`,
    status: 'open',
    authorId: 'u-1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildThreads — grouping (CMT2-06)', () => {
  it('returns one thread per root comment, in the order the list came in', () => {
    const threads = buildThreads([comment('c-1'), comment('c-2')], []);

    expect(threads.map((thread) => thread.root.id)).toEqual(['c-1', 'c-2']);
    expect(threads.map((thread) => thread.replies)).toEqual([[], []]);
  });

  it('puts a reply inside its root thread instead of listing it as a root', () => {
    const threads = buildThreads(
      [comment('c-1'), comment('c-2', { parentId: 'c-1' }), comment('c-3')],
      [],
    );

    expect(threads.map((thread) => thread.root.id)).toEqual(['c-1', 'c-3']);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(['c-2']);
  });

  it('keeps replies in the order the list came in', () => {
    const threads = buildThreads(
      [comment('c-1'), comment('c-2', { parentId: 'c-1' }), comment('c-3', { parentId: 'c-1' })],
      [],
    );

    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(['c-2', 'c-3']);
  });

  it('flattens a reply-to-a-reply into the same root thread, never a thread of its own', () => {
    const threads = buildThreads(
      [comment('c-1'), comment('c-2', { parentId: 'c-1' }), comment('c-3', { parentId: 'c-2' })],
      [],
    );

    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe('c-1');
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(['c-2', 'c-3']);
  });

  it('returns an empty array for an empty list', () => {
    expect(buildThreads([], [])).toEqual([]);
  });
});

describe('buildThreads — orphan parentId (edge case)', () => {
  it('treats a comment whose parentId is absent from the list as its own thread root', () => {
    const threads = buildThreads([comment('c-9', { parentId: 'c-gone' })], []);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe('c-9');
    expect(threads[0]?.replies).toEqual([]);
  });

  it('groups a reply to an orphan under that orphan, not under a discarded ancestor', () => {
    const threads = buildThreads(
      [comment('c-9', { parentId: 'c-gone' }), comment('c-10', { parentId: 'c-9' })],
      [],
    );

    expect(threads.map((thread) => thread.root.id)).toEqual(['c-9']);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(['c-10']);
  });
});

describe('buildThreads — anchor classification (CMT2-09, CMT2-10)', () => {
  it('classifies a root without elementId as unanchored', () => {
    const threads = buildThreads([comment('c-1')], ['el-1']);

    expect(threads[0]?.anchor).toEqual({ kind: 'none' });
  });

  it('classifies a root whose elementId is in the loaded scene as a live anchor', () => {
    const threads = buildThreads([comment('c-1', { elementId: 'el-1' })], ['el-1', 'el-2']);

    expect(threads[0]?.anchor).toEqual({ kind: 'element', elementId: 'el-1' });
  });

  it('classifies a root whose elementId is absent from the loaded scene as a removed anchor, keeping the comment', () => {
    const threads = buildThreads([comment('c-1', { elementId: 'el-gone' })], ['el-1']);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe('c-1');
    expect(threads[0]?.anchor).toEqual({ kind: 'missing', elementId: 'el-gone' });
  });
});
