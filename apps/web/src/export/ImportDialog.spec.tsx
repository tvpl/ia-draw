import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below use the pt-BR
// strings ("Importar diagrama", "Confirmar import", ...).
import '../i18n/index.js';
import { ImportDialog } from './ImportDialog.js';

/**
 * Same jsdom `<dialog>` shim as `ConfirmArchiveDialog.spec.tsx`/`WorkspaceListPage.spec.tsx` —
 * jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` at all.
 */
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDialog(overrides: Partial<{ canImport: boolean; fetchImpl: typeof fetch }> = {}) {
  const fetchImpl = overrides.fetchImpl ?? (vi.fn() as unknown as typeof fetch);
  let capturedPath: string | null = null;

  const utils = render(
    <MemoryRouter initialEntries={['/w/ws-1/p/project-1']}>
      <Routes>
        <Route
          path="/w/:workspaceId/p/:projectId"
          element={
            <ImportDialog
              projectId="project-1"
              workspaceId="ws-1"
              canImport={overrides.canImport ?? true}
              fetchImpl={fetchImpl}
            />
          }
        />
        <Route
          path="/w/:workspaceId/d/:diagramId"
          element={
            <TargetProbe
              onRender={(path) => {
                capturedPath = path;
              }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  return { ...utils, fetchImpl, getCapturedPath: () => capturedPath };
}

function TargetProbe({ onRender }: { onRender: (path: string) => void }) {
  const location = useLocation();
  onRender(location.pathname);
  return <p data-testid="editor-probe">editor</p>;
}

function selectFile(content: string, name = 'scene.excalidraw'): void {
  const input = screen.getByLabelText('Arquivo') as HTMLInputElement;
  const file = new File([content], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportDialog (T4, XPRT-07..12)', () => {
  it('selecting a file reads it as text, calls previewImport, and shows elementCount (XPRT-07)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } })),
    ) as unknown as typeof fetch;
    renderDialog({ fetchImpl });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());
    expect(fetchImpl).toHaveBeenCalledWith(
      '/projects/project-1/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileContent: '{"elements":[{},{},{}],"appState":{}}' }),
      }),
    );
  });

  it('a 400 for malformed/unrecognized JSON shows the server message and blocks confirmation (XPRT-08)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(400, { title: 'malformed .excalidraw file: invalid JSON' })),
    ) as unknown as typeof fetch;
    renderDialog({ fetchImpl });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('not json');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByText('malformed .excalidraw file: invalid JSON')).not.toBeNull(),
    );
    // No confirm control is offered — a title field never appears without a valid preview.
    expect(screen.queryByLabelText('Título do diagrama')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar import' })).toBeNull();
  });

  it('a 400 for exceeding the element limit shows the server message, never truncating and importing partially (XPRT-09)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(400, {
          title: '.excalidraw file has 25000 elements, exceeding the 20000-element import limit',
        }),
      ),
    ) as unknown as typeof fetch;
    renderDialog({ fetchImpl });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          '.excalidraw file has 25000 elements, exceeding the 20000-element import limit',
        ),
      ).not.toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Confirmar import' })).toBeNull();
  });

  it('confirming with a title calls confirmImport with confirm:true and navigates to the created diagram (XPRT-10)', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.confirm) {
        return Promise.resolve(
          jsonResponse(201, {
            preview: { elementCount: 3, appState: {} },
            diagram: { id: 'diagram-9', projectId: 'project-1', title: 'Imported' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } }));
    }) as unknown as typeof fetch;

    const { getCapturedPath } = renderDialog({ fetchImpl });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Título do diagrama'), {
      target: { value: 'Imported' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar import' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/projects/project-1/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fileContent: '{"elements":[{},{},{}],"appState":{}}',
          confirm: true,
          title: 'Imported',
        }),
      }),
    );
    await waitFor(() => expect(getCapturedPath()).toBe('/w/ws-1/d/diagram-9'));
  });

  it('a successful import confirmation announces success in the aria-live region (XPRT-17)', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.confirm) {
        return Promise.resolve(
          jsonResponse(201, {
            preview: { elementCount: 3, appState: {} },
            diagram: { id: 'diagram-9', projectId: 'project-1', title: 'Imported' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } }));
    }) as unknown as typeof fetch;

    // Rendered unconditionally (not gated behind a matched <Route>, unlike the production
    // mount inside `ProjectListPage`) so this test can observe the announcement text the
    // component sets right before `navigate()` fires, instead of losing it to the immediate
    // unmount a real route-gated mount causes once navigation lands on an unmatched path.
    render(
      <MemoryRouter initialEntries={['/w/ws-1/p/project-1']}>
        <ImportDialog projectId="project-1" workspaceId="ws-1" canImport fetchImpl={fetchImpl} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Título do diagrama'), {
      target: { value: 'Imported' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar import' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('import-announcement').textContent).toBe('Diagrama importado'),
    );
  });

  it('confirming with a blank title never sends the confirmation request (XPRT-11)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } })),
    );
    renderDialog({ fetchImpl: fetchImpl as unknown as typeof fetch });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    const confirmButton = screen.getByRole('button', { name: 'Confirmar import' });
    expect(confirmButton).toHaveProperty('disabled', true);

    const callCountBeforeSubmit = fetchImpl.mock.calls.length;
    fireEvent.click(confirmButton);
    await Promise.resolve();

    expect(fetchImpl.mock.calls.length).toBe(callCountBeforeSubmit);
  });

  it('submitting the form directly with a blank title still never sends the confirmation request (XPRT-11)', async () => {
    // Same scenario as above, but bypasses the disabled submit button entirely (a disabled
    // native <button> never dispatches click/submit in jsdom, same as real browsers) —
    // proves `handleConfirm`'s own guard blocks the request independently of the button's
    // `disabled` attribute, not just via that attribute.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } })),
    );
    const { container } = renderDialog({ fetchImpl: fetchImpl as unknown as typeof fetch });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));
    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    const form = container.querySelector('form');
    if (!form) throw new Error('expected the preview form to be rendered');
    const callCountBeforeSubmit = fetchImpl.mock.calls.length;

    fireEvent.submit(form);
    await Promise.resolve();

    expect(fetchImpl.mock.calls.length).toBe(callCountBeforeSubmit);
  });

  it('the import trigger is absent when the role lacks diagram:write on the project (XPRT-12)', () => {
    renderDialog({ canImport: false });

    expect(screen.queryByRole('button', { name: 'Importar diagrama' })).toBeNull();
  });

  it('the file input and the confirm button are keyboard-focusable (XPRT-16)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { preview: { elementCount: 3, appState: {} } })),
    ) as unknown as typeof fetch;
    renderDialog({ fetchImpl });

    fireEvent.click(screen.getByRole('button', { name: 'Importar diagrama' }));

    const fileInput = screen.getByLabelText('Arquivo');
    fileInput.focus();
    expect(document.activeElement).toBe(fileInput);

    await act(async () => {
      selectFile('{"elements":[{},{},{}],"appState":{}}');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('3 elementos serão importados')).not.toBeNull());

    fireEvent.change(screen.getByLabelText('Título do diagrama'), {
      target: { value: 'Imported' },
    });
    const confirmButton = screen.getByRole('button', { name: 'Confirmar import' });
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
  });
});
