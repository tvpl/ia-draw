import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';

export function LanguageSwitcher(): JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <label>
      {t('languageSwitcher.label')}
      <select
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
