import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// every other spec file. Default language is pt-BR.
import '../i18n/index.js';
import { PublicShell } from './PublicShell.js';

afterEach(cleanup);

describe('PublicShell (T5, SHR-17)', () => {
  it('renders its children inside a <main> under the product header', () => {
    render(
      <PublicShell>
        <p>shared content</p>
      </PublicShell>,
    );

    expect(screen.getByRole('heading', { name: 'Architecture Canvas' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('shared content');
  });

  it('renders no logout control and no link into an authenticated route', () => {
    render(
      <PublicShell>
        <p>shared content</p>
      </PublicShell>,
    );

    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('mounts with no AuthProvider above it and no router around it', () => {
    // The whole point of SHR-17/AD-012: this chrome has zero session dependency,
    // so rendering it bare must not throw the "must be used within an AuthProvider"
    // error `useAuth`/`useLogout` raise.
    expect(() =>
      render(
        <PublicShell>
          <p>shared content</p>
        </PublicShell>,
      ),
    ).not.toThrow();
  });
});
