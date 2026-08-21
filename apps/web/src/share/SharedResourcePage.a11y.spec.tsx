import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// every other *.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { SharedResourcePage } from './SharedResourcePage.js';

expect.extend(toHaveNoViolations);

// jsdom cannot mount the real canvas — same mocking convention as
// `SharedResourcePage.spec.tsx` and every other spec touching the editor.
vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return { ...actual, Excalidraw: () => null };
});

// Same rationale/library choice as `shell.a11y.spec.tsx`, duplicated here rather than
// imported, matching every other *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * No `AuthProvider` anywhere in this tree — deliberately, and unlike every prior
 * wave's a11y spec. This IS the assertion of AD-012/SHR-13 at the a11y layer: the
 * public view has to be renderable, and accessible, in a context that has no
 * session machinery at all.
 */
function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/share/tok-1']}>
      <Routes>
        <Route path="/share/:token" element={<SharedResourcePage fetchImpl={fetchImpl} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function diagramFetch(): typeof fetch {
  return vi.fn(async () =>
    jsonResponse(200, {
      resourceType: 'diagram',
      role: 'viewer',
      scene: [{ id: 'el-1', type: 'rectangle', version: 1, versionNonce: 1 }],
      revision: 2,
    }),
  ) as unknown as typeof fetch;
}

function publishedPresentationFetch(): typeof fetch {
  return vi.fn(async () =>
    jsonResponse(200, {
      resourceType: 'presentation',
      role: 'viewer',
      presentation: { id: 'p-1', name: 'Roadmap' },
      frames: [
        {
          id: 'f-1',
          position: 0,
          elementId: 'frame-a',
          frameId: null,
          notes: null,
          navLinksJson: [],
        },
        {
          id: 'f-2',
          position: 1,
          elementId: 'frame-b',
          frameId: null,
          notes: null,
          navLinksJson: [],
        },
      ],
      scene: [
        { id: 'frame-a', type: 'frame', version: 1, versionNonce: 1 },
        { id: 'frame-b', type: 'frame', version: 1, versionNonce: 1 },
      ],
      published: true,
    }),
  ) as unknown as typeof fetch;
}

describe('SharedResourcePage accessibility (T7, SHR-29, SHR-31)', () => {
  it('the diagram state has zero serious/critical axe violations', async () => {
    const { container } = renderPage(diagramFetch());

    await screen.findByTestId('share-read-only-notice');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the invalid-link state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const { container } = renderPage(fetchImpl);

    await screen.findByText('Este link é inválido, expirou ou foi revogado.');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the presentation placeholder state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        resourceType: 'presentation',
        role: 'viewer',
        presentation: { id: 'p-1', name: 'Roadmap' },
        frames: [],
      }),
    ) as unknown as typeof fetch;
    const { container } = renderPage(fetchImpl);

    await screen.findByRole('heading', { name: 'Apresentação: Roadmap' });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every interactive control on the page is keyboard-focusable (SHR-29)', async () => {
    renderPage(diagramFetch());
    await screen.findByTestId('share-read-only-notice');

    const languageSelect = screen.getByLabelText('Idioma');
    languageSelect.focus();
    expect(document.activeElement).toBe(languageSelect);
  });

  it('renders in the en locale as well as pt-BR (SHR-31)', async () => {
    await i18n.changeLanguage('en');
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    renderPage(fetchImpl);

    expect(await screen.findByText('This link is invalid, expired or revoked.')).toBeTruthy();
  });

  it('the published-presentation frame-viewer state has zero serious/critical axe violations (T23)', async () => {
    const { container } = renderPage(publishedPresentationFetch());
    await screen.findByText('Frame 1 de 2');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('frame navigation in the published state is reachable only by keyboard, with no AuthProvider mounted (T23)', async () => {
    renderPage(publishedPresentationFetch());
    await screen.findByText('Frame 1 de 2');

    const next = screen.getByRole('button', { name: 'Próximo' });
    next.focus();
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);

    expect(await screen.findByText('Frame 2 de 2')).toBeTruthy();
  });
});
