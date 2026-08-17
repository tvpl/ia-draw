import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** Renders the global page with one config already listed, then opens its edit form. */
async function renderWithEditOpen(fetchImpl: typeof fetch) {
  renderGlobal(fetchImpl);
  await screen.findByText('https://api.openai.com/v1');
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  return screen.getByText('https://api.openai.com/v1').closest('li') as HTMLElement;
}

function listResponseOnly(patchResponse: Response): typeof fetch {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patchResponse;
    return jsonResponse(200, { items: [providerConfig()] });
  }) as unknown as typeof fetch;
}

describe('AiProviderAdminPage — editing (PROV-13..16)', () => {
  it('omits `token` from the PATCH body when the key field is left blank (PROV-13)', async () => {
    const fetchImpl = listResponseOnly(
      jsonResponse(200, { config: providerConfig({ model: 'gpt-4.1' }) }),
    );
    const row = await renderWithEditOpen(fetchImpl);

    fireEvent.change(within(row).getByLabelText('Modelo'), { target: { value: 'gpt-4.1' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2));
    const body = bodyOfCall(fetchImpl, 1);
    expect('token' in body).toBe(false);
    expect(body).toEqual({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' });
  });

  it('includes `token` when the key field is filled in (PROV-14)', async () => {
    const fetchImpl = listResponseOnly(jsonResponse(200, { config: providerConfig() }));
    const row = await renderWithEditOpen(fetchImpl);

    fireEvent.change(within(row).getByLabelText('Chave da API'), {
      target: { value: 'sk-rotated' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2));
    expect(bodyOfCall(fetchImpl, 1).token).toBe('sk-rotated');
  });

  it('shows the "leave blank to keep the current key" hint in the edit form (PROV-15)', async () => {
    const fetchImpl = listResponseOnly(jsonResponse(200, { config: providerConfig() }));
    const row = await renderWithEditOpen(fetchImpl);

    expect(within(row).getByText('Deixe em branco para manter a chave atual.')).toBeTruthy();
    // The key field is never prefilled — the server never returns a key to prefill it with.
    expect((within(row).getByLabelText('Chave da API') as HTMLInputElement).value).toBe('');
  });

  it('keeps the previous values in the list when the PATCH fails (PROV-16)', async () => {
    const fetchImpl = listResponseOnly(jsonResponse(403, {}));
    const row = await renderWithEditOpen(fetchImpl);

    fireEvent.change(within(row).getByLabelText('Modelo'), { target: { value: 'gpt-4.1' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByText('gpt-4o-mini')).toBeTruthy();
    expect(screen.queryByText('gpt-4.1')).toBeNull();
  });

  it('replaces the row with the server response on success (PROV-16 counterpart)', async () => {
    const fetchImpl = listResponseOnly(
      jsonResponse(200, { config: providerConfig({ model: 'gpt-4.1' }) }),
    );
    const row = await renderWithEditOpen(fetchImpl);

    fireEvent.change(within(row).getByLabelText('Modelo'), { target: { value: 'gpt-4.1' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('gpt-4.1')).toBeTruthy();
    expect(screen.getByTestId('ai-provider-announcement').textContent).toBe('Provider atualizado.');
  });
});

const ACTIVE = providerConfig({ id: 'cfg-1', model: 'gpt-4o-mini', enabled: true });
const INACTIVE = providerConfig({
  id: 'cfg-2',
  baseUrl: 'https://alt.example/v1',
  model: 'gpt-4o',
  enabled: false,
});

/** Two configs in the same scope: `cfg-1` active, `cfg-2` inactive. */
function renderTwoConfigs(patchResponse: () => Response) {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return patchResponse();
    return jsonResponse(200, { items: [ACTIVE, INACTIVE] });
  }) as unknown as typeof fetch;
  renderGlobal(fetchImpl);
  return fetchImpl;
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

describe('AiProviderAdminPage — switching the active config (PROV-21/22/26)', () => {
  it('PATCHes {enabled: true} to the activated config (PROV-21)', async () => {
    const fetchImpl = renderTwoConfigs(() =>
      jsonResponse(200, { config: { ...INACTIVE, enabled: true } }),
    );
    await screen.findByText('https://alt.example/v1');

    fireEvent.click(
      within(rowOf('https://alt.example/v1')).getByRole('button', { name: 'Ativar' }),
    );

    await waitFor(() => expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2));
    expect(vi.mocked(fetchImpl).mock.calls[1]?.[0]).toBe('/admin/ai-providers/cfg-2');
    expect(bodyOfCall(fetchImpl, 1)).toEqual({ enabled: true });
  });

  it('marks the activated config active AND every other config in the scope inactive (PROV-22)', async () => {
    renderTwoConfigs(() => jsonResponse(200, { config: { ...INACTIVE, enabled: true } }));
    await screen.findByText('https://alt.example/v1');

    fireEvent.click(
      within(rowOf('https://alt.example/v1')).getByRole('button', { name: 'Ativar' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-state-cfg-2').textContent).toBe('Ativo'),
    );
    // The previously active sibling flips to inactive without a reload.
    expect(screen.getByTestId('ai-provider-state-cfg-1').textContent).toBe('Inativo');
    expect(screen.getByTestId('ai-provider-announcement').textContent).toBe('Provider ativado.');
  });

  it('deactivating the active config leaves the scope with none active (PROV-26)', async () => {
    const fetchImpl = renderTwoConfigs(() =>
      jsonResponse(200, { config: { ...ACTIVE, enabled: false } }),
    );
    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(
      within(rowOf('https://api.openai.com/v1')).getByRole('button', { name: 'Desativar' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-state-cfg-1').textContent).toBe('Inativo'),
    );
    expect(bodyOfCall(fetchImpl, 1)).toEqual({ enabled: false });
    expect(screen.getByTestId('ai-provider-state-cfg-2').textContent).toBe('Inativo');
    expect(screen.getByTestId('ai-provider-announcement').textContent).toBe('Provider desativado.');
  });

  it('a failed PATCH keeps the previous active/inactive states and announces the failure', async () => {
    renderTwoConfigs(() => jsonResponse(403, {}));
    await screen.findByText('https://alt.example/v1');

    fireEvent.click(
      within(rowOf('https://alt.example/v1')).getByRole('button', { name: 'Ativar' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByTestId('ai-provider-state-cfg-1').textContent).toBe('Ativo');
    expect(screen.getByTestId('ai-provider-state-cfg-2').textContent).toBe('Inativo');
  });
});

/** One listed config plus a scripted response for the `:test` call. */
function renderWithTestResponse(testResponse: () => Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith(':test')) return testResponse();
    return jsonResponse(200, { items: [providerConfig()] });
  }) as unknown as typeof fetch;
  renderGlobal(fetchImpl);
  return fetchImpl;
}

describe('AiProviderAdminPage — connection test (PROV-17..20)', () => {
  it('never fires a test on load — the rate-limited route is only called from a click (PROV-17)', async () => {
    const fetchImpl = renderWithTestResponse(async () => jsonResponse(200, {}));
    await screen.findByText('https://api.openai.com/v1');

    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe('/admin/ai-providers?scope=global');
  });

  it('POSTs to /:id:test on click (PROV-17)', async () => {
    const fetchImpl = renderWithTestResponse(async () =>
      jsonResponse(200, { success: true, modelAvailable: true, toolCallingSupported: true }),
    );
    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }));

    await waitFor(() => expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2));
    expect(vi.mocked(fetchImpl).mock.calls[1]?.[0]).toBe('/admin/ai-providers/cfg-1:test');
    const testInit = vi.mocked(fetchImpl).mock.calls[1]?.[1] as RequestInit;
    expect(testInit.method).toBe('POST');
  });

  it('reports success with model availability and tool-calling support (PROV-18)', async () => {
    renderWithTestResponse(async () =>
      jsonResponse(200, { success: true, modelAvailable: true, toolCallingSupported: false }),
    );
    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-test-cfg-1').textContent).toBe(
        'Conexão OK. Modelo disponível: sim. Tool calling: não.',
      ),
    );
  });

  it('reports a 200 with success:false as a FAILURE, carrying the provider error (PROV-19)', async () => {
    renderWithTestResponse(async () =>
      jsonResponse(200, {
        success: false,
        modelAvailable: false,
        toolCallingSupported: false,
        error: 'provider responded with status 401',
      }),
    );
    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-test-cfg-1').textContent).toBe(
        'Falha na conexão: provider responded with status 401',
      ),
    );
    expect(screen.getByTestId('ai-provider-test-cfg-1').textContent).not.toContain('Conexão OK');
  });

  it('reports the connection-test rate limit on 429 (PROV-20)', async () => {
    renderWithTestResponse(async () => jsonResponse(429, {}));
    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-test-cfg-1').textContent).toBe(
        'Limite de 10 testes de conexão por 60 segundos atingido. Tente de novo em instantes.',
      ),
    );
  });

  it('reports a generic failure on a network error and re-enables the button (edge case)', async () => {
    renderWithTestResponse(async () => {
      throw new Error('offline');
    });
    await screen.findByText('https://api.openai.com/v1');

    const button = screen.getByRole('button', { name: 'Testar conexão' }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByTestId('ai-provider-test-cfg-1').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(button.disabled).toBe(false);
  });

  it('a second click while a test is in flight fires no second request (edge case)', async () => {
    const deferred: { release: () => void } = { release: () => {} };
    const pending = new Promise<void>((resolve) => {
      deferred.release = resolve;
    });

    const fetchImpl = renderWithTestResponse(async () => {
      await pending;
      return jsonResponse(200, { success: true, modelAvailable: true, toolCallingSupported: true });
    });
    await screen.findByText('https://api.openai.com/v1');

    const button = screen.getByRole('button', { name: 'Testar conexão' }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));

    fireEvent.click(button);
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2);

    deferred.release();
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(2);
  });
});
