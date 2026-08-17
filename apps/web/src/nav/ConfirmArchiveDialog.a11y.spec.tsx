import { cleanup, render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` (read its header comment for the
// full Knowledge Verification Chain) — `seriousOrCriticalViolations` is duplicated here
// rather than imported, matching the AiDock.a11y.spec.tsx/LoginPage.a11y.spec.tsx convention.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

beforeAll(() => {
  // jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` — same shim as
  // `ConfirmArchiveDialog.spec.tsx` (T5), needed to reach the dialog's real open state.
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

afterEach(() => {
  cleanup();
});

describe('ConfirmArchiveDialog (T10, NAV-24..26)', () => {
  it('open state, populated with an item name, has zero serious/critical axe violations', async () => {
    const ref = createRef<HTMLDialogElement>();
    const { container } = render(
      <ConfirmArchiveDialog
        ref={ref}
        itemName="Project Atlas"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    ref.current?.showModal();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
