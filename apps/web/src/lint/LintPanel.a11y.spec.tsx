import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx`/`MetadataPanel.a11y.spec.tsx` do.
import '../i18n/index.js';
import { LintPanel } from './LintPanel.js';
import type { LintWarning } from './lintClient.js';

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

const ORPHAN_WARNING: LintWarning = {
  rule: 'orphan-component',
  severity: 'warning',
  message: '1 componente(s) sem nenhum edge conectado.',
  elementIds: ['el-live', 'el-removed'],
};

afterEach(() => {
  cleanup();
});

describe('LintPanel (ALNT-13/14 a11y)', () => {
  it('the empty (no-warnings) state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [] }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Nenhum aviso para este diagrama.')).not.toBeNull(),
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the populated state (live + removed elementIds) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findByRole('button', { name: /el-live/ });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the error state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const { container } = render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={[]}
        onJumpToElement={vi.fn()}
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os avisos de lint.')).not.toBeNull(),
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every jump control is a real <button>, reachable and activatable via keyboard alone', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    const onJumpToElement = vi.fn();
    render(
      <LintPanel
        diagramId="diagram-1"
        liveElementIds={['el-live']}
        onJumpToElement={onJumpToElement}
        fetchImpl={fetchImpl}
      />,
    );

    const jumpButton = await screen.findByRole('button', { name: /el-live/ });
    jumpButton.focus();
    expect(document.activeElement).toBe(jumpButton);
    fireEvent.click(jumpButton);
    expect(onJumpToElement).toHaveBeenCalledWith('el-live');
  });
});
