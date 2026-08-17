import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoreApi, UseBoundStore } from 'zustand';
import { type PresenceState, presenceStatusTranslationKey } from './presenceStore.js';

export interface ConnectionStatusProps {
  store: UseBoundStore<StoreApi<PresenceState>>;
}

/**
 * LIVE-24/25: the realtime connection state, in words. Same shape as the
 * `save-status` line this page already renders (text derived from a store
 * value through an i18n key), plus an `aria-live="polite"` region so a screen
 * reader hears a drop instead of silently trusting frozen cursors.
 *
 * Deliberately not interactive: there is nothing to click here, so it adds
 * nothing to the tab order and never interrupts canvas keyboard flow.
 */
export function ConnectionStatus({ store }: ConnectionStatusProps): JSX.Element {
  const { t } = useTranslation();
  const connection = store((state) => state.connection);

  return (
    <p data-testid="presence-connection-status" aria-live="polite">
      {t(presenceStatusTranslationKey(connection))}
    </p>
  );
}
