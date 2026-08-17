/** Mirrors the server's `CommentRow` (`apps/server/src/modules/comment/comments.ts`) — never invents new fields. `createdAt`/`updatedAt` arrive as ISO strings over JSON. */
export interface Comment {
  id: string;
  diagramId: string;
  elementId: string | null;
  frameId: string | null;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export type CommentStatus = 'open' | 'resolved';

export interface CreateCommentInput {
  body: string;
  /** Anchor element id — omitted from the request body entirely when absent (spec.md, CMT2-14/15). */
  elementId?: string;
  /** Always the id of the thread ROOT (spec.md's Assumptions table), never a reply's id. */
  parentId?: string;
}

export type ListCommentsResult =
  | { status: 'ok'; comments: Comment[] }
  | { status: 'not_found' }
  | { status: 'error' };

export type CreateCommentResult =
  | { status: 'created'; comment: Comment }
  | { status: 'not_found' }
  | { status: 'error' };

export type SetCommentStatusResult =
  | { status: 'ok'; comment: Comment }
  | { status: 'forbidden' }
  | { status: 'error' };

export interface CommentClient {
  list(diagramId: string): Promise<ListCommentsResult>;
  create(diagramId: string, input: CreateCommentInput): Promise<CreateCommentResult>;
  setStatus(
    diagramId: string,
    commentId: string,
    status: CommentStatus,
  ): Promise<SetCommentStatusResult>;
}

/**
 * Dedicated comment HTTP client (spec.md's Assumptions table) — deliberately NOT the generic
 * `resourceClient`: comments have no rename and no archive/delete at all, and the responses are
 * `{comments:[...]}` / `{comment, mentions}` rather than the generic's wrapped-single-key shape.
 * Same `fetchImpl`-injection style and one-union-per-method contract as `nav/memberClient.ts`.
 *
 * Every call site below writes `fetchImpl(` literally, matching `memberClient.ts`, so
 * `tools/repo-tools/src/webConsumers.ts` (which only recognizes literal `fetch(`/`fetchImpl(`
 * call sites) classifies the three comment routes as `consumed` instead of `pending-product`.
 *
 * `GET` also returns a resolved `mentions` array per row; this wave renders the body verbatim and
 * deliberately ignores it (spec.md, Out of Scope), so it is not part of `Comment`.
 */
export function createCommentClient(fetchImplOption?: typeof fetch): CommentClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(diagramId: string): Promise<ListCommentsResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/diagrams/${diagramId}/comments`);
    } catch {
      return { status: 'error' };
    }

    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as { comments: Comment[] };
    return { status: 'ok', comments: body.comments };
  }

  async function create(
    diagramId: string,
    input: CreateCommentInput,
  ): Promise<CreateCommentResult> {
    const requestBody: Record<string, string> = { body: input.body };
    if (input.elementId !== undefined) requestBody.elementId = input.elementId;
    if (input.parentId !== undefined) requestBody.parentId = input.parentId;

    let response: Response;
    try {
      response = await fetchImpl(`/diagrams/${diagramId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as { comment: Comment };
    return { status: 'created', comment: body.comment };
  }

  async function setStatus(
    diagramId: string,
    commentId: string,
    status: CommentStatus,
  ): Promise<SetCommentStatusResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/diagrams/${diagramId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as { comment: Comment };
    return { status: 'ok', comment: body.comment };
  }

  return { list, create, setStatus };
}
