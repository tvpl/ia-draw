import { describe, expect, it, vi } from 'vitest';
import { type Comment, createCommentClient } from './commentClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    diagramId: 'd-1',
    elementId: null,
    frameId: null,
    parentId: null,
    body: 'looks off here',
    status: 'open',
    authorId: 'u-1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

type FetchCall = [string, RequestInit | undefined];

function callOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): FetchCall {
  const entry = fetchImpl.mock.calls[call] as unknown as FetchCall | undefined;
  if (!entry) throw new Error(`no fetch call recorded at index ${call}`);
  return entry;
}

function initOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): RequestInit {
  const init = callOf(fetchImpl, call)[1];
  if (!init) throw new Error(`no request init recorded for call ${call}`);
  return init;
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse(String(initOf(fetchImpl, call).body)) as Record<string, unknown>;
}

describe('createCommentClient — list (CMT2-05, CMT2-08)', () => {
  it('returns {status: "ok", comments} on 200 from GET /diagrams/:id/comments', async () => {
    const row = comment();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { comments: [{ ...row, mentions: [] }] }),
    ) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    const result = await client.list('d-1');
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.comments).toEqual([{ ...row, mentions: [] }]);
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/d-1/comments');
  });

  it('returns {status: "not_found"} on 404 (IDOR convention — never 403)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.list('d-1')).resolves.toEqual({ status: 'not_found' });
  });

  it('returns {status: "error"} on any other non-200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.list('d-1')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.list('d-1')).resolves.toEqual({ status: 'error' });
  });
});

describe('createCommentClient — create (CMT2-13..18, CMT2-25)', () => {
  it('returns {status: "created", comment} on 201 and posts the body', async () => {
    const created = comment({ id: 'c-new' });
    const fetchImpl = vi.fn(async () => jsonResponse(201, { comment: created, mentions: [] }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await expect(client.create('d-1', { body: 'hello' })).resolves.toEqual({
      status: 'created',
      comment: created,
    });
    expect(callOf(fetchImpl)[0]).toBe('/diagrams/d-1/comments');
    expect(initOf(fetchImpl).method).toBe('POST');
    expect(bodyOf(fetchImpl)).toEqual({ body: 'hello' });
  });

  it('sends elementId when an anchor is given (CMT2-13)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { comment: comment(), mentions: [] }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await client.create('d-1', { body: 'hello', elementId: 'el-9' });
    expect(bodyOf(fetchImpl)).toEqual({ body: 'hello', elementId: 'el-9' });
  });

  it('omits elementId entirely when no anchor is given (CMT2-14/15)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { comment: comment(), mentions: [] }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await client.create('d-1', { body: 'hello' });
    expect(Object.hasOwn(bodyOf(fetchImpl), 'elementId')).toBe(false);
  });

  it('sends parentId for a reply and omits it for a root comment (CMT2-25)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { comment: comment(), mentions: [] }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await client.create('d-1', { body: 'reply', parentId: 'c-root' });
    expect(bodyOf(fetchImpl)).toEqual({ body: 'reply', parentId: 'c-root' });

    await client.create('d-1', { body: 'root' });
    expect(Object.hasOwn(bodyOf(fetchImpl, 1), 'parentId')).toBe(false);
  });

  it('returns {status: "not_found"} on 404 (CMT2-17)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.create('d-1', { body: 'hello' })).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns {status: "error"} on any other failure status (CMT2-18)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.create('d-1', { body: 'hello' })).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure (CMT2-18)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.create('d-1', { body: 'hello' })).resolves.toEqual({ status: 'error' });
  });
});

describe('createCommentClient — setStatus (CMT2-21..23)', () => {
  it('returns {status: "ok", comment} on 200 and patches {status} on the given comment', async () => {
    const resolved = comment({ status: 'resolved' });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { comment: resolved }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await expect(client.setStatus('d-1', 'c-1', 'resolved')).resolves.toEqual({
      status: 'ok',
      comment: resolved,
    });
    expect(callOf(fetchImpl)[0]).toBe('/diagrams/d-1/comments/c-1');
    expect(initOf(fetchImpl).method).toBe('PATCH');
    expect(bodyOf(fetchImpl)).toEqual({ status: 'resolved' });
  });

  it('sends {status: "open"} when reopening (CMT2-22)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { comment: comment() }));
    const client = createCommentClient(fetchImpl as unknown as typeof fetch);

    await client.setStatus('d-1', 'c-1', 'open');
    expect(bodyOf(fetchImpl)).toEqual({ status: 'open' });
  });

  it('returns {status: "forbidden"} on 403 (CMT2-23)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.setStatus('d-1', 'c-1', 'resolved')).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('returns {status: "error"} on any other non-200 (CMT2-23)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.setStatus('d-1', 'c-1', 'resolved')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure (CMT2-23)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createCommentClient(fetchImpl);

    await expect(client.setStatus('d-1', 'c-1', 'resolved')).resolves.toEqual({ status: 'error' });
  });
});
