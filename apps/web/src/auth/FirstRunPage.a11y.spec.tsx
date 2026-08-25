import { cleanup, render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRunPage } from './FirstRunPage.js';
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

afterEach(cleanup);

describe('FirstRunPage accessibility (BOOT-16)', () => {
  it('has no serious or critical violations', async () => {
    const { container } = render(
      <FirstRunPage
        client={{
          checkAvailability: vi.fn(async () => ({ available: true })),
          submit: vi.fn(async () => ({ status: 'error' as const })),
        }}
      />,
    );

    const results = await axe(container);

    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
