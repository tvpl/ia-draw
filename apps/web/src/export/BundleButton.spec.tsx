import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below use the pt-BR
// strings ("Baixar bundle", "Gerando bundle…").
import '../i18n/index.js';
import { BundleButton } from './BundleButton.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BundleButton (T3, XPRT-05/06)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('clicking sends POST /diagrams/:id/bundle and opens the returned url on 200 (XPRT-05)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, {
          bundleId: 'bundle-1',
          url: 'https://storage.example/bundle-1.zip',
          sizeBytes: 4096,
          manifest: { files: ['scene.excalidraw'] },
        }),
      ),
    ) as unknown as typeof fetch;
    const openUrl = vi.fn();

    render(<BundleButton diagramId="diagram-1" fetchImpl={fetchImpl} openUrl={openUrl} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Baixar bundle' }));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://storage.example/bundle-1.zip'),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/bundle',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // XPRT-17: the successful generation is announced too, not just failures.
    expect(screen.getByTestId('bundle-button-announcement').textContent).toBe('Bundle pronto');
  });

  it('shows a loading indicator on the button while the bundle is generating (XPRT-06)', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    const openUrl = vi.fn();

    render(<BundleButton diagramId="diagram-1" fetchImpl={fetchImpl} openUrl={openUrl} />);

    fireEvent.click(screen.getByRole('button', { name: 'Baixar bundle' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Gerando bundle…' })).not.toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Gerando bundle…' })).toHaveProperty(
      'disabled',
      true,
    );

    await act(async () => {
      resolveFetch(
        jsonResponse(200, {
          bundleId: 'bundle-1',
          url: 'https://storage.example/bundle-1.zip',
          sizeBytes: 4096,
          manifest: {},
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Baixar bundle' })).not.toBeNull(),
    );
  });
});
