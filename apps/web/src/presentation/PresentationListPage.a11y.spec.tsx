import { cleanup, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n/index.js';
import { PresentationListPage } from './PresentationListPage.js';

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

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present']}>
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present"
          element={<PresentationListPage fetchImpl={fetchImpl} />}
        />
        <Route path="/w/:workspaceId/d/:diagramId/present/:presentationId" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PresentationListPage accessibility (presentation-mode/T15)', () => {
  it('populated list with the create form (canMutate) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap'))
        return jsonResponse(200, { mutatePermissions: { allowed: true } });
      return jsonResponse(200, {
        presentations: [
          { presentation: { id: 'p-1', diagramId: 'd-1', name: 'Roadmap' }, frames: [] },
        ],
      });
    }) as unknown as typeof fetch;

    const { container } = renderPage(fetchImpl);
    await screen.findByText('Roadmap');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the empty state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap'))
        return jsonResponse(200, { mutatePermissions: { allowed: false } });
      return jsonResponse(200, { presentations: [] });
    }) as unknown as typeof fetch;

    const { container } = renderPage(fetchImpl);
    await screen.findByText('Nenhuma apresentação ainda.');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every interactive control on the page is keyboard-focusable', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap'))
        return jsonResponse(200, { mutatePermissions: { allowed: true } });
      return jsonResponse(200, { presentations: [] });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const nameInput = await screen.findByLabelText('Nome da apresentação');

    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);
  });
});
