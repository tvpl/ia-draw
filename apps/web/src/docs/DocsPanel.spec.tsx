import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocsPanel } from './DocsPanel.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads from.
// Default language is pt-BR, so assertions below query the pt-BR strings.
import '../i18n/index.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function spec(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'spec-1',
    diagramId: 'diagram-1',
    sourceRevision: 1,
    version: 1,
    markdownKey: 'diagrams/diagram-1/specs/1.md',
    status: 'current',
    generatedBy: 'user-1',
    createdAt: '2026-08-17T10:00:00.000Z',
    markdownUrl: 'https://fake-storage.test/exports/diagrams/diagram-1/specs/1.md',
    ...overrides,
  };
}

const DOCUMENT_MARKDOWN = [
  '# Diagram',
  '',
  '## Visão Geral',
  '',
  'overview body',
  '',
  '## Componentes',
  '',
  '- **API** (`api`, tipo: rectangle) — tipo semântico: service',
  '',
  '## Fluxos',
  '',
  'Nenhum fluxo mapeado.',
  '',
  '## Decisões',
  '',
  'pergunta aberta',
  '',
].join('\n');

afterEach(cleanup);

describe('DocsPanel (T5, LDC-01..12, 18/19, 22..29)', () => {
  it('LDC-01: emits GET /diagrams/:id/specs exactly once on mount and lists the returned versions', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [spec()], nextCursor: null }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    const items = await screen.findAllByTestId('docs-version-item');
    expect(items).toHaveLength(1);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls.filter((call) => call[0] === '/diagrams/diagram-1/specs')).toHaveLength(1);
  });

  it('LDC-02: shows the loading message while the initial GET is pending', () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    expect(screen.getByText('Carregando documentação…')).toBeTruthy();
  });

  it('LDC-03: a non-200 GET shows the generic error and keeps the list empty', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, {})),
    ) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar a documentação.')).toBeTruthy(),
    );
    expect(screen.queryAllByTestId('docs-version-item')).toHaveLength(0);
  });

  it('LDC-04: an empty list shows the empty state, distinct from loading/error', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null })),
    ) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());
  });

  it('LDC-05: with a nextCursor, "Carregar mais" fetches the next page and appends it', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(
          jsonResponse(200, { specs: [spec({ id: 'spec-2', version: 2 })], nextCursor: 2 }),
        );
      }
      if (url === '/diagrams/diagram-1/specs?cursor=2') {
        return Promise.resolve(
          jsonResponse(200, { specs: [spec({ id: 'spec-1', version: 1 })], nextCursor: null }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    await screen.findAllByTestId('docs-version-item');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    await waitFor(() => expect(screen.getAllByTestId('docs-version-item')).toHaveLength(2));
  });

  it('LDC-06: "Gerar documento" appears only when canMutate is true', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null })),
    ) as unknown as typeof fetch;

    const { rerender } = render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Gerar documento' })).toBeNull();

    rerender(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    expect(screen.getByRole('button', { name: 'Gerar documento' })).toBeTruthy();
  });

  it('LDC-07/08: generating POSTs :generate with no body and, on 201, prepends+selects the new version without an extra list GET', async () => {
    let listCalls = 0;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/specs') {
        listCalls += 1;
        return Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null }));
      }
      if (url === '/diagrams/diagram-1/specs:generate') {
        expect(init).toEqual({ method: 'POST' });
        return Promise.resolve(jsonResponse(201, { spec: spec() }));
      }
      if (url === spec().markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Gerar documento' }));

    await screen.findAllByTestId('docs-version-item');
    expect(listCalls).toBe(1);
    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());
  });

  it('LDC-09: a 403 on generate announces the permission-denied message', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null }));
      }
      if (url === '/diagrams/diagram-1/specs:generate') {
        return Promise.resolve(jsonResponse(403, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Gerar documento' }));

    await waitFor(() =>
      expect(screen.getByTestId('docs-announcement').textContent).toBe(
        'Você não tem permissão para gerar um documento.',
      ),
    );
  });

  it('LDC-10: any other generate failure announces the generic error', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null }));
      }
      if (url === '/diagrams/diagram-1/specs:generate') {
        return Promise.resolve(jsonResponse(500, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Gerar documento' }));

    await waitFor(() =>
      expect(screen.getByTestId('docs-announcement').textContent).toBe(
        'Algo deu errado. Tente de novo.',
      ),
    );
  });

  it('LDC-11: a second click while generating does not emit a second POST', async () => {
    let generateCalls = 0;
    const pending: { resolve: (() => void) | null } = { resolve: null };
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null }));
      }
      if (url === '/diagrams/diagram-1/specs:generate') {
        generateCalls += 1;
        return new Promise<Response>((resolve) => {
          pending.resolve = () => resolve(jsonResponse(201, { spec: spec() }));
        });
      }
      if (url === spec().markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('Nenhum documento gerado ainda.')).toBeTruthy());

    const button = screen.getByRole('button', { name: 'Gerar documento' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(generateCalls).toBe(1);
    pending.resolve?.();
    await screen.findAllByTestId('docs-version-item');
  });

  it('LDC-12/18: selecting a version fetches its markdownUrl and renders the section content', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [spec()], nextCursor: null }));
      }
      if (url === spec().markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );

    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
    // LDC-13: the loading state is set synchronously, before the `markdownUrl` fetch's promise
    // resolves — visible in the same tick `fireEvent.click` returns, same "assert before await"
    // pattern LDC-02 already uses for the list's own loading state.
    expect(screen.getByText('Carregando conteúdo…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());
  });

  it("LDC-19: switching selection before the first fetch resolves shows only the latest selection's content", async () => {
    const firstSpec = spec({
      id: 'spec-1',
      version: 1,
      markdownUrl: 'https://fake-storage.test/1.md',
    });
    const secondSpec = spec({
      id: 'spec-2',
      version: 2,
      markdownUrl: 'https://fake-storage.test/2.md',
    });
    const pending: { resolve: (() => void) | null } = { resolve: null };

    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(
          jsonResponse(200, { specs: [secondSpec, firstSpec], nextCursor: null }),
        );
      }
      if (url === firstSpec.markdownUrl) {
        return new Promise<Response>((resolve) => {
          pending.resolve = () => resolve(textResponse(200, 'FIRST CONTENT'));
        });
      }
      if (url === secondSpec.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );

    const items = await screen.findAllByTestId('docs-version-item');
    const [secondItem, firstItem] = items;
    if (!secondItem || !firstItem) throw new Error('expected 2 version items');

    fireEvent.click(within(firstItem).getByRole('button', { name: 'Versão 1' }));
    fireEvent.click(within(secondItem).getByRole('button', { name: 'Versão 2' }));

    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());
    pending.resolve?.();
    await Promise.resolve();
    expect(screen.queryByText('FIRST CONTENT')).toBeNull();
    expect(screen.getByText('overview body')).toBeTruthy();
  });

  it('LDC-22..24: regenerating a section POSTs :regenerate-section, prepends+selects the new version, and marks the prior current as superseded', async () => {
    const base = spec();
    const regenerated = spec({
      id: 'spec-2',
      version: 2,
      markdownUrl: 'https://fake-storage.test/2.md',
    });

    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [base], nextCursor: null }));
      }
      if (url === base.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      if (url === '/diagrams/diagram-1/specs/1:regenerate-section') {
        expect(init).toEqual({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ section: 'components' }),
        });
        return Promise.resolve(jsonResponse(201, { spec: regenerated }));
      }
      if (url === regenerated.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );

    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Regenerar esta seção' })[1] as HTMLElement,
    );

    await waitFor(() => expect(screen.getAllByTestId('docs-version-item')).toHaveLength(2));
    const items = screen.getAllByTestId('docs-version-item');
    expect(within(items[0] as HTMLElement).getByText('Atual')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('Substituída')).toBeTruthy();
    expect(screen.getByTestId('docs-announcement').textContent).toBe('Seção regenerada.');
  });

  it('LDC-25: a 403 on regenerate-section announces the permission-denied message and leaves the displayed version unchanged', async () => {
    const base = spec();
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [base], nextCursor: null }));
      }
      if (url === base.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      if (url === '/diagrams/diagram-1/specs/1:regenerate-section') {
        return Promise.resolve(jsonResponse(403, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Regenerar esta seção' })[1] as HTMLElement,
    );

    await waitFor(() =>
      expect(screen.getByTestId('docs-announcement').textContent).toBe(
        'Você não tem permissão para regenerar esta seção.',
      ),
    );
    expect(screen.getAllByTestId('docs-version-item')).toHaveLength(1);
    expect(screen.getByText('overview body')).toBeTruthy();
  });

  it('LDC-26: a 404 on regenerate-section announces "version no longer exists"', async () => {
    const base = spec();
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [base], nextCursor: null }));
      }
      if (url === base.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      if (url === '/diagrams/diagram-1/specs/1:regenerate-section') {
        return Promise.resolve(jsonResponse(404, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Regenerar esta seção' })[1] as HTMLElement,
    );

    await waitFor(() =>
      expect(screen.getByTestId('docs-announcement').textContent).toBe(
        'Essa versão não existe mais.',
      ),
    );
  });

  it('LDC-27: a second click on the same regenerate control while one is in flight does not emit a second POST', async () => {
    const base = spec();
    let regenerateCalls = 0;
    const pending: { resolve: (() => void) | null } = { resolve: null };

    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/specs') {
        return Promise.resolve(jsonResponse(200, { specs: [base], nextCursor: null }));
      }
      if (url === base.markdownUrl) {
        return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
      }
      if (url === '/diagrams/diagram-1/specs/1:regenerate-section') {
        regenerateCalls += 1;
        return new Promise<Response>((resolve) => {
          pending.resolve = () =>
            resolve(jsonResponse(201, { spec: spec({ id: 'spec-2', version: 2 }) }));
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchImpl}
      />,
    );
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
    await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());

    const button = screen.getAllByRole('button', {
      name: 'Regenerar esta seção',
    })[1] as HTMLElement;
    fireEvent.click(button);
    fireEvent.click(button);

    expect(regenerateCalls).toBe(1);
    pending.resolve?.();
  });
});
