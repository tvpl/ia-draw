import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createPresentationClient, type PresentationWithFrames } from './presentationClient.js';

export interface PresentationListPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as every other page). */
  fetchImpl?: typeof fetch;
}

interface BootstrapResponseBody {
  mutatePermissions?: { allowed: boolean };
}

/**
 * Route `/w/:workspaceId/d/:diagramId/present` (design.md) — an unnested sibling of the
 * diagram editor route, same tier as `/inventory` (T8/component-library). Lists the
 * diagram's presentations (PRZ-01) and, only for a role with `diagram:mutate`, offers
 * creating a new one (PRZ-02..04). `canMutate` is read straight from
 * `GET /diagrams/:id/bootstrap` — the same decision `DiagramEditorPage` already computes,
 * fetched directly here rather than through a full `DiagramSyncClient` (this page never
 * touches scene content, so no queue/status store is needed, design.md).
 */
export function PresentationListPage({
  fetchImpl: fetchImplProp,
}: PresentationListPageProps): JSX.Element | null {
  const { workspaceId, diagramId } = useParams<{ workspaceId: string; diagramId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchImpl = useMemo(() => fetchImplProp ?? fetch.bind(globalThis), [fetchImplProp]);
  const client = useMemo(() => createPresentationClient(fetchImplProp), [fetchImplProp]);

  const [presentations, setPresentations] = useState<PresentationWithFrames[] | null>(null);
  const [canMutate, setCanMutate] = useState(false);
  const [listError, setListError] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!diagramId) return;
    let cancelled = false;

    (async () => {
      const bootstrapResponse = await fetchImpl(`/diagrams/${diagramId}/bootstrap`);
      if (cancelled) return;
      if (bootstrapResponse.ok) {
        const body = (await bootstrapResponse.json()) as BootstrapResponseBody;
        if (!cancelled) setCanMutate(body.mutatePermissions?.allowed ?? false);
      }

      const result = await client.list(diagramId);
      if (cancelled) return;
      if (result.status === 'ok') {
        setPresentations(result.presentations);
      } else {
        setListError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [diagramId, fetchImpl, client]);

  if (!workspaceId || !diagramId) return null;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (inFlight) return;
    const trimmed = name.trim();
    if (!trimmed || !diagramId) return;

    setInFlight(true);
    setCreateError(null);
    try {
      const result = await client.create(diagramId, trimmed);
      if (result.status === 'ok') {
        setAnnouncement(t('presentation.list.announcement.created'));
        navigate(`/w/${workspaceId}/d/${diagramId}/present/${result.presentation.id}`);
        return;
      }
      setCreateError(t('presentation.list.error.generic'));
      setAnnouncement(t('presentation.list.error.generic'));
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div>
      <Link to={`/w/${workspaceId}/d/${diagramId}`}>{t('presentation.list.backToDiagram')}</Link>
      <h2>{t('presentation.list.title')}</h2>
      <div aria-live="polite" data-testid="presentation-list-announcement">
        {announcement}
      </div>

      {listError && <p>{t('presentation.list.error.generic')}</p>}

      {presentations !== null && presentations.length === 0 && !listError && (
        <p>{t('presentation.list.empty')}</p>
      )}

      {presentations !== null && presentations.length > 0 && (
        <ul>
          {presentations.map(({ presentation, frames }) => (
            <li key={presentation.id}>
              <span>{presentation.name}</span>{' '}
              <span>{t('presentation.list.frameCount', { count: frames.length })}</span>{' '}
              <Link to={`/w/${workspaceId}/d/${diagramId}/present/${presentation.id}`}>
                {t('presentation.list.open')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canMutate && (
        <form onSubmit={(event) => void handleCreate(event)}>
          <h3>{t('presentation.list.createTitle')}</h3>
          <label>
            {t('presentation.list.nameLabel')}
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" disabled={inFlight}>
            {t('presentation.list.create')}
          </button>
          {createError && <p>{createError}</p>}
        </form>
      )}
    </div>
  );
}
