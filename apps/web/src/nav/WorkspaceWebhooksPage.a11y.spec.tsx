import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// WorkspaceMembersPage.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { WorkspaceWebhooksPage } from './WorkspaceWebhooksPage.js';
import type { WebhookEndpoint } from './webhookClient.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as shell.a11y.spec.tsx — duplicated here rather than imported,
// matching every other *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

beforeAll(() => {
  // Same jsdom <dialog> shim as WorkspaceMembersPage.a11y.spec.tsx.
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

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  // Restores the default locale in case the WHK-33 test below switched it and failed before
  // switching back, so later tests in this file aren't left asserting the wrong strings.
  await i18n.changeLanguage('pt-BR');
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

function fetchWith(handler?: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/workspaces/ws-1/webhooks' && !init) return jsonResponse(200, { items: [hookA] });
    if (handler) return handler(url, init);
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/webhooks']}>
      <Routes>
        <Route
          path="/w/:workspaceId/webhooks"
          element={<WorkspaceWebhooksPage fetchImpl={fetchImpl} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function row(): HTMLElement {
  return screen.getByTestId('webhook-url-wh-1').closest('li') as HTMLElement;
}

function createForm(): HTMLElement {
  const forms = document.querySelectorAll('form');
  return forms[forms.length - 1] as HTMLElement;
}

describe('WorkspaceWebhooksPage accessibility (T5, WHK-31..33)', () => {
  it('the populated-list state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(fetchWith());
    await screen.findByTestId('webhook-url-wh-1');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the secret-reveal state has zero serious/critical axe violations', async () => {
    const fetchImpl = fetchWith((url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: hookA, secret: 'whsec_axe' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    const { container } = renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row()).getByRole('button', { name: 'Rotacionar segredo' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Rotacionar agora' }));
    await screen.findByTestId('webhook-secret-panel');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the rotate-confirmation state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(fetchWith());
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row()).getByRole('button', { name: 'Rotacionar segredo' }));
    expect(within(row()).getByRole('button', { name: 'Rotacionar agora' })).toBeTruthy();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the in-row edit state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(fetchWith());
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row()).getByRole('button', { name: 'Editar' }));
    const editForm = document.querySelector('form') as HTMLElement;
    expect(within(editForm).getByRole('button', { name: 'Salvar' })).toBeTruthy();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every list-and-create control is keyboard-focusable (WHK-31)', async () => {
    renderPage(fetchWith());
    await screen.findByTestId('webhook-url-wh-1');

    const backLink = screen.getByRole('link', { name: 'Voltar' });
    backLink.focus();
    expect(document.activeElement).toBe(backLink);

    for (const name of ['Editar', 'Desativar', 'Rotacionar segredo', 'Remover']) {
      const button = within(row()).getByRole('button', { name });
      button.focus();
      expect(document.activeElement).toBe(button);
    }

    const form = createForm();
    const urlInput = within(form).getByLabelText('URL do endpoint');
    urlInput.focus();
    expect(document.activeElement).toBe(urlInput);

    for (const checkbox of within(form).getAllByRole('checkbox')) {
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);
    }

    const submit = within(form).getByRole('button', { name: 'Adicionar webhook' });
    submit.focus();
    expect(document.activeElement).toBe(submit);
  });

  it('the rotate-confirmation, remove-dialog and secret-panel controls are keyboard-focusable (WHK-31)', async () => {
    const fetchImpl = fetchWith((url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: hookA, secret: 'whsec_axe' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row()).getByRole('button', { name: 'Remover' }));
    const confirmRemove = screen.getByTestId('confirm-archive-confirm');
    confirmRemove.focus();
    expect(document.activeElement).toBe(confirmRemove);
    fireEvent.click(screen.getByTestId('confirm-archive-cancel'));

    fireEvent.click(within(row()).getByRole('button', { name: 'Rotacionar segredo' }));
    const confirmRotate = within(row()).getByRole('button', { name: 'Rotacionar agora' });
    confirmRotate.focus();
    expect(document.activeElement).toBe(confirmRotate);

    fireEvent.click(confirmRotate);
    await screen.findByTestId('webhook-secret-panel');

    const panel = screen.getByTestId('webhook-secret-panel');
    for (const name of ['Copiar segredo', 'Já guardei']) {
      const button = within(panel).getByRole('button', { name });
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    const secretField = screen.getByTestId('webhook-secret-value');
    secretField.focus();
    expect(document.activeElement).toBe(secretField);
  });

  it('the outcome region is aria-live="polite" and announces a completed action (WHK-32)', async () => {
    const fetchImpl = fetchWith((url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    const liveRegion = screen.getByTestId('webhooks-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(within(row()).getByRole('button', { name: 'Remover' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(liveRegion.textContent).toBe('Webhook removido.'));
  });

  it('renders in the en locale as well as pt-BR (WHK-33)', async () => {
    await i18n.changeLanguage('en');
    renderPage(fetchWith());

    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add webhook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rotate secret' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.getByTestId('webhook-enabled-wh-1').textContent).toBe('Enabled');

    const form = createForm();
    expect(within(form).getByLabelText('Endpoint URL')).toBeTruthy();
    expect(within(form).getByLabelText('Diagram created')).toBeTruthy();
  });

  it('renders the secret panel’s en strings too — the reveal is the one surface a user cannot re-open (WHK-33)', async () => {
    const fetchImpl = fetchWith((url, init) => {
      if (url === '/workspaces/ws-1/webhooks/wh-1:rotate-secret' && init?.method === 'PATCH')
        return jsonResponse(200, { webhookEndpoint: hookA, secret: 'whsec_axe' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    await i18n.changeLanguage('en');
    renderPage(fetchImpl);
    await screen.findByTestId('webhook-url-wh-1');

    fireEvent.click(within(row()).getByRole('button', { name: 'Rotate secret' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Rotate now' }));

    const panel = await screen.findByTestId('webhook-secret-panel');
    expect(
      within(panel).getByText(
        'This is the only time this secret is shown. Copy it now — it cannot be retrieved later.',
      ),
    ).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Copy secret' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'I saved it' })).toBeTruthy();
  });
});
