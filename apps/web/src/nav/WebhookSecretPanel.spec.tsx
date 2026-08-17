import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton (default locale pt-BR), same
// convention as every other nav spec in this directory.
import '../i18n/index.js';
import { WebhookSecretPanel } from './WebhookSecretPanel.js';

const SECRET = 'whsec_abc123';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubClipboard(writeText: unknown): void {
  vi.stubGlobal('navigator', { clipboard: { writeText } });
}

describe('WebhookSecretPanel (T3, WHK-11..17)', () => {
  it('renders the secret as read-only selectable text (WHK-11)', () => {
    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);

    const field = screen.getByTestId('webhook-secret-value') as HTMLInputElement;
    expect(field.value).toBe(SECRET);
    expect(field.readOnly).toBe(true);
  });

  it('renders the explicit one-time warning (WHK-12)', () => {
    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);

    expect(
      screen.getByText(
        'Este é o único momento em que este segredo aparece. Copie agora — depois não dá para recuperá-lo.',
      ),
    ).toBeTruthy();
  });

  it('keeps the secret in the DOM without any copy interaction (WHK-13)', () => {
    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);

    // No click on the copy button anywhere in this test: the value must already be there.
    expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(SECRET);
  });

  it('writes the secret to the clipboard and confirms the copy (WHK-14)', async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);

    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar segredo' }));

    await waitFor(() =>
      expect(screen.getByTestId('webhook-secret-copy-outcome').textContent).toBe(
        'Segredo copiado para a área de transferência.',
      ),
    );
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  it('falls back to the manual-copy message when navigator.clipboard is absent, keeping the secret rendered (WHK-15)', async () => {
    vi.stubGlobal('navigator', {});

    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar segredo' }));

    await waitFor(() =>
      expect(screen.getByTestId('webhook-secret-copy-outcome').textContent).toBe(
        'Não foi possível copiar automaticamente. Selecione o segredo acima e copie à mão.',
      ),
    );
    expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(SECRET);
  });

  it('falls back to the manual-copy message when writeText rejects, keeping the secret rendered (WHK-15)', async () => {
    stubClipboard(vi.fn(async () => Promise.reject(new Error('denied'))));

    render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar segredo' }));

    await waitFor(() =>
      expect(screen.getByTestId('webhook-secret-copy-outcome').textContent).toBe(
        'Não foi possível copiar automaticamente. Selecione o segredo acima e copie à mão.',
      ),
    );
    expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(SECRET);
  });

  it('stays open across an unrelated re-render and across elapsed time — no auto-close (WHK-16)', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);

      rerender(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);
      vi.advanceTimersByTime(60_000);
      rerender(<WebhookSecretPanel secret={SECRET} onDismiss={() => {}} />);

      expect(screen.getByTestId('webhook-secret-panel')).toBeTruthy();
      expect((screen.getByTestId('webhook-secret-value') as HTMLInputElement).value).toBe(SECRET);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invokes onDismiss when the user dismisses, and owns no dismissal state of its own (WHK-17)', () => {
    const onDismiss = vi.fn();
    render(<WebhookSecretPanel secret={SECRET} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Já guardei' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    // The parent owns unmounting: the component must NOT hide itself, otherwise a parent that
    // keeps it mounted would leave a dead panel on screen.
    expect(screen.getByTestId('webhook-secret-panel')).toBeTruthy();
  });
});
