import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffView } from './DiffView.js';
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
    name: 'latest',
    createdAt: '2026-08-16T12:00:00.000Z',
  },
  { id: 'snap-2', revision: 2, kind: 'auto', name: null, createdAt: '2026-08-16T11:00:00.000Z' },
  { id: 'snap-1', revision: 1, kind: 'auto', name: null, createdAt: '2026-08-16T10:00:00.000Z' },
];

afterEach(() => {
  cleanup();
});

describe('DiffView (T4, SNAP-11..13)', () => {
  it('SNAP-11: selecting two points and comparing renders the four categorized lists by elementId', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      if (url === '/diagrams/diagram-1/diff?from=snap-1&to=snap-3') {
        return Promise.resolve(
          jsonResponse(200, {
            from: 'snap-1',
            to: 'snap-3',
            added: ['el-added'],
            removed: ['el-removed'],
            moved: ['el-moved'],
            modified: ['el-modified'],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    // Defaults to comparing the two most recent points (index 1 -> index 0): snap-2 -> snap-3.
    await screen.findByRole('button', { name: 'Comparar' });

    fireEvent.change(screen.getByLabelText('De'), { target: { value: 'snap-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText('el-added')).toBeTruthy();
    expect(screen.getByText('el-removed')).toBeTruthy();
    expect(screen.getByText('el-moved')).toBeTruthy();
    expect(screen.getByText('el-modified')).toBeTruthy();
    expect(screen.getByText('Adicionados (1)')).toBeTruthy();
    expect(screen.getByText('Removidos (1)')).toBeTruthy();
    expect(screen.getByText('Movidos (1)')).toBeTruthy();
    expect(screen.getByText('Modificados (1)')).toBeTruthy();
  });

  it('SNAP-12: four empty lists render "no structural changes", never a blank panel', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          from: 'snap-2',
          to: 'snap-3',
          added: [],
          removed: [],
          moved: [],
          modified: [],
        }),
      );
    }) as unknown as typeof fetch;

    render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await screen.findByRole('button', { name: 'Comparar' });

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(
      await screen.findByText('Nenhuma mudança estrutural entre essas duas revisões.'),
    ).toBeTruthy();
  });

  it("SNAP-13: a 404 shows the server's own error message without breaking the panel", async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      return Promise.resolve(
        jsonResponse(404, {
          title: 'diff target "bogus" is neither a known revision nor a known snapshot id',
        }),
      );
    }) as unknown as typeof fetch;

    render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await screen.findByRole('button', { name: 'Comparar' });

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(
      await screen.findByText(
        'diff target "bogus" is neither a known revision nor a known snapshot id',
      ),
    ).toBeTruthy();
    // The panel is still usable — the compare form is still there.
    expect(screen.getByRole('button', { name: 'Comparar' })).not.toBeNull();
  });

  it('edge case: fewer than two points on the timeline disables compare with an explanation', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: [SNAPSHOTS[0]] })),
    ) as unknown as typeof fetch;

    render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText('É preciso pelo menos dois pontos na linha do tempo para comparar.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Comparar' })).toBeNull();
  });

  it('a list fetch failure shows the generic history error, not a crash', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, {})),
    ) as unknown as typeof fetch;

    render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeTruthy();
  });
});
