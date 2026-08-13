import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher.js';

/** Placeholder app-shell layout (nav/search/admin land here in F1+). */
export function AppShell(): JSX.Element {
  const { t } = useTranslation();

  return (
    <div>
      <header>
        <h1>{t('app.title')}</h1>
        <LanguageSwitcher />
      </header>
      <main />
    </div>
  );
}
