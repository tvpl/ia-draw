import type { LibraryItem, LibraryManifest } from '@arch-canvas/library-content';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx`/`AiDock.a11y.spec.tsx` do.
import '../i18n/index.js';
import { LibraryPanel } from './LibraryPanel.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` (Knowledge Verification Chain) —
// duplicated here rather than imported, matching `AiDock.a11y.spec.tsx`'s own convention.
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

const SERVER_ITEM: LibraryItem = {
  stableKey: 'generic.compute.server',
  name: 'Server',
  category: 'compute',
  aliases: ['host'],
  description: 'Generic compute host.',
  tags: ['compute'],
  color: '#4B5563',
  icon: { kind: 'inline', svg: '<svg></svg>' },
  version: '1.0.0',
  license: 'CC0-1.0',
  attribution: 'Architecture Canvas project',
};

function manifest(items: LibraryItem[]): LibraryManifest {
  return { name: 'test-manifest', version: '1.0.0', items };
}

const GLOBAL_ROW = {
  id: 'lib-global',
  workspaceId: null,
  name: 'core',
  version: '1.0.0',
  license: 'CC0-1.0',
  manifestJson: manifest([SERVER_ITEM]),
  enabled: true,
};

afterEach(() => {
  cleanup();
});

describe('LibraryPanel (T8, CLIB-18..20 a11y)', () => {
  it('the loaded, writable state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the read-only state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;
    const { container } = render(
      <LibraryPanel canWrite={false} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );
    await waitFor(() => expect(screen.getByText('Server')).not.toBeNull());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the error-with-retry state has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const { container } = render(
      <LibraryPanel canWrite={true} onInsert={vi.fn()} fetchImpl={fetchImpl} />,
    );
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar a biblioteca.')).not.toBeNull(),
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
