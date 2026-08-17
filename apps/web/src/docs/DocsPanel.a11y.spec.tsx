import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { DocsPanel } from './DocsPanel.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `HistoryPanel.a11y.spec.tsx` — `seriousOrCriticalViolations`
// is duplicated here rather than imported, matching that file's own convention.
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

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const SPEC = {
  id: 'spec-1',
  diagramId: 'diagram-1',
  sourceRevision: 1,
  version: 1,
  markdownKey: 'diagrams/diagram-1/specs/1.md',
  status: 'current' as const,
  generatedBy: 'user-1',
  createdAt: '2026-08-17T10:00:00.000Z',
  markdownUrl: 'https://fake-storage.test/exports/diagrams/diagram-1/specs/1.md',
};

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

function fetchWithVersions(specs = [SPEC], nextCursor: number | null = null): typeof fetch {
  return vi.fn((url: string) => {
    if (url === '/diagrams/diagram-1/specs') {
      return Promise.resolve(jsonResponse(200, { specs, nextCursor }));
    }
    if (url === SPEC.markdownUrl) {
      return Promise.resolve(textResponse(200, DOCUMENT_MARKDOWN));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

describe('DocsPanel (T7, LDC-28..30)', () => {
  it('empty-state (read-only) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null })),
    ) as unknown as typeof fetch;
    const { container } = render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={false}
        liveElementIds={[]}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findByText('Nenhum documento gerado ainda.');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('populated list with generate/regenerate controls has zero serious/critical axe violations', async () => {
    const { container } = render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchWithVersions()}
      />,
    );
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    (within(item).getByRole('button', { name: 'Versão 1' }) as HTMLElement).click();
    await screen.findByText('overview body');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('LDC-28: version selection, "Carregar mais", "Gerar documento" and per-section regenerate are all keyboard-focusable', async () => {
    render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchWithVersions([SPEC], 2)}
      />,
    );
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');

    const versionButton = within(item).getByRole('button', { name: 'Versão 1' });
    versionButton.focus();
    expect(document.activeElement).toBe(versionButton);

    const loadMoreButton = screen.getByRole('button', { name: 'Carregar mais' });
    loadMoreButton.focus();
    expect(document.activeElement).toBe(loadMoreButton);

    const generateButton = screen.getByRole('button', { name: 'Gerar documento' });
    generateButton.focus();
    expect(document.activeElement).toBe(generateButton);

    versionButton.click();
    await screen.findByText('overview body');
    const regenerateButtons = screen.getAllByRole('button', { name: 'Regenerar esta seção' });
    expect(regenerateButtons).toHaveLength(4);
    const [firstRegenerate] = regenerateButtons;
    if (!firstRegenerate) throw new Error('no regenerate button rendered');
    (firstRegenerate as HTMLElement).focus();
    expect(document.activeElement).toBe(firstRegenerate);
  });

  it('LDC-29: create/regenerate outcomes are announced in an aria-live=polite region', async () => {
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
    await screen.findByText('Nenhum documento gerado ainda.');

    const liveRegion = screen.getByTestId('docs-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    (screen.getByRole('button', { name: 'Gerar documento' }) as HTMLElement).click();

    await waitFor(() =>
      expect(liveRegion.textContent).toBe('Você não tem permissão para gerar um documento.'),
    );
  });

  it('LDC-30: every visible string comes from i18n — the panel renders correctly in the en locale, switched mid-session', async () => {
    const { rerender } = render(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchWithVersions()}
      />,
    );
    await screen.findAllByTestId('docs-version-item');

    await i18n.changeLanguage('en');
    rerender(
      <DocsPanel
        diagramId="diagram-1"
        canMutate={true}
        liveElementIds={['api']}
        fetchImpl={fetchWithVersions()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Living documentation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate document' })).toBeTruthy();
    const [item] = await screen.findAllByTestId('docs-version-item');
    if (!item) throw new Error('no version item rendered');
    expect(within(item).getByRole('button', { name: 'Version 1' })).toBeTruthy();
    expect(within(item).getByText('Current')).toBeTruthy();

    (within(item).getByRole('button', { name: 'Version 1' }) as HTMLElement).click();
    await screen.findByText('overview body');
    expect(screen.getAllByRole('button', { name: 'Regenerate this section' })).toHaveLength(4);
    expect(screen.getByText('Element: api')).toBeTruthy();
  });
});
