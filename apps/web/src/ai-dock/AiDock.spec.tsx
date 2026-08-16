import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does. Every assertion below queries English
// strings; language is switched to 'en' in `beforeEach` for predictable, readable
// assertions, and switched again mid-test in the dedicated i18n test (DOCK-23).
import i18n from '../i18n/index.js';
import { AiDock } from './AiDock.js';

// This repo has no `@testing-library/jest-dom` installed (confirmed: absent from
// apps/web/package.json and pnpm-lock.yaml) — every assertion below uses vitest's own
// `expect` plus plain DOM/RTL APIs (`.disabled`, `.value`, `document.activeElement`,
// `queryBy*` returning null) instead of jest-dom matchers like `toBeInTheDocument`.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PREVIEW = {
  added: ['el-1', 'el-2', 'el-3'],
  removed: ['el-0'],
  moved: [],
  modified: [],
  metadataChanged: [],
};

function renderDock(overrides: {
  canMutate?: boolean;
  selection?: readonly string[];
  fetchImpl: typeof fetch;
}) {
  const onApproved = vi.fn(async () => {});
  render(
    <AiDock
      diagramId="diagram-1"
      canMutate={overrides.canMutate ?? true}
      selection={overrides.selection ?? []}
      onApproved={onApproved}
      fetchImpl={overrides.fetchImpl}
    />,
  );
  return { onApproved };
}

async function submitRequest(text: string) {
  fireEvent.change(screen.getByLabelText('Describe what you want to change'), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await Promise.resolve();
  });
}

describe('AiDock (T7)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when canMutate is false (DOCK-02) — not even disabled', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { container } = render(
      <AiDock
        diagramId="diagram-1"
        canMutate={false}
        selection={[]}
        onApproved={vi.fn(async () => {})}
        fetchImpl={fetchImpl}
      />,
    );

    expect(container.innerHTML).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the request field is present and keyboard-reachable when canMutate is true (DOCK-01)', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderDock({ fetchImpl });

    const field = screen.getByLabelText('Describe what you want to change');
    expect(field.tagName).toBe('TEXTAREA');
    field.focus();
    expect(document.activeElement).toBe(field);
  });

  it('blank/whitespace-only text never triggers a request (Edge Case)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderDock({ fetchImpl });

    fireEvent.change(screen.getByLabelText('Describe what you want to change'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('full happy path: submit -> preview (removed before added) -> approve -> onApproved called only after 200', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-1', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-1:approve') {
        return Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-1', status: 'applied' },
            snapshot: { id: 'snapshot-1' },
            batch: {},
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { onApproved } = renderDock({ fetchImpl, selection: ['sel-1'] });

    await submitRequest('draw three services');

    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/ai/runs',
      expect.objectContaining({
        body: JSON.stringify({
          userRequest: 'draw three services',
          language: 'en',
          selection: ['sel-1'],
        }),
      }),
    );

    // DOCK-07: removed (1) rendered before added (3).
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf('Removed (1)')).toBeLessThan(headings.indexOf('Added (3)'));
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeNull();
    expect(onApproved).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await Promise.resolve();
    });

    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    // Undo becomes available for the just-applied run (DOCK-17).
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();
  });

  it('sensitive-change marker shown next to Approve only when requiresExplicitApproval is true (DOCK-16)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          run: { id: 'run-sensitive', status: 'awaiting_approval' },
          patch: {},
          preview: PREVIEW,
          requiresExplicitApproval: true,
        }),
      ),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    await submitRequest('delete everything');

    expect(screen.getByText('Sensitive change — review carefully before approving')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeNull();
  });

  it('discard path: emits :cancel and clears the preview, offering no terminal actions afterward', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-2', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-2:cancel') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    await submitRequest('draw three services');
    expect(screen.getByRole('button', { name: 'Discard' })).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-2:cancel', { method: 'POST' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('409-on-approve path: preview cleared, request text preserved, conflict message shown, nothing applied (DOCK-15)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-3', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-3:approve') {
        return Promise.resolve(jsonResponse(409, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { onApproved } = renderDock({ fetchImpl });

    await submitRequest('draw three services');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await Promise.resolve();
    });

    expect(
      screen.getByText('The diagram changed since your request. Send it again to try once more.'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(onApproved).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Describe what you want to change') as HTMLTextAreaElement;
    expect(field.value).toBe('draw three services');
  });

  it('429 path: rate-limit message shown, text preserved, submit re-enabled after the mocked 60s (DOCK-05)', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(429, {})),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    fireEvent.change(screen.getByLabelText('Describe what you want to change'), {
      target: { value: 'draw three services' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await Promise.resolve();
    });

    expect(
      screen.getByText('Limit of 20 requests per minute reached. Try again in 60 seconds.'),
    ).not.toBeNull();
    const submitButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    const field = screen.getByLabelText('Describe what you want to change') as HTMLTextAreaElement;
    expect(field.value).toBe('draw three services');

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('undo path: emits :restore with the approved run’s snapshot id and calls onApproved again on success (DOCK-17..19)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-4', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-4:approve') {
        return Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-4', status: 'applied' },
            snapshot: { id: 'snapshot-4' },
            batch: {},
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots/snapshot-4:restore') {
        return Promise.resolve(jsonResponse(200, { currentRevision: 9 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { onApproved } = renderDock({ fetchImpl });

    await submitRequest('draw three services');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await Promise.resolve();
    });
    expect(onApproved).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-4:restore', {
      method: 'POST',
    });
    expect(onApproved).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('undo stays offered after a non-200 restore response, never reporting success (DOCK-19)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-5', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-5:approve') {
        return Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-5', status: 'applied' },
            snapshot: { id: 'snapshot-5' },
            batch: {},
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots/snapshot-5:restore') {
        return Promise.resolve(jsonResponse(500, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { onApproved } = renderDock({ fetchImpl });

    await submitRequest('draw three services');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await Promise.resolve();
    });
    onApproved.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await Promise.resolve();
    });

    expect(onApproved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();
  });

  // DOCK-09 / Edge Case ("a run whose patch no longer exists on the server, e.g. after a
  // process restart, is never offered for approve again"). The current AiDockClient (T6,
  // frozen by this task's scope) has no branch distinguishing "vanished run" from any other
  // non-409 approve failure — both land the store in its generic `error` phase. That already
  // satisfies the edge case's actual safety invariant (approve is never re-offered for a run
  // that no longer exists), so this test exercises that path via a 404 response rather than a
  // literal `phase === 'expired'`, which nothing in the currently committed client ever sets.
  it('expired-run edge case: a vanished run on approve never re-offers approve, and reports an error', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-6', status: 'awaiting_approval' },
            patch: {},
            preview: PREVIEW,
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-6:approve') {
        return Promise.resolve(jsonResponse(404, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { onApproved } = renderDock({ fetchImpl });

    await submitRequest('draw three services');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(onApproved).not.toHaveBeenCalled();
    expect(screen.getByText('Error: unknown')).not.toBeNull();
  });

  it('provider-not-configured edge case: 424 on submit shows the dedicated message, offers no approve', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(424, {})),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    await submitRequest('draw three services');

    expect(
      screen.getByText('No AI provider is configured. This is set up outside the product today.'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('caps the visible preview list to 50 items while still showing the total count (Edge Case)', async () => {
    const bigPreview = {
      added: Array.from({ length: 60 }, (_, i) => `el-${i}`),
      removed: [],
      moved: [],
      modified: [],
      metadataChanged: [],
    };
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          run: { id: 'run-7', status: 'awaiting_approval' },
          patch: {},
          preview: bigPreview,
          requiresExplicitApproval: false,
        }),
      ),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    await submitRequest('draw sixty services');

    expect(screen.getByText('Added (60)')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
  });

  it('is entirely operable by keyboard: focus, type, and submit via Enter-triggered click', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          run: { id: 'run-8', status: 'awaiting_approval' },
          patch: {},
          preview: PREVIEW,
          requiresExplicitApproval: false,
        }),
      ),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    const field = screen.getByLabelText('Describe what you want to change');
    field.focus();
    fireEvent.change(field, { target: { value: 'draw three services' } });

    const submitButton = screen.getByRole('button', { name: 'Send' });
    submitButton.focus();
    expect(document.activeElement).toBe(submitButton);
    await act(async () => {
      fireEvent.click(submitButton);
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalled();
  });

  it('all visible text is sourced from i18n keys in both pt-BR and en (DOCK-23)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await i18n.changeLanguage('pt-BR');
    renderDock({ fetchImpl });
    expect(screen.getByText('Dock de IA')).not.toBeNull();
    expect(screen.getByLabelText('Descreva o que você quer mudar')).not.toBeNull();
    cleanup();

    await i18n.changeLanguage('en');
    renderDock({ fetchImpl });
    expect(screen.getByText('AI dock')).not.toBeNull();
    expect(screen.getByLabelText('Describe what you want to change')).not.toBeNull();
  });

  it('the aria-live region announces the phase transition from idle to awaiting_approval (DOCK-22)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          run: { id: 'run-9', status: 'awaiting_approval' },
          patch: {},
          preview: PREVIEW,
          requiresExplicitApproval: false,
        }),
      ),
    ) as unknown as typeof fetch;
    renderDock({ fetchImpl });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe('Idle');

    await submitRequest('draw three services');

    await waitFor(() => expect(liveRegion?.textContent).toBe('Awaiting your approval'));
  });
});
