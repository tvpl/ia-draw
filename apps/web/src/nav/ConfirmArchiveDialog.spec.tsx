import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads.
import '../i18n/index.js';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';

afterEach(() => {
  cleanup();
});

/**
 * jsdom 30.0.1's `HTMLDialogElement` is a bare `HTMLElement` subclass — no `showModal()`,
 * `close()`, or native Escape-to-cancel behavior at all (verified against the installed
 * package: `HTMLDialogElementImpl` only extends `HTMLElement-impl` with nothing added). This is
 * a headless-test-only shim, the same rationale as `vitest.setup.ts`'s `FontFace` shim: it
 * ships in no production code, and only approximates enough of the real browser contract
 * (`open` reflects visibility, Escape fires a cancelable `cancel` event that closes the dialog
 * unless prevented) to exercise `ConfirmArchiveDialog`'s own ref-driven open/close contract.
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

function renderOpenDialog(overrides: Partial<{ itemName: string }> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const ref = createRef<HTMLDialogElement>();

  render(
    <ConfirmArchiveDialog
      ref={ref}
      itemName={overrides.itemName ?? 'Project Atlas'}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  ref.current?.showModal();

  return { onConfirm, onCancel, ref };
}

describe('ConfirmArchiveDialog (NAV-18)', () => {
  it('renders the item name in the confirmation message', () => {
    renderOpenDialog({ itemName: 'Project Atlas' });

    // No @testing-library/jest-dom in this repo (confirmed absent from package.json) — plain
    // DOM property assertions instead of jest-dom matchers, same convention as AiDock.spec.tsx.
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Project Atlas');
  });

  it('confirm click calls onConfirm only', () => {
    const { onConfirm, onCancel } = renderOpenDialog();

    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancel click calls onCancel only', () => {
    const { onConfirm, onCancel } = renderOpenDialog();

    fireEvent.click(screen.getByTestId('confirm-archive-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('native Esc-to-close calls onCancel only, without the caller closing the dialog explicitly', () => {
    const { onConfirm, onCancel, ref } = renderOpenDialog();

    expect(ref.current?.hasAttribute('open')).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    // The shim's Escape handling closes the dialog by default (matching real <dialog>
    // behavior) — confirms the ref-driven open/close contract survives the native path too.
    expect(ref.current?.hasAttribute('open')).toBe(false);
  });

  it('uses a native <dialog> element, not a custom overlay', () => {
    const { ref } = renderOpenDialog();
    expect(ref.current?.tagName).toBe('DIALOG');
  });

  it('the confirm and cancel buttons are keyboard-focusable (NAV-24)', () => {
    renderOpenDialog();

    const confirmButton = screen.getByTestId('confirm-archive-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);

    const cancelButton = screen.getByTestId('confirm-archive-cancel');
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);
  });
});
