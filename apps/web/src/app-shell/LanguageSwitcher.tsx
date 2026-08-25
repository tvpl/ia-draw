import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';
import * as css from '../styles/classNames.js';

export function LanguageSwitcher(): JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <label className="flex items-center gap-2 text-sm text-content-muted">
      {t('languageSwitcher.label')}
      <select
        className={css.select}
        value={i18n.language}
        onChange={(event) => {
          void i18n.changeLanguage(event.target.value);
        }}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>
    </label>
  );
}
