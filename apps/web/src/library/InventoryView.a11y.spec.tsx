import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx`/`AiDock.a11y.spec.tsx` do.
import '../i18n/index.js';
import { InventoryView } from './InventoryView.js';

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

const ROWS = [
  {
    elementId: 'el-1',
    elementType: 'rectangle',
    semanticType: 'service',
    metadataJson: {},
    revision: 1,
  },
  { elementId: 'el-2', elementType: null, semanticType: 'database', metadataJson: {}, revision: 2 },
];

afterEach(() => {
  cleanup();
});

describe('InventoryView (T8, CLIB-18..20 a11y)', () => {
  it('the populated table state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: ROWS }),
    ) as unknown as typeof fetch;
    const { container } = render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText('el-1')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the empty state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;
    const { container } = render(<InventoryView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await waitFor(() =>
      expect(screen.getByText('Nenhum elemento foi classificado ainda.')).not.toBeNull(),
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
