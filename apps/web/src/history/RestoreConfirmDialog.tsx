import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Confirmation modal for restoring a snapshot (SNAP-06) — same native `<dialog>` pattern as
 * `ConfirmArchiveDialog` (R3): `showModal()`/`close()`, fully controlled from the outside via a
 * `ref`, reports the choice via `onConfirm`/`onCancel` exactly once. Names explicitly that
 * restoring creates a new revision and never deletes anything in between (SNAP-06's own wording,
 * spec.md's Independent Test for "Restaurar uma revisão anterior").
 */
export interface RestoreConfirmDialogProps {
  /** Label of the snapshot about to be restored (from `snapshotLabel`) — shown in the confirmation message. */
  snapshotLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  ref?: Ref<HTMLDialogElement>;
}

export function RestoreConfirmDialog({
  snapshotLabel,
  onConfirm,
  onCancel,
  ref,
}: RestoreConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <dialog ref={ref} aria-labelledby="restore-confirm-dialog-title" onCancel={onCancel}>
      <h2 id="restore-confirm-dialog-title">{t('history.restoreConfirm.title')}</h2>
      <p>
        <strong data-testid="restore-confirm-item-label">{snapshotLabel}</strong>
      </p>
      <p>{t('history.restoreConfirm.body')}</p>
      <button type="button" onClick={onConfirm} data-testid="restore-confirm-confirm">
        {t('history.restoreConfirm.confirm')}
      </button>
      <button type="button" onClick={onCancel} data-testid="restore-confirm-cancel">
        {t('history.restoreConfirm.cancel')}
      </button>
    </dialog>
  );
}
