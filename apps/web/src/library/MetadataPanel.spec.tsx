import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from (same convention as `LibraryPanel.spec.tsx`/`AiDock.spec.tsx`). Default language is
// pt-BR, so assertions below use the pt-BR strings.
import '../i18n/index.js';
import { MetadataPanel } from './MetadataPanel.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SAVED_METADATA = {
  diagramId: 'diagram-1',
  elementId: 'el-1',
  semanticType: 'service',
  metadataJson: { owner: 'team-a' },
  revision: 2,
};

afterEach(() => {
  cleanup();
});

describe('MetadataPanel (CLIB-08..13)', () => {
  it('CLIB-08: selecting one element fetches its metadata and shows the populated form', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: SAVED_METADATA }),
    ) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service'),
    );
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/elements/el-1/metadata');
    const jsonField = screen.getByLabelText('Metadados (JSON)') as HTMLTextAreaElement;
    expect(JSON.parse(jsonField.value)).toEqual({ owner: 'team-a' });
  });

  it('CLIB-09: a 404 (not yet classified) shows a blank form, never an error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-new']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe(''),
    );
    expect(
      screen.queryByText('Não foi possível carregar ou salvar os metadados. Tente novamente.'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeNull();
  });

  it('CLIB-10: saving reflects only the value the server returns, never the just-typed value', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        // Server normalizes/overrides what was sent — the panel must display THIS, not
        // the locally-typed "draft-type" the user entered.
        return jsonResponse(200, {
          metadata: { ...SAVED_METADATA, semanticType: 'database', revision: 3 },
        });
      }
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe(''),
    );

    fireEvent.change(screen.getByLabelText('Tipo semântico'), {
      target: { value: 'draft-type' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('database'),
    );
    expect(screen.getByTestId('metadata-announcement').textContent).toBe('Metadados salvos');
  });

  it('CLIB-19: a failed save (e.g. role revoked mid-session, 403) announces the generic error via aria-live, never silently', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse(403, {});
      return jsonResponse(200, { metadata: SAVED_METADATA });
    }) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(screen.getByTestId('metadata-announcement').textContent).toBe(
        'Não foi possível carregar ou salvar os metadados. Tente novamente.',
      ),
    );
    // Never optimistic: the field the failed save reflects is still the last known-good
    // server value, not silently blanked or left in some undefined state.
    expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service');
  });

  it('CLIB-11: canWrite=false renders the fetched values read-only, no form/save button', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: SAVED_METADATA }),
    ) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={false}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => expect(screen.getByText('service')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByLabelText('Tipo semântico')).toBeNull();
  });

  it('CLIB-12: no selection shows the empty state, and it stays mounted (not removed)', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const { rerender } = render(
      <MetadataPanel diagramId="diagram-1" selection={[]} canWrite={true} fetchImpl={fetchImpl} />,
    );
    expect(
      screen.getByText('Selecione um elemento para ver ou editar seus metadados.'),
    ).not.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    rerender(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1', 'el-2']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    expect(
      screen.getByText('Selecione um elemento para ver ou editar seus metadados.'),
    ).not.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CLIB-13: switching selection while the form has unsaved edits discards them without confirmation', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('el-1')) return jsonResponse(200, { metadata: SAVED_METADATA });
      return jsonResponse(200, {
        metadata: { ...SAVED_METADATA, elementId: 'el-2', semanticType: 'database' },
      });
    }) as unknown as typeof fetch;

    const { rerender } = render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service'),
    );

    // Unsaved edit — never saved.
    fireEvent.change(screen.getByLabelText('Tipo semântico'), {
      target: { value: 'unsaved-edit' },
    });
    expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe(
      'unsaved-edit',
    );

    // No confirmation dialog appears anywhere — the selection just changes.
    rerender(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-2']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('database'),
    );
    expect(screen.queryByText('unsaved-edit')).toBeNull();
  });

  it('edge case: invalid JSON in the metadata field is rejected client-side — PATCH is never called', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe(''),
    );

    fireEvent.change(screen.getByLabelText('Metadados (JSON)'), {
      target: { value: 'not valid json {' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByText('Os metadados precisam ser um JSON válido.')).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the initial GET, never a PATCH
  });

  it('design.md Error Handling Strategy: an unexpected GET failure (not 404) shows a generic error, never an uncaught rejection', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível carregar ou salvar os metadados. Tente novamente.'),
      ).not.toBeNull(),
    );
  });

  it('CLIB-18: the semantic-type field and the "Salvar" button are keyboard-focusable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: SAVED_METADATA }),
    ) as unknown as typeof fetch;

    render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service'),
    );

    const semanticTypeField = screen.getByLabelText('Tipo semântico');
    semanticTypeField.focus();
    expect(document.activeElement).toBe(semanticTypeField);

    const saveButton = screen.getByRole('button', { name: 'Salvar' });
    saveButton.focus();
    expect(document.activeElement).toBe(saveButton);
  });
});
