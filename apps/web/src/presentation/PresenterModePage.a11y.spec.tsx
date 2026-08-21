import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { PresenterModePage } from './PresenterModePage.js';

expect.extend(toHaveNoViolations);

type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: () => null,
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const presentation = { id: 'p-1', diagramId: 'd-1', name: 'Roadmap', publishedSnapshotId: 'snap-1' };
const threeFrames = [
  { id: 'f-1', presentationId: 'p-1', elementId: null, frameId: 'a', position: 0, notes: null, navLinksJson: [] },
  { id: 'f-2', presentationId: 'p-1', elementId: null, frameId: 'b', position: 1, notes: null, navLinksJson: [{ targetFrameId: 'f-1' }] },
  { id: 'f-3', presentationId: 'p-1', elementId: null, frameId: 'c', position: 2, notes: null, navLinksJson: [] },
];

function baseFetch(): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames: threeFrames });
    if (url === '/diagrams/d-1/bootstrap') return jsonResponse(200, { scene: [] });
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present/p-1/presenter']}>
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId/presenter"
          element={<PresenterModePage fetchImpl={fetchImpl} />}
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={<div data-testid="editor-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

describe('PresenterModePage accessibility (T21, PRZ-46/47/48)', () => {
  it('has zero serious/critical axe violations once loaded', async () => {
    const { container } = renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('navigates frame 1 through the last frame and exits, using only the keyboard', async () => {
    renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');
    const shell = screen.getByTestId('presenter-shell');

    const exitButton = screen.getByRole('button', { name: 'Sair do modo apresentador' });
    exitButton.focus();
    expect(document.activeElement).toBe(exitButton);

    fireEvent.keyDown(shell, { key: 'ArrowRight' });
    await screen.findByText('Frame 2 de 3');
    fireEvent.keyDown(shell, { key: 'ArrowRight' });
    await screen.findByText('Frame 3 de 3');

    fireEvent.keyDown(shell, { key: 'Escape' });
    expect(await screen.findByTestId('editor-page')).not.toBeNull();
  });

  it('renders correctly in the en locale', async () => {
    await i18n.changeLanguage('en');
    renderPage(baseFetch());

    expect(await screen.findByText('Frame 1 of 3')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Exit presenter mode' })).not.toBeNull();
  });
});
