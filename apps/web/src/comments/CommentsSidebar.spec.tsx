import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton. Default language is pt-BR,
// so the assertions below query the pt-BR strings.
import '../i18n/index.js';
import { CommentsSidebar } from './CommentsSidebar.js';
import type { Comment } from './commentClient.js';

afterEach(() => {
  cleanup();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

type FetchCall = [string, RequestInit | undefined];

function callsTo(fetchImpl: ReturnType<typeof vi.fn>, method?: string): FetchCall[] {
  return (fetchImpl.mock.calls as unknown as FetchCall[]).filter(([, init]) =>
    method === undefined ? init === undefined : init?.method === method,
  );
}

function postBody(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const entry = callsTo(fetchImpl, 'POST')[call];
  if (!entry) throw new Error(`no POST recorded at index ${call}`);
  return JSON.parse(String(entry[1]?.body)) as Record<string, unknown>;
}

function listFetch(comments: Comment[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderSidebar(
  fetchImpl: ReturnType<typeof vi.fn>,
  props: { selection?: readonly string[]; liveElementIds?: readonly string[] } = {},
) {
  return render(
    <CommentsSidebar
      diagramId="d-1"
      selection={props.selection ?? []}
      liveElementIds={props.liveElementIds ?? []}
      fetchImpl={fetchImpl as unknown as typeof fetch}
    />,
  );
}

describe('CommentsSidebar — loading the list (CMT2-05..08)', () => {
  it('emits GET /diagrams/:id/comments exactly once on mount and renders the threads (CMT2-05, CMT2-06)', async () => {
    const fetchImpl = listFetch([comment('c-1'), comment('c-2', { parentId: 'c-1' })]);
    renderSidebar(fetchImpl);

    expect(await screen.findByText('body of c-1')).toBeTruthy();
    expect(screen.getByText('body of c-2')).toBeTruthy();
    expect(callsTo(fetchImpl)).toHaveLength(1);
    expect(callsTo(fetchImpl)[0]?.[0]).toBe('/diagrams/d-1/comments');
    // The reply is nested inside its root's thread, not listed as a second thread.
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
  });

  it('shows the loading message while the initial GET is in flight (CMT2-07)', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await pending;
      return jsonResponse(200, { comments: [] });
    });

    renderSidebar(fetchImpl);
    expect(screen.getByText('Carregando comentários…')).toBeTruthy();

    release?.();
    await waitFor(() => expect(screen.queryByText('Carregando comentários…')).toBeNull());
  });

  it('shows the empty state when the diagram has no comments', async () => {
    const fetchImpl = listFetch([]);
    renderSidebar(fetchImpl);

    expect(await screen.findByText('Nenhum comentário neste diagrama ainda.')).toBeTruthy();
  });

  it('shows the generic error and keeps the list empty when the GET is not 200 (CMT2-08)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    renderSidebar(fetchImpl);

    expect(await screen.findByText('Algo deu errado. Tente de novo.')).toBeTruthy();
    expect(screen.queryAllByTestId('comment-thread')).toHaveLength(0);
  });
});

describe('CommentsSidebar — anchors (CMT2-09, CMT2-10)', () => {
  it('labels a thread anchored to an element still in the loaded scene (CMT2-09)', async () => {
    const fetchImpl = listFetch([comment('c-1', { elementId: 'el-1' })]);
    renderSidebar(fetchImpl, { liveElementIds: ['el-1'] });

    expect(await screen.findByText('Ancorado em el-1')).toBeTruthy();
  });

  it('keeps a thread whose anchor no longer exists, marking it as removed (CMT2-10)', async () => {
    const fetchImpl = listFetch([comment('c-1', { elementId: 'el-gone' })]);
    renderSidebar(fetchImpl, { liveElementIds: ['el-1'] });

    expect(await screen.findByText('Âncora removida (el-gone)')).toBeTruthy();
    expect(screen.getByText('body of c-1')).toBeTruthy();
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
  });

  it('shows no anchor label for a general comment', async () => {
    const fetchImpl = listFetch([comment('c-1')]);
    renderSidebar(fetchImpl, { liveElementIds: ['el-1'] });

    expect(await screen.findByText('body of c-1')).toBeTruthy();
    expect(screen.queryByTestId('thread-anchor')).toBeNull();
  });
});

describe('CommentsSidebar — composing a comment (CMT2-11..19)', () => {
  it('renders the composer with no permission input of any kind (CMT2-11)', async () => {
    const fetchImpl = listFetch([]);
    renderSidebar(fetchImpl);

    expect(await screen.findByLabelText('Novo comentário')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('keeps the submit control disabled while the body is empty or whitespace-only (CMT2-12)', async () => {
    const fetchImpl = listFetch([]);
    renderSidebar(fetchImpl);

    const submit = (await screen.findByRole('button', {
      name: 'Comentar',
    })) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'algo' } });
    expect(submit.disabled).toBe(false);
  });

  it('posts elementId when exactly one element is selected (CMT2-13)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(201, { comment: comment('c-new'), mentions: [] });
    });
    renderSidebar(fetchImpl, { selection: ['el-7'] });

    expect(await screen.findByText('Será ancorado em el-7')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'olha aqui' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
    expect(postBody(fetchImpl)).toEqual({ body: 'olha aqui', elementId: 'el-7' });
  });

  it('posts without elementId when nothing is selected (CMT2-14)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(201, { comment: comment('c-new'), mentions: [] });
    });
    renderSidebar(fetchImpl, { selection: [] });

    expect(await screen.findByText('Sem âncora — comentário geral do diagrama')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'geral' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
    expect(Object.hasOwn(postBody(fetchImpl), 'elementId')).toBe(false);
  });

  it('warns and posts without elementId when several elements are selected (CMT2-15)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(201, { comment: comment('c-new'), mentions: [] });
    });
    renderSidebar(fetchImpl, { selection: ['el-1', 'el-2'] });

    expect(
      await screen.findByText('Vários elementos selecionados — o comentário não será ancorado'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'multi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
    expect(Object.hasOwn(postBody(fetchImpl), 'elementId')).toBe(false);
  });

  it('appends the created comment, clears the field and issues no second GET on 201 (CMT2-16)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(201, {
        comment: comment('c-new', { body: 'comentário novo' }),
        mentions: [],
      });
    });
    renderSidebar(fetchImpl);

    await screen.findByLabelText('Novo comentário');
    const field = screen.getByLabelText('Novo comentário') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'comentário novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('comentário novo')).toBeTruthy();
    expect(field.value).toBe('');
    expect(callsTo(fetchImpl)).toHaveLength(1);
    expect(screen.getByTestId('comments-announcement').textContent).toBe('Comentário publicado.');
  });

  it('reports "does not exist or no access" and adds nothing on a 404 (CMT2-17)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(404, {});
    });
    renderSidebar(fetchImpl);

    await screen.findByLabelText('Novo comentário');
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() =>
      expect(screen.getByTestId('comments-announcement').textContent).toBe(
        'Este diagrama não existe ou você não tem acesso a ele.',
      ),
    );
    expect(screen.queryAllByTestId('comment-thread')).toHaveLength(0);
  });

  it('reports the generic error and adds nothing on any other failure (CMT2-18)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      return jsonResponse(400, {});
    });
    renderSidebar(fetchImpl);

    await screen.findByLabelText('Novo comentário');
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() =>
      expect(screen.getByTestId('comments-announcement').textContent).toBe(
        'Algo deu errado. Tente de novo.',
      ),
    );
    expect(screen.queryAllByTestId('comment-thread')).toHaveLength(0);
  });

  it('does not emit a second POST while the first is still in flight (CMT2-19)', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) return jsonResponse(200, { comments: [] });
      await pending;
      return jsonResponse(201, { comment: comment('c-new'), mentions: [] });
    });
    renderSidebar(fetchImpl);

    await screen.findByLabelText('Novo comentário');
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'oi' } });
    const form = screen.getByTestId('comment-composer');
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
    release?.();
    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
  });

  it('keeps the typed text when the canvas selection changes (edge case)', async () => {
    const fetchImpl = listFetch([]);
    const { rerender } = render(
      <CommentsSidebar
        diagramId="d-1"
        selection={[]}
        liveElementIds={[]}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    await screen.findByLabelText('Novo comentário');
    fireEvent.change(screen.getByLabelText('Novo comentário'), { target: { value: 'rascunho' } });

    rerender(
      <CommentsSidebar
        diagramId="d-1"
        selection={['el-3']}
        liveElementIds={[]}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    expect((screen.getByLabelText('Novo comentário') as HTMLTextAreaElement).value).toBe(
      'rascunho',
    );
    expect(screen.getByText('Será ancorado em el-3')).toBeTruthy();
  });
});

describe('CommentsSidebar — resolving and reopening (CMT2-20..23)', () => {
  it('offers resolve on every open thread (CMT2-20)', async () => {
    const fetchImpl = listFetch([comment('c-1'), comment('c-2')]);
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    expect(screen.getAllByRole('button', { name: 'Resolver' })).toHaveLength(2);
  });

  it('patches the ROOT id with {status: "resolved"} and only reflects it after the 200 (CMT2-21)', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        return jsonResponse(200, {
          comments: [comment('c-1'), comment('c-2', { parentId: 'c-1' })],
        });
      }
      await pending;
      return jsonResponse(200, { comment: comment('c-1', { status: 'resolved' }) });
    });
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar resolvidas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'PATCH')).toHaveLength(1));
    expect(callsTo(fetchImpl, 'PATCH')[0]?.[0]).toBe('/diagrams/d-1/comments/c-1');
    expect(JSON.parse(String(callsTo(fetchImpl, 'PATCH')[0]?.[1]?.body))).toEqual({
      status: 'resolved',
    });
    // Still open on screen: the response has not resolved yet.
    expect(screen.queryByText('Resolvido')).toBeNull();

    release?.();
    expect(await screen.findByText('Resolvido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeTruthy();
  });

  it('offers reopen on a resolved thread and patches {status: "open"} (CMT2-22)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        return jsonResponse(200, { comments: [comment('c-1', { status: 'resolved' })] });
      }
      return jsonResponse(200, { comment: comment('c-1', { status: 'open' }) });
    });
    renderSidebar(fetchImpl);

    await screen.findByRole('checkbox', { name: 'Mostrar resolvidas' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar resolvidas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'PATCH')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(fetchImpl, 'PATCH')[0]?.[1]?.body))).toEqual({
      status: 'open',
    });
    expect(await screen.findByRole('button', { name: 'Resolver' })).toBeTruthy();
  });

  it('keeps the previous status and announces the failure when the PATCH is not 200 (CMT2-23)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        return jsonResponse(200, { comments: [comment('c-1')] });
      }
      return jsonResponse(403, {});
    });
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));

    await waitFor(() =>
      expect(screen.getByTestId('comments-announcement').textContent).toBe(
        'A ação falhou. Tente de novo.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy();
    expect(screen.queryByText('Resolvido')).toBeNull();
  });
});

describe('CommentsSidebar — replying (CMT2-24..26)', () => {
  it('offers reply on every displayed thread (CMT2-24)', async () => {
    const fetchImpl = listFetch([comment('c-1'), comment('c-2')]);
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    expect(screen.getAllByRole('button', { name: 'Responder' })).toHaveLength(2);
  });

  it('posts parentId = the thread ROOT id even when the thread already has replies (CMT2-25)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        return jsonResponse(200, {
          comments: [comment('c-1'), comment('c-2', { parentId: 'c-1' })],
        });
      }
      return jsonResponse(201, {
        comment: comment('c-3', { parentId: 'c-1', body: 'minha resposta' }),
        mentions: [],
      });
    });
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    fireEvent.change(screen.getByLabelText('Sua resposta'), {
      target: { value: 'minha resposta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() => expect(callsTo(fetchImpl, 'POST')).toHaveLength(1));
    expect(postBody(fetchImpl)).toEqual({ body: 'minha resposta', parentId: 'c-1' });
  });

  it('shows the created reply inside its own thread, after the comments already there (CMT2-26)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        return jsonResponse(200, {
          comments: [comment('c-1'), comment('c-2', { parentId: 'c-1' })],
        });
      }
      return jsonResponse(201, {
        comment: comment('c-3', { parentId: 'c-1', body: 'minha resposta' }),
        mentions: [],
      });
    });
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    fireEvent.change(screen.getByLabelText('Sua resposta'), {
      target: { value: 'minha resposta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await screen.findByText('minha resposta');
    const thread = screen.getByTestId('comment-thread');
    const replies = within(thread)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(replies).toEqual(['body of c-2', 'minha resposta']);
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
  });
});

describe('CommentsSidebar — filtering and refreshing (CMT2-27..29)', () => {
  it('hides threads whose root is resolved by default (CMT2-27)', async () => {
    const fetchImpl = listFetch([comment('c-1'), comment('c-2', { status: 'resolved' })]);
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    expect(screen.queryByText('body of c-2')).toBeNull();
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
  });

  it('shows every thread once "show resolved" is on (CMT2-28)', async () => {
    const fetchImpl = listFetch([comment('c-1'), comment('c-2', { status: 'resolved' })]);
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar resolvidas' }));

    expect(screen.getByText('body of c-2')).toBeTruthy();
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(2);
  });

  it('re-emits the GET and replaces the list on refresh (CMT2-29)', async () => {
    let listCalls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/diagrams/d-1/comments' && !init) {
        listCalls += 1;
        return jsonResponse(200, {
          comments: listCalls === 1 ? [comment('c-1')] : [comment('c-9')],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderSidebar(fetchImpl);

    await screen.findByText('body of c-1');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));

    expect(await screen.findByText('body of c-9')).toBeTruthy();
    expect(screen.queryByText('body of c-1')).toBeNull();
    expect(callsTo(fetchImpl)).toHaveLength(2);
  });
});
