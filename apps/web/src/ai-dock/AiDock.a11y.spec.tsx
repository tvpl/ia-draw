import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiDock } from './AiDock.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` (read its header comment for the
// full Knowledge Verification Chain) — `seriousOrCriticalViolations` is duplicated here
// rather than imported, since that file doesn't export it (T8's own "Reuses" line points
// at the pattern, not a shared module).
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

const PREVIEW = {
  added: ['el-1', 'el-2', 'el-3'],
  removed: ['el-0'],
  moved: ['el-4'],
  modified: ['el-5'],
  metadataChanged: ['el-6'],
};

afterEach(() => {
  cleanup();
});

describe('AiDock (T8, DOCK-21..23)', () => {
  it('idle/collapsed state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { container } = render(
      <AiDock
        diagramId="diagram-1"
        canMutate
        selection={[]}
        onApproved={vi.fn(async () => {})}
        fetchImpl={fetchImpl}
      />,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('awaiting_approval state with a non-trivial preview has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          run: { id: 'run-a11y-1', status: 'awaiting_approval' },
          patch: {},
          preview: PREVIEW,
          requiresExplicitApproval: true,
        }),
      ),
    ) as unknown as typeof fetch;
    const { container } = render(
      <AiDock
        diagramId="diagram-1"
        canMutate
        selection={[]}
        onApproved={vi.fn(async () => {})}
        fetchImpl={fetchImpl}
      />,
    );

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw three services' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('error state with an errorCode has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(424, {})),
    ) as unknown as typeof fetch;
    const { container } = render(
      <AiDock
        diagramId="diagram-1"
        canMutate
        selection={[]}
        onApproved={vi.fn(async () => {})}
        fetchImpl={fetchImpl}
      />,
    );

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw three services' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
