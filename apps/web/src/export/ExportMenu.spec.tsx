import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below use the pt-BR
// strings ("Exportar", "Gerar exports", ...).
import '../i18n/index.js';
import { ExportMenu } from './ExportMenu.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FORMATS_BODY = {
  exportId: 'exp-1',
  revision: 5,
  formats: {
    excalidraw: {
      url: 'https://storage.example/exp-1/scene.excalidraw',
      checksum: 'sha256:a',
      sizeBytes: 512,
      contentType: 'application/json',
    },
    svg: {
      url: 'https://storage.example/exp-1/scene.svg',
      checksum: 'sha256:b',
      sizeBytes: 2048,
      contentType: 'image/svg+xml',
    },
    png: {
      url: 'https://storage.example/exp-1/scene.png',
      checksum: 'sha256:c',
      sizeBytes: 1536 * 1024,
      contentType: 'image/png',
    },
    pdf: {
      url: 'https://storage.example/exp-1/scene.pdf',
      checksum: 'sha256:d',
      sizeBytes: 4096,
      contentType: 'application/pdf',
    },
  },
};

function openMenu() {
  fireEvent.click(screen.getByText('Exportar'));
}

describe('ExportMenu (T2, XPRT-01..04)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a single click on generate sends exactly one POST and shows all 4 download links with formatted sizeBytes (XPRT-01)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, FORMATS_BODY)),
    ) as unknown as typeof fetch;

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar exports' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/exports',
      expect.objectContaining({ method: 'POST' }),
    );

    // sizeBytes formatted: 512 B, 2.0 KB, 1.5 MB, 4.0 KB
    expect(screen.getByText(/512 B/)).not.toBeNull();
    expect(screen.getByText(/2\.0 KB/)).not.toBeNull();
    expect(screen.getByText(/1\.5 MB/)).not.toBeNull();
    expect(screen.getByText(/4\.0 KB/)).not.toBeNull();

    // XPRT-17: the successful generation is announced too, not just failures.
    expect(screen.getByTestId('export-menu-announcement').textContent).toBe('Exports prontos');
  });

  it('each link opens the signed URL directly (XPRT-02)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, FORMATS_BODY)),
    ) as unknown as typeof fetch;

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar exports' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4));

    const links = screen.getAllByRole('link') as HTMLAnchorElement[];
    const hrefs = links.map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('https://storage.example/exp-1/scene.excalidraw');
    expect(hrefs).toContain('https://storage.example/exp-1/scene.svg');
    expect(hrefs).toContain('https://storage.example/exp-1/scene.png');
    expect(hrefs).toContain('https://storage.example/exp-1/scene.pdf');
    // No product-server round trip for the download itself — every href is the signed
    // storage URL returned by the API, not a path back into this app.
    for (const href of hrefs) {
      expect(href?.startsWith('https://storage.example/')).toBe(true);
    }
  });

  it('a 429 response shows the "wait" message without throwing or blocking the rest of the page (XPRT-03)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(429, { title: 'Too Many Requests' })),
    ) as unknown as typeof fetch;

    render(
      <>
        <ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />
        <button type="button">rest of editor</button>
      </>,
    );
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar exports' }));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        screen.getByText('Muitas solicitações de export — aguarde um momento e tente de novo.'),
      ).not.toBeNull(),
    );
    // The rest of the editor stays interactive.
    expect(screen.getByRole('button', { name: 'rest of editor' })).not.toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('disables the generate button while a generation is in flight (XPRT-04)', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    const button = screen.getByRole('button', { name: 'Gerar exports' });
    expect(button).not.toHaveProperty('disabled', true);

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveProperty('disabled', true));

    await act(async () => {
      resolveFetch(jsonResponse(200, FORMATS_BODY));
      await Promise.resolve();
    });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
  });

  it('clicking "Exportar Mermaid" sends one POST /diagrams/:id/export:mermaid and downloads diagram-<id>.mmd via Blob (INT-01)', async () => {
    const dsl = 'flowchart TD\n  A --> B';
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { dsl, limitations: [] })),
    ) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendedAnchors: HTMLAnchorElement[] = [];
    const originalAppendChild = document.body.appendChild.bind(document.body);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) appendedAnchors.push(node);
      return originalAppendChild(node);
    });

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exportar Mermaid' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/export:mermaid',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [blobArg] = createObjectURL.mock.calls[0] as unknown as [Blob];
    await expect(blobArg.text()).resolves.toBe(dsl);
    expect(appendedAnchors).toHaveLength(1);
    expect(appendedAnchors[0]?.download).toBe('diagram-diagram-1.mmd');
    expect(appendedAnchors[0]?.href).toBe('blob:mock-url');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
    appendChildSpy.mockRestore();
  });

  it('clicking "Exportar Structurizr" sends one POST .../export:structurizr and downloads diagram-<id>.dsl (INT-02)', async () => {
    const dsl = 'workspace { ... }';
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { dsl, limitations: [] })),
    ) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendedAnchors: HTMLAnchorElement[] = [];
    const originalAppendChild = document.body.appendChild.bind(document.body);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) appendedAnchors.push(node);
      return originalAppendChild(node);
    });

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exportar Structurizr' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/export:structurizr',
      expect.objectContaining({ method: 'POST' }),
    );

    expect(appendedAnchors).toHaveLength(1);
    expect(appendedAnchors[0]?.download).toBe('diagram-diagram-1.dsl');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    appendChildSpy.mockRestore();
  });

  it('shows non-empty limitations next to the Mermaid button after a successful export (INT-03)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, {
          dsl: 'flowchart TD\n  A --> B',
          limitations: ["edge 'conn' mode 'data' has no Mermaid equivalent"],
        }),
      ),
    ) as unknown as typeof fetch;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exportar Mermaid' }));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByText("edge 'conn' mode 'data' has no Mermaid equivalent")).not.toBeNull(),
    );
  });

  it('shows an explicit "no limitations" confirmation when the export returns an empty array (INT-03)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { dsl: 'flowchart TD\n  A --> B', limitations: [] })),
    ) as unknown as typeof fetch;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exportar Mermaid' }));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByText('Nenhuma limitação de round-trip relatada.')).not.toBeNull(),
    );
  });

  it('a non-200 DSL export response announces a generic error in the shared aria-live region, without downloading (INT-04)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, { title: 'boom' })),
    ) as unknown as typeof fetch;
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Exportar Mermaid' }));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('export-menu-announcement').textContent).toBe(
        'Não foi possível exportar. Tente novamente.',
      ),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('the Mermaid and Structurizr export buttons disable independently of each other and of "Gerar exports" (INT-05)', async () => {
    let resolveMermaid: (response: Response) => void = () => {};
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/export:mermaid') {
        return new Promise<Response>((resolve) => {
          resolveMermaid = resolve;
        });
      }
      return Promise.resolve(jsonResponse(200, { dsl: 'workspace { ... }', limitations: [] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    const mermaidButton = screen.getByRole('button', { name: 'Exportar Mermaid' });
    const structurizrButton = screen.getByRole('button', { name: 'Exportar Structurizr' });
    const generateButton = screen.getByRole('button', { name: 'Gerar exports' });

    fireEvent.click(mermaidButton);
    await waitFor(() => expect(mermaidButton).toHaveProperty('disabled', true));
    expect(structurizrButton).toHaveProperty('disabled', false);
    expect(generateButton).toHaveProperty('disabled', false);

    await act(async () => {
      resolveMermaid(jsonResponse(200, { dsl: 'flowchart TD\n  A --> B', limitations: [] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mermaidButton).toHaveProperty('disabled', false));
  });

  it('the generate button and every download link are keyboard-focusable (XPRT-16)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, FORMATS_BODY)),
    ) as unknown as typeof fetch;

    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    const generateButton = screen.getByRole('button', { name: 'Gerar exports' });
    generateButton.focus();
    expect(document.activeElement).toBe(generateButton);

    await act(async () => {
      fireEvent.click(generateButton);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4));

    for (const link of screen.getAllByRole('link')) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });

  it('the Mermaid and Structurizr export buttons are keyboard-focusable (INT-16)', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    render(<ExportMenu diagramId="diagram-1" fetchImpl={fetchImpl} />);
    openMenu();

    for (const name of ['Exportar Mermaid', 'Exportar Structurizr']) {
      const button = screen.getByRole('button', { name });
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });
});
