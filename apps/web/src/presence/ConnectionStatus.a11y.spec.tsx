import { act, cleanup, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// shell.a11y.spec.tsx / WorkspaceMembersPage.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { CONNECTION_PHASES, createPresenceStore } from './presenceStore.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as shell.a11y.spec.tsx (read its header comment for the
// full Knowledge Verification Chain) — duplicated here rather than imported, matching
// every other *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(async () => {
  cleanup();
  // Restores the default locale in case the LIVE-27 test below switched it and failed
  // before switching back.
  await i18n.changeLanguage('pt-BR');
});

describe('ConnectionStatus accessibility (T11, LIVE-25..27)', () => {
  it('has zero serious or critical axe violations in every connection phase (LIVE-26)', async () => {
    for (const phase of CONNECTION_PHASES) {
      const { container, unmount } = render(
        <ConnectionStatus store={createPresenceStore(phase)} />,
      );
      const results = await axe(container);
      expect(seriousOrCriticalViolations(results)).toEqual([]);
      unmount();
    }
  });

  it('adds nothing to the tab order — it is a status region, not a control (LIVE-26)', () => {
    const { container } = render(<ConnectionStatus store={createPresenceStore('disconnected')} />);

    const focusable = container.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]',
    );
    expect(focusable).toHaveLength(0);

    const region = screen.getByTestId('presence-connection-status');
    expect(region.hasAttribute('tabindex')).toBe(false);
    region.focus();
    expect(document.activeElement).not.toBe(region);
  });

  it('announces the new phase through an aria-live="polite" region (LIVE-25)', () => {
    const store = createPresenceStore('connected');
    render(<ConnectionStatus store={store} />);

    const region = screen.getByTestId('presence-connection-status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Presença ao vivo conectada');

    act(() => {
      store.getState().setConnection('disconnected');
    });

    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Presença ao vivo desconectada');
  });

  it('renders in the en locale as well as pt-BR (LIVE-27)', async () => {
    await i18n.changeLanguage('en');
    render(<ConnectionStatus store={createPresenceStore('disconnected')} />);

    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Live presence disconnected',
    );
  });
});
