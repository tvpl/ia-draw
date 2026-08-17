import { EditorSurface } from '@arch-canvas/editor-adapter';
import { type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PublicShell } from './PublicShell.js';
import { createShareLinkClient, type ResolveResult } from './shareLinkClient.js';

export interface SharedResourcePageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as every other page in this app). */
  fetchImpl?: typeof fetch;
}

/**
 * Route `/share/:token` — the product's first page that works with no session at
 * all. Registered OUTSIDE `AuthProvider` (AD-012), so nothing above it can call
 * `GET /me` or redirect to `/login` (SHR-12/13).
 *
 * Four states, all rendered inside `PublicShell`: loading, diagram (the live
 * scene on a read-only canvas), presentation (an explicit placeholder — the real
 * viewer is R12's job), and invalid. `404` folds "unknown token", "expired" and
 * "revoked" into one message, mirroring the server's own IDOR-safe response
 * (SHR-16).
 *
 * The canvas is mounted with `viewModeEnabled` hard-coded to `true`, never
 * derived from the link's role: a link granting `editor` still opens read-only,
 * because R11 ships no write path for an unauthenticated visitor (SHR-19/20).
 * Nothing here constructs a `DiagramSyncClient` or a mutation queue, so no
 * mutation request can be emitted at all (SHR-21).
 */
export function SharedResourcePage({ fetchImpl }: SharedResourcePageProps): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const client = useMemo(() => createShareLinkClient(fetchImpl), [fetchImpl]);

  const [result, setResult] = useState<ResolveResult | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      const resolved = await client.resolve(token);
      if (!cancelled) setResult(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [token, client]);

  if (!token || (result && (result.status === 'not_found' || result.status === 'error'))) {
    return (
      <PublicShell>
        <p>{t('share.public.invalid')}</p>
      </PublicShell>
    );
  }

  if (!result) {
    return (
      <PublicShell>
        <p>{t('share.public.loading')}</p>
      </PublicShell>
    );
  }

  if (result.status === 'presentation') {
    return (
      <PublicShell>
        <h2>{t('share.public.presentationTitle', { name: result.presentation.name })}</h2>
        <p>{t('share.public.presentationUnavailable', { count: result.frameCount })}</p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <p data-testid="share-read-only-notice">{t('share.public.readOnlyNotice')}</p>
      {/* Excalidraw fills its parent's box — the concrete height comes from here,
          same as `DiagramEditorPage`'s own canvas wrapper. */}
      <div style={{ height: '80vh' }}>
        <EditorSurface initialElements={result.scene} viewModeEnabled />
      </div>
    </PublicShell>
  );
}
