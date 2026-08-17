import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR, so assertions below query the pt-BR strings.
import '../i18n/index.js';

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

    render(<HistoryPanel diagramId="diagram-1" canMutate={false} fetchImpl={fetchImpl} />);

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

    render(<HistoryPanel diagramId="diagram-1" canMutate={false} fetchImpl={fetchImpl} />);

    expect(await screen.findByText('Snapshot sem nome')).toBeTruthy();
  });

  it('SNAP-02: the "create named snapshot" action is hidden when canMutate is false', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(<HistoryPanel diagramId="diagram-1" canMutate={false} fetchImpl={fetchImpl} />);

    await screen.findAllByTestId('history-item');
    expect(screen.queryByRole('button', { name: 'Criar snapshot' })).toBeNull();
  });

  it('SNAP-02: the "create named snapshot" action is visible when canMutate is true', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;

    render(<HistoryPanel diagramId="diagram-1" canMutate={true} fetchImpl={fetchImpl} />);

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

    render(<HistoryPanel diagramId="diagram-1" canMutate={true} fetchImpl={fetchImpl} />);
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

    render(<HistoryPanel diagramId="diagram-1" canMutate={true} fetchImpl={fetchImpl} />);
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

    render(<HistoryPanel diagramId="diagram-1" canMutate={true} fetchImpl={fetchImpl} />);
    await screen.findAllByTestId('history-item');

    fireEvent.click(screen.getByRole('button', { name: 'Criar snapshot' }));

    expect(await screen.findByText('Não foi possível criar o snapshot.')).toBeTruthy();
    expect(screen.getAllByTestId('history-item')).toHaveLength(3);
  });

  it('SNAP-05: an empty snapshot list renders the empty-state explanation, not a blank list', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: [] })),
    ) as unknown as typeof fetch;

    render(<HistoryPanel diagramId="diagram-1" canMutate={false} fetchImpl={fetchImpl} />);

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

    render(<HistoryPanel diagramId="diagram-1" canMutate={false} fetchImpl={fetchImpl} />);

    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeTruthy();
  });
});
