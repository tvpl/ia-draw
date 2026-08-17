import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffView } from './DiffView.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

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

const SNAPSHOTS = [
  { id: 'snap-2', revision: 2, kind: 'auto', name: null, createdAt: '2026-08-16T11:00:00.000Z' },
  { id: 'snap-1', revision: 1, kind: 'auto', name: null, createdAt: '2026-08-16T10:00:00.000Z' },
];

afterEach(() => {
  cleanup();
});

describe('DiffView (T6, SNAP-14..16)', () => {
  it('the compare picker has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS })),
    ) as unknown as typeof fetch;
    const { container } = render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await screen.findByRole('button', { name: 'Comparar' });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('a rendered diff with all four categories has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: SNAPSHOTS }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          from: 'snap-1',
          to: 'snap-2',
          added: ['el-a'],
          removed: ['el-b'],
          moved: ['el-c'],
          modified: ['el-d'],
        }),
      );
    }) as unknown as typeof fetch;
    const { container } = render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);
    await screen.findByRole('button', { name: 'Comparar' });

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));
    await screen.findByText('el-a');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the disabled (fewer-than-two-points) state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { snapshots: [SNAPSHOTS[0]] })),
    ) as unknown as typeof fetch;
    const { container } = render(<DiffView diagramId="diagram-1" fetchImpl={fetchImpl} />);

    await screen.findByText('É preciso pelo menos dois pontos na linha do tempo para comparar.');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
