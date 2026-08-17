import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportMenu } from './ExportMenu.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads,
// same convention as `WorkspaceListPage.a11y.spec.tsx`.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/duplication convention as every other `*.a11y.spec.tsx` in this codebase
// (see `shell.a11y.spec.tsx`'s disclosure comment) — no shared helper module exists.
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExportMenu (XPRT-16..18)', () => {
  it('the ready state with 4 download links has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, {
          exportId: 'exp-1',
          revision: 1,
          formats: {
            excalidraw: {
              url: 'https://storage.example/a',
              checksum: 'sha256:a',
              sizeBytes: 100,
              contentType: 'application/json',
            },
            svg: {
              url: 'https://storage.example/b',
              checksum: 'sha256:b',
              sizeBytes: 100,
              contentType: 'image/svg+xml',
            },
            png: {
              url: 'https://storage.example/c',
              checksum: 'sha256:c',
              sizeBytes: 100,
              contentType: 'image/png',
            },
            pdf: {
              url: 'https://storage.example/d',
              checksum: 'sha256:d',
              sizeBytes: 100,
              contentType: 'application/pdf',
            },
          },
        }),
      ),
    ) as unknown as typeof fetch;

    const { container } = render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByText('Exportar'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar exports' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4));

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
