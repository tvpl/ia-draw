import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads.
import '../i18n/index.js';
import { RestoreConfirmDialog } from './RestoreConfirmDialog.js';

afterEach(() => {
  cleanup();
});

/**
 * jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` — same shim as
 * `ConfirmArchiveDialog.spec.tsx` (T5/NAV), headless-test-only, ships in no production code.
 */
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };

  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
      const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        const cancelEvent = new Event('cancel', { cancelable: true });
        this.dispatchEvent(cancelEvent);
        if (!cancelEvent.defaultPrevented) this.close();
      };
      (this as unknown as { __escListener?: (event: KeyboardEvent) => void }).__escListener =
        onKeydown;
      document.addEventListener('keydown', onKeydown);
    };
  }

  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      const listener = (this as unknown as { __escListener?: (event: KeyboardEvent) => void })
        .__escListener;
      if (listener) document.removeEventListener('keydown', listener);
      this.dispatchEvent(new Event('close'));
    };
  }
});

function renderOpenDialog(overrides: Partial<{ snapshotLabel: string }> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const ref = createRef<HTMLDialogElement>();

  render(
    <RestoreConfirmDialog
      ref={ref}
      snapshotLabel={overrides.snapshotLabel ?? 'checkpoint'}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  ref.current?.showModal();

  return { onConfirm, onCancel, ref };
}

describe('RestoreConfirmDialog (T3, SNAP-06)', () => {
  it('renders the target snapshot label', () => {
    renderOpenDialog({ snapshotLabel: 'checkpoint' });

    expect(screen.getByTestId('restore-confirm-item-label').textContent).toBe('checkpoint');
  });

  it('SNAP-06: explicitly names that restoring creates a new revision without deleting revisions in between', () => {
    renderOpenDialog();

    expect(
      screen.getByText(
        'Restaurar cria uma revisão nova a partir deste snapshot — nenhuma revisão intermediária é apagada, tudo continua na linha do tempo.',
      ),
    ).toBeTruthy();
  });

  it('confirm click calls onConfirm only', () => {
    const { onConfirm, onCancel } = renderOpenDialog();

    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancel click calls onCancel only', () => {
    const { onConfirm, onCancel } = renderOpenDialog();

    fireEvent.click(screen.getByTestId('restore-confirm-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a native <dialog> element, not a custom overlay', () => {
    const { ref } = renderOpenDialog();
    expect(ref.current?.tagName).toBe('DIALOG');
  });

  it('the confirm and cancel buttons are keyboard-focusable (SNAP-14)', () => {
    renderOpenDialog();

    const confirmButton = screen.getByTestId('restore-confirm-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);

    const cancelButton = screen.getByTestId('restore-confirm-cancel');
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);
  });
});
