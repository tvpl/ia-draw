import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// WorkspaceMembersPage.spec.tsx. Default language is pt-BR.
import '../i18n/index.js';
import { WorkspaceWebhooksPage } from './WorkspaceWebhooksPage.js';
import type { WebhookEndpoint } from './webhookClient.js';

beforeAll(() => {
  // Same jsdom <dialog> shim as WorkspaceMembersPage.spec.tsx / ConfirmArchiveDialog.spec.tsx.
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const hookA: WebhookEndpoint = {
  id: 'wh-1',
  workspaceId: 'ws-1',
  url: 'https://a.example.com/hook',
  events: ['diagram.created'],
  enabled: true,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const hookB: WebhookEndpoint = {
  ...hookA,
  id: 'wh-2',
  url: 'https://b.example.com/hook',
  events: ['spec.generated', 'comment.mentioned'],
  enabled: false,
};

function renderPage(fetchImpl: typeof fetch, workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/w/${workspaceId}/webhooks`]}>
      <Routes>
        <Route
          path="/w/:workspaceId/webhooks"
          element={<WorkspaceWebhooksPage fetchImpl={fetchImpl} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** A `fetchImpl` that answers the list fetch and delegates everything else to `handler`. */
function fetchWith(
  items: WebhookEndpoint[],
  handler?: (url: string, init?: RequestInit) => Response,
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/workspaces/ws-1/webhooks' && !init) return jsonResponse(200, { items });
    if (handler) return handler(url, init);
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
  }) as unknown as typeof fetch;
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`webhook-url-${id}`).closest('li') as HTMLElement;
}

function createForm(): HTMLElement {
  // The create form is the last <form> on the page (the per-row edit form, when open, comes first).
  const forms = document.querySelectorAll('form');
  return forms[forms.length - 1] as HTMLElement;
}

async function fillCreateForm(url: string, eventLabels: string[]): Promise<HTMLElement> {
  const form = createForm();
  fireEvent.change(within(form).getByLabelText('URL do endpoint'), { target: { value: url } });
  for (const label of eventLabels) {
    fireEvent.click(within(form).getByLabelText(label));
  }
  return form;
}

describe('WorkspaceWebhooksPage — list (WHK-01, WHK-03, WHK-04)', () => {
  it('lists each webhook with its URL, subscribed events and enabled state (WHK-01)', async () => {
    renderPage(fetchWith([hookA, hookB]));

    await screen.findByTestId('webhook-url-wh-1');
    expect(screen.getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook');
    expect(screen.getByTestId('webhook-events-wh-1').textContent).toBe('Diagrama criado');
    expect(screen.getByTestId('webhook-enabled-wh-1').textContent).toBe('Ativo');

    expect(screen.getByTestId('webhook-url-wh-2').textContent).toBe('https://b.example.com/hook');
    expect(screen.getByTestId('webhook-events-wh-2').textContent).toBe(
      'Spec gerada, Mencionado em um comentário',
    );
    expect(screen.getByTestId('webhook-enabled-wh-2').textContent).toBe('Inativo');
  });

  it('renders the shared no-access message on 403 (WHK-03)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
  });

  it('renders the same no-access message on 404, never distinguishing it from 403 (WHK-03)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
  });

  it('renders an explicit empty state when there are no webhooks (WHK-04)', async () => {
    renderPage(fetchWith([]));

    expect(await screen.findByText('Este workspace ainda não tem webhooks.')).toBeTruthy();
  });
});

describe('WorkspaceWebhooksPage — create (WHK-05..10)', () => {
  it('offers exactly the 5 server event types as checkboxes (WHK-05)', async () => {
    renderPage(fetchWith([]));
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = createForm();
    const checkboxes = within(form).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);
    for (const label of [
      'Diagrama criado',
      'Diagrama atualizado',
      'Diagrama publicado',
      'Spec gerada',
      'Mencionado em um comentário',
    ]) {
      expect(within(form).getByLabelText(label)).toBeTruthy();
    }
  });

  it('blocks the submit with no POST emitted when the URL is blank (WHK-06)', async () => {
    const fetchImpl = fetchWith([]);
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = await fillCreateForm('   ', ['Diagrama criado']);
    fireEvent.submit(form);

    // Scoped to the form: the same message also lands in the aria-live region (WHK-32).
    await waitFor(() =>
      expect(within(form).getByText('A URL do endpoint é obrigatória.')).toBeTruthy(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });

  it('blocks the submit with no POST emitted when no event is checked (WHK-07)', async () => {
    const fetchImpl = fetchWith([]);
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = await fillCreateForm('https://c.example.com/hook', []);
    fireEvent.submit(form);

    // Scoped to the form: the same message also lands in the aria-live region (WHK-32).
    await waitFor(() => expect(within(form).getByText('Escolha ao menos um evento.')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });

  it('POSTs {url, events} and, on 201, appends the webhook and clears the form (WHK-08, WHK-09)', async () => {
    const created: WebhookEndpoint = {
      ...hookA,
      id: 'wh-9',
      url: 'https://c.example.com/hook',
      events: ['diagram.updated'],
    };
    const fetchImpl = fetchWith([], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks' && init?.method === 'POST')
        return jsonResponse(201, { webhookEndpoint: created, secret: 'whsec_new' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = await fillCreateForm('https://c.example.com/hook', ['Diagrama atualizado']);
    fireEvent.submit(form);

    expect(await screen.findByTestId('webhook-url-wh-9')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://c.example.com/hook', events: ['diagram.updated'] }),
    });

    const cleared = createForm();
    expect((within(cleared).getByLabelText('URL do endpoint') as HTMLInputElement).value).toBe('');
    expect(
      (within(cleared).getByLabelText('Diagrama atualizado') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('announces the failure and appends nothing when POST answers 400 (WHK-10)', async () => {
    const fetchImpl = fetchWith([], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks' && init?.method === 'POST')
        return jsonResponse(400, {});
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = await fillCreateForm('https://c.example.com/hook', ['Diagrama criado']);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByTestId('webhooks-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.queryAllByTestId(/^webhook-url-/)).toHaveLength(0);
    expect(screen.getByText('Este workspace ainda não tem webhooks.')).toBeTruthy();
  });
});

describe('WorkspaceWebhooksPage — one-time secret reveal wiring (WHK-25, edge case 2)', () => {
  it('shows the created secret in the reveal panel after 201', async () => {
    const fetchImpl = fetchWith([], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks' && init?.method === 'POST')
        return jsonResponse(201, { webhookEndpoint: { ...hookA, id: 'wh-9' }, secret: 'whsec_A' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    fireEvent.submit(await fillCreateForm('https://c.example.com/hook', ['Diagrama criado']));

    await waitFor(() =>
      expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(
        'whsec_A',
      ),
    );
  });

  it('replaces the shown secret on a later rotation instead of stacking two panels (edge case 2)', async () => {
    const fetchImpl = fetchWith([], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks' && init?.method === 'POST')
        return jsonResponse(201, { webhookEndpoint: { ...hookA, id: 'wh-9' }, secret: 'whsec_A' });
      if (url === '/workspaces/ws-1/webhooks/wh-9:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: { ...hookA, id: 'wh-9' }, secret: 'whsec_B' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    fireEvent.submit(await fillCreateForm('https://c.example.com/hook', ['Diagrama criado']));
    await screen.findByTestId('webhook-url-wh-9');

    fireEvent.click(within(row('wh-9')).getByRole('button', { name: 'Rotacionar segredo' }));
    fireEvent.click(within(row('wh-9')).getByRole('button', { name: 'Rotacionar agora' }));

    await waitFor(() =>
      expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(
        'whsec_B',
      ),
    );
    expect(screen.getAllByTestId('webhook-secret-panel')).toHaveLength(1);
  });

  it('emits only one POST when the create form is submitted twice in a row (edge case 1)', async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1/webhooks' && !init) return jsonResponse(200, { items: [] });
      if (url === '/workspaces/ws-1/webhooks' && init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem webhooks.');

    const form = await fillCreateForm('https://c.example.com/hook', ['Diagrama criado']);
    fireEvent.submit(form);
    fireEvent.submit(form);

    const postCalls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(1);

    resolveCreate?.(
      jsonResponse(201, { webhookEndpoint: { ...hookA, id: 'wh-9' }, secret: 'whsec_A' }),
    );
    await screen.findByTestId('webhook-url-wh-9');
  });
});

describe('WorkspaceWebhooksPage — edit (WHK-18..22, edge case 4)', () => {
  it('PATCHes the current url/events/enabled and reflects them only after 200 (WHK-18, WHK-20)', async () => {
    const updated = { ...hookA, url: 'https://renamed.example.com/hook' };
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: updated });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Editar' }));
    const form = document.querySelector('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('URL do endpoint'), {
      target: { value: 'https://renamed.example.com/hook' },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByTestId('webhook-url-wh-1').textContent).toBe(
        'https://renamed.example.com/hook',
      ),
    );
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://renamed.example.com/hook',
        events: ['diagram.created'],
        enabled: true,
      }),
    });
  });

  it('emits no request when the save changes nothing (WHK-19)', async () => {
    const fetchImpl = fetchWith([hookA]);
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Editar' }));
    fireEvent.submit(document.querySelector('form') as HTMLElement);

    await waitFor(() => expect(screen.getByTestId('webhook-url-wh-1')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });

  it('keeps the previous values in the list when PATCH answers 403 (WHK-21)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'PATCH')
        return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Editar' }));
    const form = document.querySelector('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('URL do endpoint'), {
      target: { value: 'https://renamed.example.com/hook' },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByTestId('webhooks-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook');
  });

  it('blocks the save with no PATCH emitted when the last event is unchecked (edge case 4)', async () => {
    const fetchImpl = fetchWith([hookA]);
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Editar' }));
    const form = document.querySelector('form') as HTMLElement;
    fireEvent.click(within(form).getByLabelText('Diagrama criado'));
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText('Escolha ao menos um evento.')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });

  it('toggles enabled through PATCH {enabled} and flips only after 200 (WHK-22)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: { ...hookA, enabled: false } });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');
    expect(screen.getByTestId('webhook-enabled-wh-1').textContent).toBe('Ativo');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Desativar' }));

    await waitFor(() =>
      expect(screen.getByTestId('webhook-enabled-wh-1').textContent).toBe('Inativo'),
    );
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
  });
});

describe('WorkspaceWebhooksPage — rotate (WHK-23, WHK-24, WHK-26, WHK-27)', () => {
  it('emits no request until the rotation is explicitly confirmed, and warns about the immediate invalidation (WHK-23)', async () => {
    const fetchImpl = fetchWith([hookA]);
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar segredo' }));

    expect(
      within(row('wh-1')).getByText(
        'O segredo atual para de valer imediatamente, sem período de carência.',
      ),
    ).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });

  it('PATCHes the :rotate-secret sub-resource once confirmed (WHK-24)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: hookA, secret: 'whsec_R' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar segredo' }));
    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar agora' }));

    await waitFor(() =>
      expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(
        'whsec_R',
      ),
    );
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1:rotate-secret', {
      method: 'PATCH',
    });
  });

  it('announces the failure and opens no reveal panel when rotation answers 403 (WHK-26)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar segredo' }));
    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar agora' }));

    await waitFor(() =>
      expect(screen.getByTestId('webhooks-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.queryByTestId('webhook-secret-panel')).toBeNull();
  });

  it('emits nothing and restores the row when the rotation is cancelled (WHK-27)', async () => {
    const fetchImpl = fetchWith([hookA]);
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Rotacionar segredo' }));
    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Cancelar' }));

    expect(within(row('wh-1')).getByRole('button', { name: 'Rotacionar segredo' })).toBeTruthy();
    expect(
      within(row('wh-1')).queryByText(
        'O segredo atual para de valer imediatamente, sem período de carência.',
      ),
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the list fetch only
  });
});

describe('WorkspaceWebhooksPage — remove (WHK-28..30)', () => {
  it('confirms through ConfirmArchiveDialog naming the webhook URL, then DELETEs and drops the row on 204 (WHK-28, WHK-29)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Remover' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe(
      'https://a.example.com/hook',
    );

    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByTestId('webhook-url-wh-1')).toBeNull());
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {
      method: 'DELETE',
    });
  });

  it('keeps the row and announces the failure when DELETE answers 403 (WHK-30)', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'DELETE')
        return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Remover' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('webhooks-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook');
  });
});

describe('WorkspaceWebhooksPage — outcome announcements (WHK-32)', () => {
  it('announces each successful outcome in the aria-live region', async () => {
    const fetchImpl = fetchWith([hookA], (url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    const live = screen.getByTestId('webhooks-announcement');
    expect(live.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(within(row('wh-1')).getByRole('button', { name: 'Remover' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(live.textContent).toBe('Webhook removido.'));
  });
});
