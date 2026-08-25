import { cleanup, render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as `shell.a11y.spec.tsx` (read its header comment for the
// full Knowledge Verification Chain) — `seriousOrCriticalViolations` is duplicated here
// rather than imported, matching the convention of every other *.a11y.spec.tsx in this repo.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

function Boom(): JSX.Element {
  throw new Error('component exploded');
}

describe('RouteErrorBoundary accessibility (ESTB-11)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('has no serious or critical violations on the recovery screen', async () => {
    const { container } = render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    const results = await axe(container);

    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
