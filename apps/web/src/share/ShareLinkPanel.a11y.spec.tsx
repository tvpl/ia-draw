import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// every other *.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { ShareLinkPanel } from './ShareLinkPanel.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx`, duplicated here rather than
// imported, matching every other *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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

function creatingFetch(): typeof fetch {
  return vi.fn(async () =>
    jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' }),
  ) as unknown as typeof fetch;
}

function renderPanel(fetchImpl: typeof fetch) {
  return render(<ShareLinkPanel diagramId="d-1" canMutate fetchImpl={fetchImpl} />);
}

async function createOneLink(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Papel concedido pelo link'), {
    target: { value: 'viewer' },
  });
  fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: '2030-01-01T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar link' }));
  await screen.findByLabelText('URL de compartilhamento');
}

describe('ShareLinkPanel accessibility (T9, SHR-29..31)', () => {
  it('the empty state has zero serious/critical axe violations', async () => {
    const { container } = renderPanel(creatingFetch());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the state with one created link has zero serious/critical axe violations', async () => {
    const { container } = renderPanel(creatingFetch());
    await createOneLink();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the form controls and the revoke action are all keyboard-focusable (SHR-29)', async () => {
    renderPanel(creatingFetch());

    const roleSelect = screen.getByLabelText('Papel concedido pelo link');
    roleSelect.focus();
    expect(document.activeElement).toBe(roleSelect);

    const expiresInput = screen.getByLabelText('Expira em');
    expiresInput.focus();
    expect(document.activeElement).toBe(expiresInput);

    const submitButton = screen.getByRole('button', { name: 'Criar link' });
    submitButton.focus();
    expect(document.activeElement).toBe(submitButton);

    await createOneLink();

    const revokeButton = screen.getByRole('button', { name: 'Revogar' });
    revokeButton.focus();
    expect(document.activeElement).toBe(revokeButton);
  });

  it('the outcome region is aria-live="polite" and announces a completed creation (SHR-30)', async () => {
    renderPanel(creatingFetch());

    const liveRegion = screen.getByTestId('share-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    await createOneLink();

    await waitFor(() => expect(liveRegion.textContent).toBe('Link de compartilhamento criado.'));
  });

  it('renders in the en locale as well as pt-BR (SHR-31)', async () => {
    await i18n.changeLanguage('en');
    renderPanel(creatingFetch());

    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy();
    expect(screen.getByLabelText('Role granted by the link')).toBeTruthy();
    expect(screen.getByLabelText('Expires on')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Links created in this session' })).toBeTruthy();
  });
});
