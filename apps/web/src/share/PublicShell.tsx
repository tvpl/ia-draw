import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../app-shell/LanguageSwitcher.js';

export interface PublicShellProps {
  children: ReactNode;
}

/**
 * The chrome of the public share view (SHR-17) — deliberately NOT `AppShell`.
 *
 * `AppShell` calls `useLogout()` and renders workspace navigation, both of which
 * need a session; mounting it here would drag `AuthProvider` back onto the one
 * route that must work for a visitor who never signs in (AD-012). This shell has
 * no session dependency at all: a product title, the language switcher (which
 * only uses `useTranslation`), and the page content.
 *
 * There is intentionally no link back into the app: a visitor holding a share
 * token has no account, so every authenticated route would only bounce them to
 * `/login`.
 */
export function PublicShell({ children }: PublicShellProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div>
      <header>
        <h1>{t('app.title')}</h1>
        <LanguageSwitcher />
      </header>
      <main>{children}</main>
    </div>
  );
}
