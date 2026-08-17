import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ImportDialog } from './ImportDialog.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/duplication convention as every other `*.a11y.spec.tsx` in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

// Same jsdom `<dialog>` shim as `ConfirmArchiveDialog.spec.tsx`/`ImportDialog.spec.tsx`.
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

describe('ImportDialog (XPRT-16..18)', () => {
  it('the open dialog with a preview showing has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } })),
    ) as unknown as typeof fetch;

    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/p/project-1']}>
        <Routes>
          <Route
            path="/w/:workspaceId/p/:projectId"
            element={
              <ImportDialog
                projectId="project-1"
                workspaceId="ws-1"
                canImport
                fetchImpl={fetchImpl}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    const input = screen.getByLabelText('Arquivo') as HTMLInputElement;
    const file = new File(['{"elements":[{},{},{}],"appState":{}}'], 'scene.excalidraw', {
      type: 'application/json',
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the open dialog with the Mermaid format selected and a preview showing has zero serious/critical axe violations (INT-15)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/p/project-1']}>
        <Routes>
          <Route
            path="/w/:workspaceId/p/:projectId"
            element={
              <ImportDialog
                projectId="project-1"
                workspaceId="ws-1"
                canImport
                fetchImpl={fetchImpl}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Mermaid' }));
    const input = screen.getByLabelText('Arquivo Mermaid/Structurizr') as HTMLInputElement;
    const file = new File(['flowchart TD\n  A --> B'], 'diagram.mmd', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByLabelText('Prévia do arquivo')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
