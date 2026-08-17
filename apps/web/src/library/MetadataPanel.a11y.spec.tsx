import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx`/`AiDock.a11y.spec.tsx` do.
import '../i18n/index.js';
import { MetadataPanel } from './MetadataPanel.js';

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

const SAVED_METADATA = {
  diagramId: 'diagram-1',
  elementId: 'el-1',
  semanticType: 'service',
  metadataJson: { owner: 'team-a' },
  revision: 2,
};

afterEach(() => {
  cleanup();
});

describe('MetadataPanel (T8, CLIB-18..20 a11y)', () => {
  it('the empty state (no selection) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { container } = render(
      <MetadataPanel diagramId="diagram-1" selection={[]} canWrite={true} fetchImpl={fetchImpl} />,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the writable form state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: SAVED_METADATA }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={true}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tipo semântico') as HTMLInputElement).value).toBe('service'),
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the read-only state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: SAVED_METADATA }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <MetadataPanel
        diagramId="diagram-1"
        selection={['el-1']}
        canWrite={false}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() => expect(screen.getByText('service')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
