import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` — `seriousOrCriticalViolations` is
// duplicated here rather than imported, matching the `AiDock.a11y.spec.tsx` convention.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SNAPSHOTS = [
  {
    id: 'snap-2',
    revision: 2,
    kind: 'named',
    name: 'checkpoint',
    createdAt: '2026-08-16T11:00:00.000Z',
  },
  { id: 'snap-1', revision: 1, kind: 'auto', name: null, createdAt: '2026-08-16T10:00:00.000Z' },
];

function noopRestored(): Promise<void> {
  return Promise.resolve();
}

beforeAll(() => {
  // jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` — same shim as
  // `ConfirmArchiveDialog.a11y.spec.tsx` (T5/NAV).
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

describe('HistoryPanel (T6, SNAP-14..16)', () => {
  it('populated timeline with create action has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;
    const { container } = render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('empty-state (read-only) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: [] })),
    ) as unknown as typeof fetch;
    const { container } = render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findByText(
      'Nenhum snapshot ainda. Snapshots automáticos aparecem conforme você edita o diagrama.',
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('open restore-confirmation dialog has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;
    const { container } = render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    await act(async () => {
      fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
