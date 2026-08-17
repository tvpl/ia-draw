import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// WorkspaceMembersPage.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { AiProviderAdminPage } from './AiProviderAdminPage.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as the other *.a11y.spec.tsx files in this codebase —
// duplicated here rather than imported, matching their convention.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  // Restores the default locale in case the PROV-29 test below switched it and failed
  // before switching back.
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ACTIVE = {
  id: 'cfg-1',
  scope: 'global',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  capabilitiesJson: {},
  enabled: true,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

const INACTIVE = { ...ACTIVE, id: 'cfg-2', baseUrl: 'https://alt.example/v1', enabled: false };

function listFetch(patchResponse?: () => Response): typeof fetch {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' && patchResponse) return patchResponse();
    return jsonResponse(200, { items: [ACTIVE, INACTIVE] });
  }) as unknown as typeof fetch;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/admin/ai-providers']}>
      <Routes>
        <Route path="/admin/ai-providers" element={<AiProviderAdminPage fetchImpl={fetchImpl} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

describe('AiProviderAdminPage accessibility (PROV-27..29)', () => {
  it('the populated-list state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(listFetch());
    await screen.findByText('https://alt.example/v1');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the edit-form-open state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(listFetch());
    await screen.findByText('https://alt.example/v1');

    fireEvent.click(
      within(rowOf('https://api.openai.com/v1')).getByRole('button', { name: 'Editar' }),
    );
    expect(
      within(rowOf('https://api.openai.com/v1')).getByRole('button', { name: 'Salvar' }),
    ).toBeTruthy();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every interactive control is keyboard-focusable (PROV-27)', async () => {
    renderPage(listFetch());
    await screen.findByText('https://alt.example/v1');

    const backLink = screen.getByRole('link', { name: 'Voltar' });
    backLink.focus();
    expect(document.activeElement).toBe(backLink);

    const row = rowOf('https://api.openai.com/v1');
    for (const name of ['Editar', 'Desativar', 'Testar conexão']) {
      const control = within(row).getByRole('button', { name });
      control.focus();
      expect(document.activeElement).toBe(control);
    }

    for (const label of ['Endpoint do provider', 'Modelo', 'Chave da API']) {
      const field = screen.getByLabelText(label);
      field.focus();
      expect(document.activeElement).toBe(field);
      // The submit below is disabled until all three carry a value (PROV-08), and a
      // disabled control is not keyboard-reachable — so fill each field as it is visited.
      fireEvent.change(field, { target: { value: 'x' } });
    }

    const createButton = screen.getByRole('button', { name: 'Cadastrar provider' });
    createButton.focus();
    expect(document.activeElement).toBe(createButton);

    // The edit form's own controls, once it is open.
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const editRow = rowOf('https://api.openai.com/v1');
    for (const name of ['Salvar', 'Cancelar']) {
      const control = within(editRow).getByRole('button', { name });
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });

  it('the outcome region is aria-live="polite" and announces a completed action (PROV-28)', async () => {
    renderPage(listFetch(() => jsonResponse(200, { config: { ...INACTIVE, enabled: true } })));
    await screen.findByText('https://alt.example/v1');

    const liveRegion = screen.getByTestId('ai-provider-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(
      within(rowOf('https://alt.example/v1')).getByRole('button', { name: 'Ativar' }),
    );

    await waitFor(() => expect(liveRegion.textContent).toBe('Provider ativado.'));
  });

  it('renders in the en locale as well as pt-BR (PROV-29)', async () => {
    await i18n.changeLanguage('en');
    renderPage(listFetch());

    expect(await screen.findByRole('heading', { name: 'AI providers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
    expect(screen.getByLabelText('Provider endpoint')).toBeTruthy();
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register provider' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Test connection' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
  });
});
