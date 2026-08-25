import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ESTB-07..11: the recovery screen a route falls back to when one of its
 * components throws during render.
 *
 * Split from the boundary itself because a class component cannot call
 * `useTranslation()` — the boundary owns the catching, this owns the rendering.
 * `role="alert"` so a screen reader announces the failure rather than leaving
 * the person on a page that silently stopped being the page they asked for.
 */
function RecoveryScreen(): JSX.Element {
  const { t } = useTranslation();

  return (
    <div role="alert">
      <h2>{t('errorBoundary.title')}</h2>
      <p>{t('errorBoundary.message')}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {t('errorBoundary.reload')}
      </button>
    </div>
  );
}

export interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

/**
 * ESTB-07..09: one boundary per route (mounted in `App.tsx`), never a single
 * global one — a global boundary would take the app shell down with the route,
 * leaving no navigation out of the broken screen.
 *
 * Deliberately does NOT retry on its own: a component that just threw during
 * render tends to throw again immediately, and an automatic re-render turns one
 * failure into a loop. The person decides, via the reload action.
 *
 * Nothing here reports to an external service; the exception and the component
 * stack go to the console once, which is where the React error #185 that
 * motivated this boundary was visible all along.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Route render failed', error, errorInfo.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) return <RecoveryScreen />;
    return this.props.children;
  }
}
