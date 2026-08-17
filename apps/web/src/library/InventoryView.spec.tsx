import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from (same convention as `LibraryPanel.spec.tsx`/`MetadataPanel.spec.tsx`). Default
// language is pt-BR, so assertions below use the pt-BR strings.
import '../i18n/index.js';
import { InventoryView } from './InventoryView.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ROWS = [
  {
    elementId: 'el-1',
    elementType: 'rectangle',
    semanticType: 'service',
    metadataJson: {},
    revision: 1,
  },
  { elementId: 'el-2', elementType: null, semanticType: 'database', metadataJson: {}, revision: 2 },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InventoryView (CLIB-14..17)', () => {
  it('CLIB-14: requests GET /diagrams/:id/inventory and lists elementType/semanticType/revision per row', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('/diagrams/diagram-1/inventory?format=json');
      return jsonResponse(200, { items: ROWS });
    }) as unknown as typeof fetch;

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await waitFor(() => expect(screen.getByText('el-1')).not.toBeNull());
    const row1 = screen.getByText('el-1').closest('tr') as HTMLElement;
    expect(row1.textContent).toContain('rectangle');
    expect(row1.textContent).toContain('service');
    expect(row1.textContent).toContain('1');
  });

  it('CLIB-15: an element with elementType: null is marked as removed from the canvas, not hidden', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: ROWS }),
    ) as unknown as typeof fetch;

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await waitFor(() => expect(screen.getByText('el-2')).not.toBeNull());
    const row2 = screen.getByText('el-2').closest('tr') as HTMLElement;
    expect(row2.textContent).toContain('Removido do canvas');
    // Still present — never filtered out of the table.
    expect(screen.getByText('el-2')).not.toBeNull();
  });

  it('CLIB-16: "exportar CSV" calls GET .../inventory?format=csv and drives a client-side Blob download', async () => {
    const csvText =
      'elementId,elementType,semanticType,revision,metadataJson\nel-1,rectangle,service,1,{}';
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/diagrams/diagram-1/inventory?format=csv') {
        return new Response(csvText, { status: 200, headers: { 'content-type': 'text/csv' } });
      }
      return jsonResponse(200, { items: ROWS });
    }) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('el-1')).not.toBeNull());

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/inventory?format=csv'),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));

    // The Blob handed to createObjectURL carries the exact CSV text the server returned.
    const call = createObjectURL.mock.calls[0] as unknown as [Blob];
    const [blobArg] = call;
    await expect(blobArg.text()).resolves.toBe(csvText);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
  });

  it('CLIB-17: an empty inventory (no classified elements yet) shows the empty state, not an error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await waitFor(() =>
      expect(screen.getByText('Nenhum elemento foi classificado ainda.')).not.toBeNull(),
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Não foi possível carregar o inventário.')).toBeNull();
  });

  it('a GET /inventory failure shows the generic error state', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o inventário.')).not.toBeNull(),
    );
  });

  it('CLIB-18: the "Exportar CSV" button is keyboard-focusable', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: ROWS }),
    ) as unknown as typeof fetch;

    render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('el-1')).not.toBeNull());

    const exportButton = screen.getByRole('button', { name: 'Exportar CSV' });
    exportButton.focus();
    expect(document.activeElement).toBe(exportButton);
  });
});
