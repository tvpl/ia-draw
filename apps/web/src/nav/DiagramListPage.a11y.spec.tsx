import { cleanup, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramListPage } from './DiagramListPage.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` — `seriousOrCriticalViolations` is
// duplicated here rather than imported, matching the established convention for every
// *.a11y.spec.tsx file in this codebase.
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

describe('DiagramListPage (T10, NAV-24..26)', () => {
  it('populated list (with create/rename/archive actions visible) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/projects/p-1')
        return jsonResponse(200, {
          project: { id: 'p-1', workspaceId: 'ws-1', name: 'Project One' },
        });
      if (url === '/workspaces/ws-1')
        return jsonResponse(200, {
          workspace: { id: 'ws-1', name: 'Acme Workspace', role: 'editor' },
        });
      if (url === '/diagrams?projectId=p-1')
        return jsonResponse(200, {
          items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/p/p-1']}>
        <Routes>
          <Route
            path="/w/:workspaceId/p/:projectId"
            element={<DiagramListPage fetchImpl={fetchImpl} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Diagram One' });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
