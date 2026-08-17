import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from (same convention as `MetadataPanel.spec.tsx`/`LibraryPanel.spec.tsx`). Default language
// is pt-BR, so assertions below use the pt-BR strings.
import '../i18n/index.js';
import { LintPanel } from './LintPanel.js';
import type { LintWarning } from './lintClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ORPHAN_WARNING: LintWarning = {
  rule: 'orphan-component',
  severity: 'warning',
  message: '1 componente(s) sem nenhum edge conectado.',
  elementIds: ['el-live', 'el-removed'],
};

afterEach(() => {
  cleanup();
});

describe('LintPanel (ALNT-01..07: ver os avisos)', () => {
  it('ALNT-01: shows a loading state, then calls GET /diagrams/:id/lint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [] }),
    ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    expect(screen.getByText('Carregando avisos…')).not.toBeNull();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/lint'));
  });

  it('ALNT-02: lists each warning with its rule AND its message verbatim from the server', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('1 componente(s) sem nenhum edge conectado.')).not.toBeNull(),
    );
    expect(screen.getByTestId('lint-warning-rule').textContent).toBe('orphan-component');
  });

  it('ALNT-03: an empty warnings array shows an explicit success state, not an ambiguous empty list', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [] }),
    ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Nenhum aviso para este diagrama.')).not.toBeNull(),
    );
  });

  it('ALNT-04: a non-200 response shows an error state, never throwing or breaking the panel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os avisos de lint.')).not.toBeNull(),
    );
  });

  it('ALNT-05: clicking "Atualizar" re-fetches and replaces the shown list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { warnings: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
      ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Nenhum aviso para este diagrama.')).not.toBeNull(),
    );

    fireEvent.click(screen.getByText('Atualizar'));

    await waitFor(() =>
      expect(screen.getByText('1 componente(s) sem nenhum edge conectado.')).not.toBeNull(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('LintPanel (ALNT-08..12: saltar para o elemento)', () => {
  it('ALNT-08/09: offers a jump control per live elementId and calls onJumpToElement with that id', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    const onJumpToElement = vi.fn();
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={onJumpToElement}
        fetchImpl={fetchImpl}
      />,
    );

    const jumpButton = await screen.findByRole('button', { name: /el-live/ });
    fireEvent.click(jumpButton);

    expect(onJumpToElement).toHaveBeenCalledWith('el-live');
    expect(onJumpToElement).toHaveBeenCalledTimes(1);
  });

  it('ALNT-10: an elementId absent from liveElementIds is shown without a clickable jump control', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await screen.findByText(/el-removed/);
    expect(screen.queryByRole('button', { name: /el-removed/ })).toBeNull();
  });

  it('ALNT-04 (jump AC5): a click never fires any request — onJumpToElement is the only side effect', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { warnings: [ORPHAN_WARNING] }));
    const onJumpToElement = vi.fn();
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={onJumpToElement}
        fetchImpl={fetchMock as unknown as typeof fetch}
      />,
    );

    const jumpButton = await screen.findByRole('button', { name: /el-live/ });
    const callsBeforeClick = fetchMock.mock.calls.length;
    fireEvent.click(jumpButton);

    expect(fetchMock.mock.calls.length).toBe(callsBeforeClick);
  });

  it('ALNT-11: announces the jump result in the aria-live region', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    const jumpButton = await screen.findByRole('button', { name: /el-live/ });
    fireEvent.click(jumpButton);

    await waitFor(() =>
      expect(screen.getByTestId('lint-announcement').textContent).toBe(
        'Foco movido para o elemento el-live.',
      ),
    );
  });
});

describe('LintPanel — diagram switch', () => {
  it('re-fetches for a new diagramId when the prop changes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [] }),
    ) as unknown as typeof fetch;
    const { rerender } = render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/lint'));

    rerender(
      <LintPanel
        diagramId="diagram-2"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-2/lint'));
  });
});
