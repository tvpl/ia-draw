import { type JSX, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface WebhookSecretPanelProps {
  /** The raw HMAC secret, as returned by `POST .../webhooks` or `PATCH .../:rotate-secret`. */
  secret: string;
  /** Called when the user explicitly dismisses the panel; the parent owns unmounting. */
  onDismiss: () => void;
}

/**
 * The product's first (and only) surface that shows a secret in the clear (spec.md's Tech
 * Decision, WHK-11..17). The server returns the raw webhook signing secret exactly once — at
 * creation and at each rotation — and no route ever re-exposes it, so losing it costs the user a
 * rotation and breaks the integration they just configured.
 *
 * Three properties this component exists to guarantee, each covered by a test:
 *  - the secret is always present as selectable text, never reachable only through the copy
 *    button (`navigator.clipboard` is absent in non-secure contexts and its write can be denied);
 *  - a clipboard failure degrades to "copy it by hand" and never removes the secret;
 *  - nothing here closes the panel on its own. There is deliberately no timer and no
 *    auto-dismiss: the panel holds until the user says they saved it.
 */
export function WebhookSecretPanel({ secret, onDismiss }: WebhookSecretPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [copyOutcome, setCopyOutcome] = useState('');

  async function handleCopy(): Promise<void> {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopyOutcome(t('nav.webhooks.secret.copyFailed'));
      return;
    }
    try {
      await clipboard.writeText(secret);
      setCopyOutcome(t('nav.webhooks.secret.copied'));
    } catch {
      setCopyOutcome(t('nav.webhooks.secret.copyFailed'));
    }
  }

  return (
    <section aria-labelledby="webhook-secret-title" data-testid="webhook-secret-panel">
      <h3 id="webhook-secret-title">{t('nav.webhooks.secret.title')}</h3>
      <p>{t('nav.webhooks.secret.warning')}</p>
      <input
        readOnly
        value={secret}
        aria-labelledby="webhook-secret-title"
        data-testid="webhook-secret-value"
      />
      <button type="button" onClick={() => void handleCopy()}>
        {t('nav.webhooks.secret.copy')}
      </button>
      <button type="button" onClick={onDismiss}>
        {t('nav.webhooks.secret.dismiss')}
      </button>
      <p data-testid="webhook-secret-copy-outcome">{copyOutcome}</p>
    </section>
  );
}
