import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from, exactly like `shell.a11y.spec.tsx` does.
import '../i18n/index.js';

function Boom(): JSX.Element {
  throw new Error('component exploded');
}

function Fine(): JSX.Element {
  return <p>healthy child</p>;
}

describe('RouteErrorBoundary (ESTB-07..11)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React itself also logs a caught render error; the spy silences BOTH that and this
    // component's own log, and the assertions below filter to this component's message.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  function ownLogCalls() {
    return consoleErrorSpy.mock.calls.filter((call) => call[0] === 'Route render failed');
  }

  it('renders the children untouched when nothing throws', () => {
    render(
      <RouteErrorBoundary>
        <Fine />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('healthy child')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the recovery screen instead of propagating a render exception (ESTB-07)', () => {
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(screen.queryByText('healthy child')).toBeNull();
  });

  it('exposes role="alert" and a reload action (ESTB-10, ESTB-11)', () => {
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    const reload = screen.getByRole('button');
    expect(alert.contains(reload)).toBe(true);
    expect(reload.tagName).toBe('BUTTON');
    expect(reload.getAttribute('type')).toBe('button');
  });

  it('logs the exception and the component stack exactly once (ESTB-08)', () => {
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    const calls = ownLogCalls();
    expect(calls).toHaveLength(1);
    const [, loggedError, loggedStack] = calls[0] as [string, Error, string];
    expect(loggedError.message).toBe('component exploded');
    expect(typeof loggedStack).toBe('string');
    expect(loggedStack).toContain('Boom');
  });

  it('reloads the current route when the reload action is used (ESTB-10)', () => {
    const reloadSpy = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload: reloadSpy },
    });

    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );
    screen.getByRole('button').click();

    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('takes its text from i18n, never from a literal in the component (ESTB-07)', () => {
    render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );

    // The keys resolve, so no raw key string leaks into the rendered output.
    expect(screen.queryByText('errorBoundary.title')).toBeNull();
    expect(screen.queryByText('errorBoundary.message')).toBeNull();
    expect(screen.queryByText('errorBoundary.reload')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBeTruthy();
  });

  it('keeps no residual state between two separate boundaries (ESTB-11 edge case)', () => {
    const { unmount } = render(
      <RouteErrorBoundary>
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    unmount();

    render(
      <RouteErrorBoundary>
        <Fine />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('healthy child')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
