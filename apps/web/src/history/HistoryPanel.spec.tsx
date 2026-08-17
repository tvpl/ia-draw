import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR, so assertions below query the pt-BR strings.
import '../i18n/index.js';

/** No-op `onRestored` for tests that don't exercise the restore flow (T3 adds it). */
function noopRestored(): Promise<void> {
  return Promise.resolve();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SNAPSHOTS = [
  {
    id: 'snap-3',
    revision: 3,
    kind: 'named',
    name: 'checkpoint',
    createdAt: '2026-08-16T12:00:00.000Z',
  },
  { id: 'snap-2', revision: 2, kind: 'auto', name: null, createdAt: '2026-08-16T11:00:00.000Z' },
  {
    id: 'snap-1',
    revision: 1,
    kind: 'pre_ai',
    name: null,
    createdAt: '2026-08-16T10:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
});

describe('HistoryPanel (T2, SNAP-01..05)', () => {
  it('SNAP-01: lists snapshots in the order the server returns them, each with its kind label, name, and creation date', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    const rows = await screen.findAllByTestId('history-item');
    expect(rows).toHaveLength(3);
    // Server order preserved: named "checkpoint" (most recent) -> auto -> pre_ai (oldest).
    expect(rows[0]?.textContent).toContain('checkpoint');
    expect(rows[0]?.textContent).toContain('2026-08-16T12:00:00.000Z');
    expect(rows[1]?.textContent).toContain('Automático');
    expect(rows[2]?.textContent).toContain('Antes da edição por IA');
  });

  it('SNAP-01: a "named" snapshot with no name shows the unnamed-snapshot label, not a blank', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, {
          snapshots: [
            {
              id: 'snap-x',
              revision: 1,
              kind: 'named',
              name: null,
              createdAt: '2026-08-16T09:00:00.000Z',
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    expect(await screen.findByText('Snapshot sem nome')).toBeTruthy();
  });

  it('SNAP-02: the "create named snapshot" action is hidden when canMutate is false', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    await screen.findAllByTestId('history-item');
    expect(screen.queryByRole('button', { name: 'Criar snapshot' })).toBeNull();
  });

  it('SNAP-02: the "create named snapshot" action is visible when canMutate is true', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    await screen.findAllByTestId('history-item');
    expect(screen.getByRole('button', { name: 'Criar snapshot' })).not.toBeNull();
  });

  it('SNAP-03: creating with a name POSTs {name} and inserts the 201 response at the top, without a second GET', async () => {
    const created = {
      id: 'snap-new',
      revision: 4,
      kind: 'named',
      name: 'my checkpoint',
      createdAt: '2026-08-16T13:00:00.000Z',
    };
    let getCalls = 0;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots' && (!init || init.method === undefined)) {
        getCalls += 1;
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      if (url === '/diagrams/diagram-1/snapshots' && init?.method === 'POST') {
        expect(init.body).toBe(JSON.stringify({ name: 'my checkpoint' }));
        return Promise.resolve(jsonResponse(201, { snapshot: created }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.change(screen.getByLabelText('Nome do snapshot (opcional)'), {
      target: { value: 'my checkpoint' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar snapshot' }));

    const rows = await waitFor(() => {
      const all = screen.getAllByTestId('history-item');
      expect(all).toHaveLength(4);
      return all;
    });
    expect(rows[0]?.textContent).toContain('my checkpoint');
    expect(getCalls).toBe(1);
  });

  it('SNAP-04: creating with a blank name POSTs a body with no name field', async () => {
    const created = {
      id: 'snap-new2',
      revision: 4,
      kind: 'named',
      name: null,
      createdAt: '2026-08-16T13:30:00.000Z',
    };
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots' && init?.method === 'POST') {
        expect(init.body).toBe(JSON.stringify({}));
        return Promise.resolve(jsonResponse(201, { snapshot: created }));
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getByRole('button', { name: 'Criar snapshot' }));

    await waitFor(() => expect(screen.getAllByTestId('history-item')).toHaveLength(4));
  });

  it('a create failure announces the generic create error, without inserting anything', async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(403, {}));
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getByRole('button', { name: 'Criar snapshot' }));

    expect(await screen.findByText('Não foi possível criar o snapshot.')).toBeTruthy();
    expect(screen.getAllByTestId('history-item')).toHaveLength(3);
  });

  it('SNAP-05: an empty snapshot list renders the empty-state explanation, not a blank list', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: [] })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    expect(
      await screen.findByText(
        'Nenhum snapshot ainda. Snapshots automáticos aparecem conforme você edita o diagrama.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('history-item')).toBeNull();
  });

  it('a list fetch failure shows the generic history error, not a crash', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, {})),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeTruthy();
  });
});

describe('HistoryPanel restore flow (T3, SNAP-06..10)', () => {
  // jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` — same shim as
  // `ConfirmArchiveDialog.spec.tsx`/`RestoreConfirmDialog.spec.tsx`.
  beforeAll(() => {
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

  it('SNAP-10: the restore action is hidden entirely when canMutate is false', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={false}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );

    await screen.findAllByTestId('history-item');
    expect(screen.queryByText('Restaurar')).toBeNull();
  });

  it('SNAP-06: clicking restore opens a dialog naming that it creates a new revision without deleting anything', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);

    expect(screen.getByTestId('restore-confirm-confirm')).not.toBeNull();
    expect(
      screen.getByText(
        'Restaurar cria uma revisão nova a partir deste snapshot — nenhuma revisão intermediária é apagada, tudo continua na linha do tempo.',
      ),
    ).toBeTruthy();
  });

  it('SNAP-07/08: confirming restores with a generated clientMutationId, applies via onRestored on 200, and shows the new revision', async () => {
    const onRestored = vi.fn(async () => {});
    let restoreBody: unknown;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        restoreBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return Promise.resolve(
          jsonResponse(200, { currentRevision: 9, restoredFromSnapshotId: 'snap-3' }),
        );
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={onRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(restoreBody).toMatchObject({
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(await screen.findByText('Restaurado. Nova revisão: 9.')).toBeTruthy();
    // The dialog closed after resolving.
    expect(screen.queryByTestId('restore-confirm-confirm')).toBeNull();
  });

  it('SNAP-09: a 404 on restore says the snapshot no longer exists and relists, without calling onRestored', async () => {
    const onRestored = vi.fn(async () => {});
    let listCalls = 0;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        return Promise.resolve(jsonResponse(404, { title: 'snapshot not found' }));
      }
      if (url === '/diagrams/diagram-1/snapshots' && !init) {
        listCalls += 1;
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={onRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');
    expect(listCalls).toBe(1);

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    expect(
      await screen.findByText('Esse snapshot não existe mais. A lista foi atualizada.'),
    ).toBeTruthy();
    expect(onRestored).not.toHaveBeenCalled();
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it('edge case: a non-404 restore failure (e.g. 403, role revoked mid-session) shows the failure and never calls onRestored', async () => {
    const onRestored = vi.fn(async () => {});
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        return Promise.resolve(jsonResponse(403, {}));
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={onRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    expect(await screen.findByText('Não foi possível restaurar o snapshot.')).toBeTruthy();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('edge case: clicking confirm twice before the first response resolves reuses the same clientMutationId', async () => {
    let resolveRestore: ((response: Response) => void) | undefined;
    const restoreBodies: unknown[] = [];
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        restoreBodies.push(init?.body ? JSON.parse(init.body as string) : undefined);
        return new Promise<Response>((resolve) => {
          resolveRestore = resolve;
        });
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    expect(restoreBodies).toHaveLength(2);
    const [first, second] = restoreBodies as Array<{ clientMutationId: string }>;
    expect(first?.clientMutationId).toBe(second?.clientMutationId);

    resolveRestore?.(jsonResponse(200, { currentRevision: 10, restoredFromSnapshotId: 'snap-3' }));
  });

  it('edge case: an unsaved create-name is preserved across the relist a restore triggers', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        return Promise.resolve(
          jsonResponse(200, { currentRevision: 9, restoredFromSnapshotId: 'snap-3' }),
        );
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    fireEvent.change(screen.getByLabelText('Nome do snapshot (opcional)'), {
      target: { value: 'draft name not yet submitted' },
    });

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    await waitFor(() => expect(screen.getByText('Restaurado. Nova revisão: 9.')).toBeTruthy());
    expect((screen.getByLabelText('Nome do snapshot (opcional)') as HTMLInputElement).value).toBe(
      'draft name not yet submitted',
    );
  });

  it('SNAP-14: the create-snapshot and restore actions are keyboard-focusable', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    const createButton = screen.getByRole('button', { name: 'Criar snapshot' });
    createButton.focus();
    expect(document.activeElement).toBe(createButton);

    const restoreButton = screen.getAllByText('Restaurar')[0] as HTMLElement;
    restoreButton.focus();
    expect(document.activeElement).toBe(restoreButton);
  });

  it('SNAP-15: a successful restore announcement lives inside the aria-live="polite" region', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots/snap-3:restore') {
        return Promise.resolve(
          jsonResponse(200, { currentRevision: 9, restoredFromSnapshotId: 'snap-3' }),
        );
      }
      return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
    }) as unknown as typeof fetch;

    render(
      <HistoryPanel
        diagramId="diagram-1"
        canMutate={true}
        onRestored={noopRestored}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findAllByTestId('history-item');

    const region = screen.getByTestId('history-announcement');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    fireEvent.click(screen.getAllByText('Restaurar')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('restore-confirm-confirm'));

    await waitFor(() => expect(region.textContent).toBe('Restaurado. Nova revisão: 9.'));
  });
});
