import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton (default pt-BR),
// same convention as WorkspaceMembersPage.spec.tsx.
import '../i18n/index.js';
import { AiProviderAdminPage } from './AiProviderAdminPage.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function providerConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    scope: 'global',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    capabilitiesJson: {},
    enabled: true,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

/** Mounts the page at the global route (`/admin/ai-providers`). */
function renderGlobal(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/admin/ai-providers']}>
      <Routes>
        <Route path="/admin/ai-providers" element={<AiProviderAdminPage fetchImpl={fetchImpl} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Mounts the page at the workspace-scoped route. */
function renderWorkspace(fetchImpl: typeof fetch, workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/w/${workspaceId}/admin/ai-providers`]}>
      <Routes>
        <Route
          path="/w/:workspaceId/admin/ai-providers"
          element={<AiProviderAdminPage fetchImpl={fetchImpl} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AiProviderAdminPage — listing (PROV-01..04)', () => {
  it('requests scope=global on the global route and lists endpoint, model and active state (PROV-01)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [providerConfig()] }),
    ) as unknown as typeof fetch;

    renderGlobal(fetchImpl);

    expect(await screen.findByText('https://api.openai.com/v1')).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy();
    expect(screen.getByTestId('ai-provider-state-cfg-1').textContent).toBe('Ativo');
    expect(fetchImpl).toHaveBeenCalledWith('/admin/ai-providers?scope=global');
  });

  it('renders a disabled config as inactive (PROV-01)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [providerConfig({ enabled: false })] }),
    ) as unknown as typeof fetch;

    renderGlobal(fetchImpl);

    expect(await screen.findByTestId('ai-provider-state-cfg-1')).toHaveProperty(
      'textContent',
      'Inativo',
    );
  });

  it('requests scope=<workspaceId> on the workspace route (PROV-02)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [providerConfig({ scope: 'ws-1', id: 'cfg-ws' })] }),
    ) as unknown as typeof fetch;

    renderWorkspace(fetchImpl);

    expect(await screen.findByText('https://api.openai.com/v1')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/admin/ai-providers?scope=ws-1');
  });

  it('never renders a key, even if the response carries an unexpected token field (PROV-03)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [providerConfig({ encryptedToken: 'ciphertext-leak', token: 'sk-plaintext-leak' })],
      }),
    ) as unknown as typeof fetch;

    const { container } = renderGlobal(fetchImpl);
    await screen.findByText('https://api.openai.com/v1');

    expect(container.textContent).not.toContain('ciphertext-leak');
    expect(container.textContent).not.toContain('sk-plaintext-leak');
  });

  it('treats a 403 as "does not exist or no access", with no list rendered (PROV-04)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;

    renderGlobal(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats a 404 the same way (PROV-04)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;

    renderWorkspace(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders an explicit empty state when the scope has no config (edge case)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;

    renderGlobal(fetchImpl);

    expect(await screen.findByText('Nenhum provider cadastrado neste escopo.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

/** Fills the three create-form fields. */
function fillCreateForm(baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o', key = 'sk-new') {
  fireEvent.change(screen.getByLabelText('Endpoint do provider'), { target: { value: baseUrl } });
  fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: model } });
  fireEvent.change(screen.getByLabelText('Chave da API'), { target: { value: key } });
}

/** Reads the JSON body of the nth call made to a `fetchImpl` mock. */
function bodyOfCall(fetchImpl: typeof fetch, index: number): Record<string, unknown> {
  const init = vi.mocked(fetchImpl).mock.calls[index]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('AiProviderAdminPage — creation (PROV-08..12)', () => {
  it('keeps submit disabled until endpoint, model and key are all non-empty (PROV-08)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;

    renderGlobal(fetchImpl);
    await screen.findByText('Nenhum provider cadastrado neste escopo.');

    const submit = screen.getByRole('button', { name: 'Cadastrar provider' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Endpoint do provider'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'gpt-4o' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Chave da API'), { target: { value: 'sk-new' } });
    expect(submit.disabled).toBe(false);
  });

  it('POSTs {scope, baseUrl, model, token} with the scope from the route (PROV-09)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return jsonResponse(201, { config: providerConfig({ id: 'cfg-new', scope: 'ws-1' }) });
      return jsonResponse(200, { items: [] });
    }) as unknown as typeof fetch;

    renderWorkspace(fetchImpl);
    await screen.findByText('Nenhum provider cadastrado neste escopo.');

    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar provider' }));

    await waitFor(() => expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2));
    expect(bodyOfCall(fetchImpl, 1)).toEqual({
      scope: 'ws-1',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      token: 'sk-new',
    });
  });

  it('adds the created config to the list and clears the key field on 201 (PROV-10)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return jsonResponse(201, {
          config: providerConfig({ id: 'cfg-new', baseUrl: 'https://new.example/v1' }),
        });
      return jsonResponse(200, { items: [] });
    }) as unknown as typeof fetch;

    renderGlobal(fetchImpl);
    await screen.findByText('Nenhum provider cadastrado neste escopo.');

    fillCreateForm('https://new.example/v1');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar provider' }));

    expect(await screen.findByText('https://new.example/v1')).toBeTruthy();
    expect((screen.getByLabelText('Chave da API') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('ai-provider-announcement').textContent).toBe('Provider cadastrado.');
  });

  it('renders the key field as a password input with autoComplete off (PROV-11)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;

    renderGlobal(fetchImpl);
    await screen.findByText('Nenhum provider cadastrado neste escopo.');

    const keyInput = screen.getByLabelText('Chave da API') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    expect(keyInput.getAttribute('autocomplete')).toBe('off');
  });

  it('reports a rejected endpoint on 400 and keeps the typed values (PROV-12)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(400, { message: 'baseUrl rejected' });
      return jsonResponse(200, { items: [] });
    }) as unknown as typeof fetch;

    renderGlobal(fetchImpl);
    await screen.findByText('Nenhum provider cadastrado neste escopo.');

    fillCreateForm('http://169.254.169.254/v1', 'gpt-4o', 'sk-new');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar provider' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-announcement').textContent).toBe(
        'O endpoint informado foi rejeitado pelo servidor.',
      ),
    );
    expect((screen.getByLabelText('Endpoint do provider') as HTMLInputElement).value).toBe(
      'http://169.254.169.254/v1',
    );
    expect((screen.getByLabelText('Modelo') as HTMLInputElement).value).toBe('gpt-4o');
    expect((screen.getByLabelText('Chave da API') as HTMLInputElement).value).toBe('sk-new');
  });
});
