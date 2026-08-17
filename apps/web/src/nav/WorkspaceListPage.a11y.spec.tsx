import { cleanup, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceListPage } from './WorkspaceListPage.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` — `seriousOrCriticalViolations` is
// duplicated here rather than imported, matching the established convention for every
// *.a11y.spec.tsx file in this codebase (none of them export a shared helper module).
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

describe('WorkspaceListPage (T10, NAV-24..26)', () => {
  it('populated list (with rename/archive actions visible) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            id: 'ws-1',
            organizationId: 'org-1',
            name: 'Acme Workspace',
            slug: 'acme',
            accessPolicy: null,
            createdAt: '',
            updatedAt: '',
            role: 'workspace_admin',
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <WorkspaceListPage fetchImpl={fetchImpl} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Acme Workspace' });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
