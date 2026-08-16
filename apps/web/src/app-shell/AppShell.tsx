import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogout } from '../auth/AuthProvider.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

/** Placeholder app-shell layout (nav/search/admin land here in F1+). */
export function AppShell(): JSX.Element {
  const { t } = useTranslation();
  const logout = useLogout();

  return (
    <div>
      <header>
        <h1>{t('app.title')}</h1>
        <LanguageSwitcher />
        {/* T9: no menu, no confirmation — a single button, same as design.md's
            "extensão mínima". `useLogout()` flips `AuthProvider`'s status to
            `anonymous`, which is what makes `ProtectedRoute` (this component's
            own parent route in App.tsx) redirect to `/login`. */}
        <button type="button" onClick={() => void logout()}>
          {t('auth.logout')}
        </button>
      </header>
      <main />
    </div>
  );
}
