import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * First confirmation-modal surface in the app (design.md) — a native `<dialog>`
 * (`showModal()`/`close()`), not `window.confirm` and not a custom overlay `div`. Fully
 * controlled from the outside: the caller owns a `ref` to the underlying `<dialog>` DOM node
 * (React 19 lets a function component accept `ref` as a plain prop, no `forwardRef` needed) and
 * opens/closes it imperatively — this component only renders the dialog's content and reports
 * the user's choice via `onConfirm`/`onCancel`, exactly once, never both.
 */
export interface ConfirmArchiveDialogProps {
  /** Name of the item about to be archived — always shown in the confirmation message (NAV-18). */
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
  ref?: Ref<HTMLDialogElement>;
}

export function ConfirmArchiveDialog({
  itemName,
  onConfirm,
  onCancel,
  ref,
}: ConfirmArchiveDialogProps) {
  const { t } = useTranslation();

  return (
    <dialog ref={ref} aria-labelledby="confirm-archive-dialog-title" onCancel={onCancel}>
      <h2 id="confirm-archive-dialog-title">{t('nav.archiveConfirm.title')}</h2>
      <p>
        <strong data-testid="confirm-archive-item-name">{itemName}</strong>{' '}
        {t('nav.archiveConfirm.body')}
      </p>
      <button type="button" onClick={onConfirm} data-testid="confirm-archive-confirm">
        {t('nav.archiveConfirm.confirm')}
      </button>
      <button type="button" onClick={onCancel} data-testid="confirm-archive-cancel">
        {t('nav.archiveConfirm.cancel')}
      </button>
    </dialog>
  );
}
