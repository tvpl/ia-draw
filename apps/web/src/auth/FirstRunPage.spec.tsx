import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRunPage } from './FirstRunPage.js';
import type { FirstRunClient, SubmitResult } from './firstRunClient.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does. Default language is pt-BR.
import '../i18n/index.js';

function clientReturning(result: SubmitResult): FirstRunClient {
  return {
    checkAvailability: vi.fn(async () => ({ available: true })),
    submit: vi.fn(async () => result),
  };
}

function fillForm(overrides: Partial<Record<string, string>> = {}): void {
  fireEvent.change(screen.getByLabelText('Seu nome'), {
    target: { value: overrides.displayName ?? 'Admin' },
  });
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: overrides.email ?? 'admin@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: overrides.password ?? 'correct horse battery staple' },
  });
  fireEvent.change(screen.getByLabelText('Nome do workspace'), {
    target: { value: overrides.workspaceName ?? 'Arquitetura' },
  });
}

afterEach(cleanup);

describe('FirstRunPage (BOOT-12..16)', () => {
  it('keeps the submit action disabled until every field is filled', () => {
    render(<FirstRunPage client={clientReturning({ status: 'error' })} />);

    const submit = screen.getByRole('button', { name: 'Criar administrador' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fillForm();

    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the submit action disabled for a password under 12 characters (BOOT-05)', () => {
    render(<FirstRunPage client={clientReturning({ status: 'error' })} />);
    fillForm({ password: 'short' });

    expect(
      screen.getByRole('button', { name: 'Criar administrador' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('navigates to the authenticated root on success (BOOT-14)', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });

    render(
      <FirstRunPage
        client={clientReturning({
          status: 'created',
          user: { id: 'u-1', email: 'admin@example.com', displayName: 'Admin' },
          workspaceId: 'w-1',
        })}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/');
    });

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('shows the refused field message and preserves the other values on 400 (BOOT-15)', async () => {
    render(<FirstRunPage client={clientReturning({ status: 'invalid', field: 'password' })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }));

    await waitFor(() => {
      expect(screen.getByText('A senha precisa ter no mínimo 12 caracteres.')).toBeDefined();
    });
    // Everything except the password survives the failed attempt.
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('admin@example.com');
    expect((screen.getByLabelText('Nome do workspace') as HTMLInputElement).value).toBe(
      'Arquitetura',
    );
    expect((screen.getByLabelText('Seu nome') as HTMLInputElement).value).toBe('Admin');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
  });

  it('falls back to a generic message when the refused field is unrecognised', async () => {
    render(<FirstRunPage client={clientReturning({ status: 'invalid', field: 'unknown' })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }));

    await waitFor(() => {
      expect(screen.getByText('Não foi possível criar a conta com esses dados.')).toBeDefined();
    });
  });

  it('reports that the instance stopped being empty and tells the caller (BOOT-16)', async () => {
    const onAlreadyInitialized = vi.fn();
    render(
      <FirstRunPage
        client={clientReturning({ status: 'already_initialized' })}
        onAlreadyInitialized={onAlreadyInitialized}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }));

    await waitFor(() => {
      expect(onAlreadyInitialized).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText('Esta instância já foi inicializada. Entre com as suas credenciais.'),
    ).toBeDefined();
  });

  it('reports the rate limit distinctly from a generic failure (BOOT-09)', async () => {
    render(<FirstRunPage client={clientReturning({ status: 'rate_limited' })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }));

    await waitFor(() => {
      expect(
        screen.getByText('Tentativas demais. Espere um minuto e tente de novo.'),
      ).toBeDefined();
    });
  });

  it('takes every string from i18n, leaking no raw key into the output (BOOT-16)', () => {
    render(<FirstRunPage client={clientReturning({ status: 'error' })} />);

    expect(screen.queryByText(/^firstRun\./)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Primeiro acesso' })).toBeDefined();
  });
});
