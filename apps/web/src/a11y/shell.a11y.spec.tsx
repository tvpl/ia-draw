// A11Y-01 (T95) disclosure — read before trusting a "0 violations" result:
//
// Library choice (Knowledge Verification Chain, checked against the installed stack —
// Vitest 3.2.4 + jsdom 30 + React 19 — before picking one, not assumed):
//   - `vitest-axe` has never left pre-release (`1.0.0-pre.5` is its latest tag, published
//     Jan 2025, over a year stale at the time of writing) and pins an older `axe-core`
//     (`^4.10.2`).
//   - `@axe-core/react` is designed to inject into a live running page and log violations
//     to the browser console at runtime — not a unit-test assertion library, so it can't
//     fail a `vitest run` the way this task requires ("toda violação séria/crítica...
//     falha o teste").
//   - `jest-axe` (last published within the last month at the time of writing, tracking
//     current `axe-core@4.12.1`) is a plain `expect.extend(...)` custom matcher with zero
//     Jest-runtime coupling — its own README's usage example is literally
//     `expect.extend(toHaveNoViolations)`, which Vitest's Jest-API-compatible `expect`
//     supports natively. That IS the "small compat shim" the task text anticipated: no
//     shim code was actually needed beyond this one `expect.extend` call.
//   `jest-axe` + `@testing-library/react` (16.3.2, the first line to declare a React 19
//   peer range) were picked on that basis.
//
// Severity filtering: `toHaveNoViolations` (jest-axe's own matcher) fails on ANY
// violation regardless of impact. The task's AC is narrower ("zero violações
// sérias/críticas") — `seriousOrCriticalViolations()` below filters axe-core's raw
// `results.violations` to `impact === 'serious' | 'critical'` before asserting, so a
// hypothetical minor/moderate finding would show up in a manual read of `results` but not
// fail this suite on its own. All three real components below currently report zero
// violations at ANY impact level, but the assertion is deliberately written against the
// serious/critical filter, not raw emptiness, to match the AC's actual wording.
//
// Coverage — what this file does NOT check (state this explicitly, never imply total
// coverage): this codebase's `apps/web/src` currently contains exactly four UI files —
// `App.tsx` (routing only), `AppShell.tsx`, `LanguageSwitcher.tsx`, and
// `DiagramEditorPage.tsx` — confirmed by a full directory listing before writing this
// file, not assumed. The product surfaces named in T95's own task text have NO built UI
// yet to scan:
//   - the full editor canvas (Excalidraw's own rendered drawing surface/toolbar/panels) —
//     `DiagramEditorPage`'s `<EditorSurface/>` only mounts after a real `/me` + bootstrap
//     round-trip resolves; this file deliberately stubs `fetch` to stay pending so the
//     component's OWN loading/missing-id chrome can be scanned deterministically, which
//     also means Excalidraw's internal markup is never reached here. (Excalidraw's own
//     accessibility is upstream's responsibility, not this codebase's, in any case.)
//   - the AI generation dock (AIC-01..03) — no React component exists for it yet.
//   - presentation/presenter mode (PRS-01..05) — no React component exists for it yet.
//   - the comments UI (CMT-01/02) — no React component exists for it yet.
// When any of those surfaces gain real UI, they need their own `*.a11y.spec.tsx` file —
// this one only ever covers the four files it explicitly imports below.

import { cleanup, render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../app-shell/AppShell.js';
import { LanguageSwitcher } from '../app-shell/LanguageSwitcher.js';
import { DiagramEditorPage } from '../diagram/DiagramEditorPage.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `main.tsx` does for the real app. Without this, `t()` calls in the
// components below would render raw translation keys instead of real strings.
import '../i18n/index.js';

expect.extend(toHaveNoViolations);

// `@types/jest-axe`'s own published types pin an internal, stale `axe-core@^3.5.5` just
// for its type resolution (unrelated to the REAL `axe-core@4.12.1` jest-axe actually runs
// at runtime — confirmed by reading both packages' own `package.json` dependencies).
// Deriving the result type from `axe`'s own return type (rather than importing
// `AxeResults` from a separately-installed `axe-core`) sidesteps that stale-types-package
// version mismatch entirely while staying exactly as type-safe.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell (T95, A11Y-01)', () => {
  it('has zero serious/critical axe violations', async () => {
    const { container } = render(<AppShell />);
    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});

describe('LanguageSwitcher (T95, A11Y-01)', () => {
  it('has zero serious/critical axe violations', async () => {
    const { container } = render(<LanguageSwitcher />);
    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});

describe('DiagramEditorPage (T95, A11Y-01)', () => {
  beforeEach(() => {
    // A permanently-pending fetch keeps the component in its own real "loading" render
    // path deterministically (never resolves `/me`, so `<EditorSurface/>` never mounts) —
    // see this file's header disclosure for why the Excalidraw canvas itself is out of
    // scope here.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  it('renders the loading state (route params present) with zero serious/critical axe violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-perf-1/d/diagram-perf-1']}>
        <Routes>
          <Route path="/w/:workspaceId/d/:diagramId" element={<DiagramEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('renders the "missing diagram id" state (no route match) with zero serious/critical axe violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <DiagramEditorPage />
      </MemoryRouter>,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });
});

// Deliberately broken — proves this gate is a REAL check, not a rubber stamp, mirroring
// T93's alertRules.spec.ts pattern of feeding the validator a deliberately-malformed input
// and asserting it's rejected rather than only ever exercising the passing path.
function ComponentWithMissingAltText(): JSX.Element {
  return (
    // biome-ignore lint/a11y/useAltText: deliberate — proves the axe-core gate below actually catches a missing alt text violation
    <img src="https://example.com/architecture-diagram-thumbnail.png" width={100} height={100} />
  );
}

describe('deliberately broken fixture (proves the axe gate is real, not a no-op)', () => {
  it('an <img> with no alt text IS reported as a violation by axe-core', async () => {
    const { container } = render(<ComponentWithMissingAltText />);
    const results = await axe(container);

    const violations = seriousOrCriticalViolations(results);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((violation) => violation.id === 'image-alt')).toBe(true);
  });

  it("jest-axe's own toHaveNoViolations matcher actually throws for this fixture", async () => {
    const { container } = render(<ComponentWithMissingAltText />);
    const results = await axe(container);

    // The 3 real-component describes above use expect(...).toEqual([]) against the
    // severity-filtered list; this test additionally proves the underlying jest-axe
    // matcher itself is wired correctly and would fail a naive `toHaveNoViolations()`
    // check too — the gate isn't silently accepting everything at any layer.
    expect(() => expect(results).toHaveNoViolations()).toThrow();
  });
});
