import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initializes the shared i18next singleton. Default language is pt-BR, so the
// assertions below query pt-BR strings.
import '../i18n/index.js';
import { ShareLinkPanel } from './ShareLinkPanel.js';

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FUTURE_LOCAL = '2030-01-01T10:00';
const PAST_LOCAL = '2020-01-01T10:00';

const CREATED_LINK = {
  id: 'sl-1',
  resourceType: 'diagram',
  resourceId: 'd-1',
  role: 'viewer',
  expiresAt: '2030-01-01T10:00:00.000Z',
  revokedAt: null,
  createdBy: 'u-1',
  createdAt: '2026-08-17T00:00:00.000Z',
};

function renderPanel(fetchImpl: typeof fetch, canMutate = true) {
  return render(<ShareLinkPanel diagramId="d-1" canMutate={canMutate} fetchImpl={fetchImpl} />);
}

function fillForm(role = 'viewer', expiresAt = FUTURE_LOCAL) {
  fireEvent.change(screen.getByLabelText('Papel concedido pelo link'), {
    target: { value: role },
  });
  fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: expiresAt } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Criar link' }));
}

/** Creates one link and waits for its URL field to appear, so revoke tests start from a real created link. */
async function createOneLink(fetchImpl: typeof fetch) {
  renderPanel(fetchImpl);
  fillForm();
  submit();
  await screen.findByDisplayValue('http://localhost:3000/share/plain-token-abc');
}

describe('ShareLinkPanel — creating a link (T8, SHR-02..07)', () => {
  it('does not emit a request when the role is missing', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: FUTURE_LOCAL } });
    submit();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not emit a request when the expiry is missing', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fireEvent.change(screen.getByLabelText('Papel concedido pelo link'), {
      target: { value: 'viewer' },
    });
    submit();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks an expiry in the past with its own message and emits no request (SHR-03)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm('viewer', PAST_LOCAL);
    submit();

    await waitFor(() =>
      expect(screen.getByTestId('share-announcement').textContent).toBe(
        'Escolha uma data de expiração no futuro.',
      ),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs {role, expiresAt} to /diagrams/:id/share-links (SHR-04)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, {
        shareLink: { ...CREATED_LINK, role: 'editor' },
        token: 'plain-token-abc',
      }),
    ) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    // A non-default role: 'editor' is neither the <select>'s first option nor fillForm()'s own
    // default ('viewer'), so a body built from a hardcoded/default role would fail this
    // assertion instead of passing it by coincidence.
    fillForm('editor');
    submit();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/diagrams/d-1/share-links');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      role: 'editor',
      expiresAt: new Date(FUTURE_LOCAL).toISOString(),
    });
  });

  it('shows the full share URL and the one-shot warning on 201 (SHR-05)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' }),
    ) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();

    expect(
      await screen.findByDisplayValue(`${window.location.origin}/share/plain-token-abc`),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Copie esta URL agora. Ela é exibida uma única vez e não pode ser recuperada.',
      ),
    ).toBeTruthy();
  });

  it('shows the role-ceiling message on 403 and adds nothing to the list (SHR-06)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm('org_admin');
    submit();

    await waitFor(() =>
      expect(screen.getByTestId('share-announcement').textContent).toBe(
        'Você não pode conceder um papel acima do seu.',
      ),
    );
    expect(screen.queryAllByRole('listitem')).toEqual([]);
    // The picked role reaches the request even on a rejected attempt — the 403 is the server's
    // ceiling check on the value actually sent, not a client-side substitution.
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).role).toBe('org_admin');
  });

  it('shows a generic failure on any other error status and adds nothing to the list (SHR-07)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();

    await waitFor(() =>
      expect(screen.getByTestId('share-announcement').textContent).toBe(
        'Algo deu errado. Tente de novo.',
      ),
    );
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  it('a second submit while a creation is in flight emits no second request', async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        }),
    ) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    submit();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveCreate?.(jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' }));
  });
});

describe('ShareLinkPanel — the created-link list (T8, SHR-08)', () => {
  it('states that the list only holds links created on this screen', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl);

    expect(
      screen.getByText(
        'Só aparecem aqui os links que você criou nesta tela. Recarregar a página limpa a lista, e a URL não pode ser recuperada depois.',
      ),
    ).toBeTruthy();
  });
});

describe('ShareLinkPanel — revoking a link (T8, SHR-09..11)', () => {
  it('POSTs to /share-links/:id:revoke and hides the URL once revoked (SHR-09, SHR-10)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/diagrams/d-1/share-links')
        return jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' });
      if (url === '/share-links/sl-1:revoke')
        return jsonResponse(200, {
          shareLink: { ...CREATED_LINK, revokedAt: '2026-08-17T01:00:00.000Z' },
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPanel(fetchImpl);
    fillForm();
    submit();
    const urlField = await screen.findByLabelText('URL de compartilhamento');

    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(screen.queryByLabelText('URL de compartilhamento')).toBeNull());
    expect(urlField.isConnected).toBe(false);
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Revogado')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/share-links/sl-1:revoke', { method: 'POST' });
  });

  it('keeps the link active, URL included, when revoke fails with 403 (SHR-11)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/diagrams/d-1/share-links')
        return jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' });
      if (url === '/share-links/sl-1:revoke') return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await createOneLink(fetchImpl);

    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    await waitFor(() =>
      expect(screen.getByTestId('share-announcement').textContent).toBe(
        'Algo deu errado. Tente de novo.',
      ),
    );
    expect(screen.getByLabelText('URL de compartilhamento')).toBeTruthy();
    expect(screen.queryByText('Revogado')).toBeNull();
  });
});

describe('ShareLinkPanel — announcements (T8, SHR-30)', () => {
  it('announces the created and the revoked outcome in the polite live region', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/diagrams/d-1/share-links')
        return jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' });
      if (url === '/share-links/sl-1:revoke')
        return jsonResponse(200, {
          shareLink: { ...CREATED_LINK, revokedAt: '2026-08-17T01:00:00.000Z' },
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await createOneLink(fetchImpl);

    const liveRegion = screen.getByTestId('share-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');
    expect(liveRegion.textContent).toBe('Link de compartilhamento criado.');

    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(liveRegion.textContent).toBe('Link de compartilhamento revogado.'));
  });
});
