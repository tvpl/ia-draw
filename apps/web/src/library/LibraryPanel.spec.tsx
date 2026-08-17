import type { LibraryItem, LibraryManifest } from '@arch-canvas/library-content';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from (same convention as `WorkspaceListPage.spec.tsx`/`AiDock.spec.tsx`). Default
// language is pt-BR, so assertions below use the pt-BR strings.
import '../i18n/index.js';
import { LibraryPanel } from './LibraryPanel.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SERVER_ITEM: LibraryItem = {
  stableKey: 'generic.compute.server',
  name: 'Server',
  category: 'compute',
  aliases: ['host', 'vm'],
  description: 'Generic compute host.',
  tags: ['compute', 'infra'],
  color: '#4B5563',
  icon: { kind: 'inline', svg: '<svg></svg>' },
  version: '1.0.0',
  license: 'CC0-1.0',
  attribution: 'Architecture Canvas project',
};

const QUEUE_ITEM: LibraryItem = {
  stableKey: 'generic.messaging.queue',
  name: 'Message queue',
  category: 'messaging',
  aliases: ['topic', 'broker'],
  description: 'Generic message queue.',
  tags: ['messaging', 'async'],
  color: '#EA580C',
  icon: { kind: 'inline', svg: '<svg></svg>' },
  version: '1.0.0',
  license: 'CC0-1.0',
  attribution: 'Architecture Canvas project',
};

function manifest(items: LibraryItem[]): LibraryManifest {
  return { name: 'test-manifest', version: '1.0.0', items };
}

const GLOBAL_ROW = {
  id: 'lib-global',
  workspaceId: null,
  name: 'core',
  version: '1.0.0',
  license: 'CC0-1.0',
  manifestJson: manifest([SERVER_ITEM, QUEUE_ITEM]),
  enabled: true,
};

const WORKSPACE_ROW = {
  id: 'lib-ws-1',
  workspaceId: 'ws-1',
  name: 'ws-1-library',
  version: '1.0.0',
  license: 'CC0-1.0',
  // Deliberately re-uses SERVER_ITEM's stableKey — spec.md Edge Cases: "IF o mesmo stableKey
  // existir em mais de uma biblioteca visível THEN o sistema SHALL listar ambos os itens
  // separadamente, sem deduplicar".
  manifestJson: manifest([SERVER_ITEM]),
  enabled: true,
};

afterEach(() => {
  cleanup();
});

describe('LibraryPanel (CLIB-01..07)', () => {
  it('CLIB-01: requests GET /libraries?workspaceId=<id> and lists items grouped by category', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('/libraries?workspaceId=ws-1');
      return jsonResponse(200, { items: [GLOBAL_ROW] });
    }) as unknown as typeof fetch;

    render(
      <LibraryPanel workspaceId="ws-1" canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );

    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());
    expect(screen.getByText('Message queue')).not.toBeNull();
    // Grouped under their own category headings.
    expect(screen.getByRole('heading', { name: 'compute' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'messaging' })).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('CLIB-02: filters by name/aliases/tags client-side without a second network call', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;

    render(<LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Buscar componentes'), {
      target: { value: 'broker' }, // matches QUEUE_ITEM's alias, not SERVER_ITEM
    });

    expect(screen.queryByText('Server')).toBeNull();
    expect(screen.getByText('Message queue')).not.toBeNull();
    // Still exactly one fetch — the filter never triggers a second GET /libraries.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('CLIB-03: clicking "insert" calls onInsert with the full LibraryItem and announces the result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;
    const onInsert = vi.fn();

    render(<LibraryPanel canWrite={true} onInsert={onInsert} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: 'Inserir' })[0] as HTMLElement);

    expect(onInsert).toHaveBeenCalledWith(SERVER_ITEM);
    expect(screen.getByTestId('library-announcement').textContent).toBe(
      'Server inserido no canvas',
    );
  });

  it('CLIB-05: canWrite=false hides every insert button but still lists items (browse-only)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;

    render(<LibraryPanel canWrite={false} onInsert={vi.fn()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    expect(screen.queryByRole('button', { name: 'Inserir' })).toBeNull();
  });

  it('CLIB-06: shows a loading state (never an empty-looking list) while GET /libraries is in flight', () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    render(<LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />);

    expect(screen.getByText('Carregando biblioteca…')).not.toBeNull();
    expect(screen.queryByText('Nenhum componente encontrado para essa busca.')).toBeNull();
  });

  it('CLIB-07: shows an error-with-retry state on failure, and retry re-issues the request', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return jsonResponse(500, {});
      return jsonResponse(200, { items: [GLOBAL_ROW] });
    }) as unknown as typeof fetch;

    render(<LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar a biblioteca.')).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());
    expect(callCount).toBe(2);
  });

  it('search edge case: no match shows the empty-search state, distinct from a genuinely empty library', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;

    render(<LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Buscar componentes'), {
      target: { value: 'nothing-matches-this' },
    });

    expect(screen.getByText('Nenhum componente encontrado para essa busca.')).not.toBeNull();
  });

  it('edge case: the same stableKey in two visible libraries (global + workspace) is listed twice, never deduplicated', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW, WORKSPACE_ROW] }),
    ) as unknown as typeof fetch;

    render(
      <LibraryPanel workspaceId="ws-1" canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );

    await waitFor(() => expect(screen.getAllByText('Server')).toHaveLength(2));
  });

  it('CLIB-18: the "Inserir" button and the retry button are keyboard-focusable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;

    const { rerender } = render(
      <LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    const insertButton = screen.getAllByRole('button', { name: 'Inserir' })[0] as HTMLElement;
    insertButton.focus();
    expect(document.activeElement).toBe(insertButton);

    // A second, independent render for the error state's retry button — a real error
    // response is required to reach it, so this isn't reachable from the same mount above.
    const errorFetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    rerender(<LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={errorFetchImpl} />);
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar a biblioteca.')).not.toBeNull(),
    );
    const retryButton = screen.getByRole('button', { name: 'Tentar de novo' });
    retryButton.focus();
    expect(document.activeElement).toBe(retryButton);
  });
});
