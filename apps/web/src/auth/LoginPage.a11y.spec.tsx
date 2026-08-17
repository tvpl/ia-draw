// T7 (SSO-19..21) — mirrors `shell.a11y.spec.tsx`'s pattern: `jest-axe` +
// `seriousOrCriticalViolations` filtering axe-core's raw `violations` down to
// `impact === 'serious' | 'critical'` before asserting, per that file's own
// disclosure on why (task AC is narrower than "zero violations at any
// impact"). See `shell.a11y.spec.tsx` for the full library-choice rationale
// — not repeated here.
//
// `LoginPage` takes no props (design.md) and reads session state from a real
// `AuthProvider` mounted above it — a stubbed global `fetch` drives it to
// `anonymous` quickly (401 on `/me` and `/auth/refresh`) so the form itself
// renders, exactly like this spec needs.

import { cleanup, render, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same as
// `shell.a11y.spec.tsx`.
import '../i18n/index.js';
import { AuthProvider } from './AuthProvider.js';
import { LoginPage } from './LoginPage.js';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubAnonymousSession(oidcConfigured: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
      if (url === '/auth/refresh') return Promise.resolve(jsonResponse(401, {}));
      if (url === '/auth/oidc/status') {
        return Promise.resolve(jsonResponse(200, { configured: oidcConfigured }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch,
  );
}

function renderLoginAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>root</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage (T7, SSO-19..21)', () => {
  it('idle form state has zero serious/critical axe violations', async () => {
    stubAnonymousSession(true);

    const { container } = renderLoginAt('/login');
    await waitFor(() => expect(container.querySelector('#login-email')).toBeTruthy());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('error state (?error=oidc_failed) has zero serious/critical axe violations', async () => {
    stubAnonymousSession(false);

    const { container } = renderLoginAt('/login?error=oidc_failed');
    await waitFor(() => expect(container.querySelector('#login-email')).toBeTruthy());

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});
