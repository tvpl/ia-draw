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
});
