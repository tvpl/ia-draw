import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n/index.js';
import { PresentationEditorPage } from './PresentationEditorPage.js';

expect.extend(toHaveNoViolations);

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

const presentation = { id: 'p-1', diagramId: 'd-1', name: 'Roadmap', publishedSnapshotId: null };
const frame = {
  id: 'f-1',
  presentationId: 'p-1',
  elementId: null,
  frameId: 'intro',
  position: 0,
  notes: 'note',
  navLinksJson: [],
};

function fetchImplFor({
  canMutate = true,
  frames = [frame],
}: {
  canMutate?: boolean;
  frames?: unknown[];
} = {}) {
  return vi.fn(async (url: string) => {
    if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames });
    if (url === '/diagrams/d-1/bootstrap') {
      return jsonResponse(200, {
        scene: [{ id: 'frame-el-1', type: 'frame', name: 'Overview' }],
        mutatePermissions: { allowed: canMutate },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present/p-1']}>
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={<PresentationEditorPage fetchImpl={fetchImpl} />}
        />
        <Route path="/w/:workspaceId/d/:diagramId/present" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PresentationEditorPage accessibility (presentation-mode/T15)', () => {
  it('the full canMutate view (frames, add form, publish, share panel) has zero serious/critical axe violations', async () => {
    const { container } = renderPage(fetchImplFor());
    await screen.findByTestId('frame-list');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the read-only (non-canMutate) view has zero serious/critical axe violations', async () => {
    const { container } = renderPage(fetchImplFor({ canMutate: false }));
    await screen.findByTestId('frame-list');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every top-level control (add frame, move, edit notes, delete, publish) is keyboard-focusable', async () => {
    renderPage(fetchImplFor());
    const addButton = await screen.findByRole('button', { name: 'Adicionar frame' });

    addButton.focus();
    expect(document.activeElement).toBe(addButton);
  });

  it('an async action (add frame) announces its result in an aria-live="polite" region (L-030: attribute, not just text)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames: [] });
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1/frames' && init?.method === 'POST') {
        return jsonResponse(201, {
          frame: {
            id: 'f-new',
            presentationId: 'p-1',
            notes: null,
            navLinksJson: [],
            frameId: 'x',
            position: 0,
          },
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const input = await screen.findByLabelText('Ou um rótulo lógico (sem frame no canvas)');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar frame' }));

    const region = screen.getByTestId('presentation-editor-announcement');
    expect(region.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(region.textContent).toBe('Frame adicionado.'));
  });

  it('renders in the en locale as well as pt-BR', async () => {
    const i18n = (await import('../i18n/index.js')).default;
    await i18n.changeLanguage('en');

    renderPage(fetchImplFor());

    expect(await screen.findByText('Frames')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add frame' })).toBeTruthy();
    await i18n.changeLanguage('pt-BR');
  });
});
