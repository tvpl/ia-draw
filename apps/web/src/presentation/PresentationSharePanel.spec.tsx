import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n/index.js';
import { PresentationSharePanel } from './PresentationSharePanel.js';

afterEach(cleanup);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FUTURE_LOCAL = '2030-01-01T10:00';

const CREATED_LINK = {
  id: 'sl-1',
  resourceType: 'presentation',
  resourceId: 'p-1',
  role: 'viewer',
  expiresAt: '2030-01-01T10:00:00.000Z',
  revokedAt: null,
  createdBy: 'u-1',
  createdAt: '2026-08-17T00:00:00.000Z',
};

function renderPanel(fetchImpl: typeof fetch, published = true) {
  return render(
    <PresentationSharePanel presentationId="p-1" published={published} fetchImpl={fetchImpl} />,
  );
}

// Chosen deliberately NOT the default ('' placeholder), NOT the first real <option>
// (org_admin), and NOT any helper default — same discipline R11's ShareLinkPanel tests
// use, so a mutant that silently reverts to the default survives no test here either.
function fillForm(role = 'viewer', expiresAt = FUTURE_LOCAL) {
  fireEvent.change(screen.getByLabelText('Papel concedido pelo link'), {
    target: { value: role },
  });
  fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: expiresAt } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Criar link' }));
}

describe('PresentationSharePanel — disabled before publish (PRZ-26)', () => {
  it('the form is disabled and explains why when published is false', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl, false);

    expect(
      screen.getByText('Publique a apresentação antes de criar um link público.'),
    ).toBeTruthy();
    const submitButton = screen.getByRole('button', { name: 'Criar link' });
    expect((submitButton.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });

  it('submitting while disabled emits no request', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderPanel(fetchImpl, false);

    submit();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('PresentationSharePanel — creating a link once published (PRZ-27/28)', () => {
  it('POSTs {role, expiresAt} to /presentations/:id/share-links and reveals the URL once on 201', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' }),
    ) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();

    const urlField = await screen.findByDisplayValue('http://localhost:3000/share/plain-token-abc');
    expect(urlField).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/share-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer', expiresAt: '2030-01-01T10:00:00.000Z' }),
    });
  });

  it('a 403 shows the role-ceiling message and adds nothing to the list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();

    const matches = await screen.findAllByText('Você não pode conceder um papel acima do seu.');
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('URL de compartilhamento')).toBeNull();
  });

  it('revoking removes the URL from the DOM entirely, not just visually hidden (L-038)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/presentations/p-1/share-links') {
        return jsonResponse(201, { shareLink: CREATED_LINK, token: 'plain-token-abc' });
      }
      if (url === '/share-links/sl-1:revoke') {
        return jsonResponse(200, {
          shareLink: { ...CREATED_LINK, revokedAt: '2026-08-17T01:00:00.000Z' },
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPanel(fetchImpl);

    fillForm();
    submit();
    await screen.findByDisplayValue('http://localhost:3000/share/plain-token-abc');

    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    await screen.findByText('Revogado');
    // The token/URL is gone from the document altogether — not merely hidden.
    expect(screen.queryByDisplayValue('http://localhost:3000/share/plain-token-abc')).toBeNull();
    expect(document.body.textContent).not.toContain('plain-token-abc');
  });
});
