import { type FormEvent, type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createFirstRunClient, type FirstRunClient } from './firstRunClient.js';

const MIN_PASSWORD_LENGTH = 12;

/** Maps the field the server refused to its own message key, so the person sees which input to fix. */
const FIELD_MESSAGE_KEY: Record<string, string> = {
  email: 'firstRun.invalidEmail',
  password: 'firstRun.invalidPassword',
  displayName: 'firstRun.invalidDisplayName',
  workspaceName: 'firstRun.invalidWorkspaceName',
};

export interface FirstRunPageProps {
  /** Injectable for tests; defaults to the global fetch, same convention as `WorkspaceMembersPage`. */
  client?: FirstRunClient;
  /** Called when the instance turns out to be initialized already, so `LoginPage` can fall back to credentials (BOOT-15). */
  onAlreadyInitialized?: () => void;
}

/**
 * BOOT-12..16: the screen a fresh instance shows in place of the credentials form.
 *
 * A failed submit never clears what was typed except the password: re-typing a workspace
 * name because the password was short is the kind of small cruelty that makes an install
 * feel hostile.
 */
export function FirstRunPage({ client, onAlreadyInitialized }: FirstRunPageProps): JSX.Element {
  const { t } = useTranslation();
  const resolvedClient = useMemo(() => client ?? createFirstRunClient(), [client]);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 0 &&
    displayName.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    workspaceName.trim().length > 0 &&
    !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorKey(null);

    const result = await resolvedClient.submit({ email, displayName, password, workspaceName });

    if (result.status === 'created') {
      // A hard navigation, not client-side routing: `AuthProvider` resolves its session once,
      // on mount, so only a real navigation picks up the cookie this call just set — same
      // reasoning as `LoginPage`'s successful login.
      window.location.assign('/');
      return;
    }

    setPassword('');
    setSubmitting(false);

    if (result.status === 'already_initialized') {
      setErrorKey('firstRun.alreadyInitialized');
      onAlreadyInitialized?.();
      return;
    }
    if (result.status === 'invalid') {
      setErrorKey(FIELD_MESSAGE_KEY[result.field] ?? 'firstRun.invalidUnknown');
      return;
    }
    setErrorKey(result.status === 'rate_limited' ? 'firstRun.rateLimited' : 'firstRun.error');
  }

  return (
    <div>
      <h2>{t('firstRun.title')}</h2>
      <p>{t('firstRun.intro')}</p>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <div aria-live="polite">
          {submitting ? t('firstRun.submitting') : errorKey ? t(errorKey) : null}
        </div>

        <label htmlFor="first-run-name">{t('firstRun.displayNameLabel')}</label>
        <input
          id="first-run-name"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <label htmlFor="first-run-email">{t('firstRun.emailLabel')}</label>
        <input
          id="first-run-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="first-run-password">{t('firstRun.passwordLabel')}</label>
        <input
          id="first-run-password"
          type="password"
          autoComplete="new-password"
          aria-describedby="first-run-password-hint"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p id="first-run-password-hint">{t('firstRun.passwordHint')}</p>

        <label htmlFor="first-run-workspace">{t('firstRun.workspaceLabel')}</label>
        <input
          id="first-run-workspace"
          type="text"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
        />

        <button type="submit" disabled={!canSubmit}>
          {t('firstRun.submit')}
        </button>
      </form>
    </div>
  );
}
