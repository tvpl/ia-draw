import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { createAiProviderClient, type ProviderConfig } from './aiProviderClient.js';
import { createResourceListStore } from './resourceListStore.js';

const GLOBAL_SCOPE = 'global';

export interface AiProviderAdminPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `WorkspaceMembersPage`). */
  fetchImpl?: typeof fetch;
}

/**
 * The AI provider admin screen, mounted at BOTH `/admin/ai-providers` (scope
 * `"global"`) and `/w/:workspaceId/admin/ai-providers` (scope = that workspace)
 * — design.md's chosen routing shape. The scope is the server's authorization
 * boundary (`assertProviderAdmin`), so it lives in the URL rather than in
 * component state, and this component reads it from `useParams()`.
 *
 * The provider key never comes back from the server in any form, so nothing on
 * this page renders one: only the fields of `ProviderConfig` are displayed, and
 * no masked or derived stand-in is invented (PROV-03).
 */
export function AiProviderAdminPage({ fetchImpl }: AiProviderAdminPageProps): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const scope = workspaceId ?? GLOBAL_SCOPE;
  const backTo = workspaceId ? `/w/${workspaceId}` : '/';
  const { t } = useTranslation();

  const client = useMemo(() => createAiProviderClient(fetchImpl), [fetchImpl]);
  const store = useMemo(() => createResourceListStore<ProviderConfig>(), []);

  const items = store((s) => s.items);
  const status = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const addItem = store((s) => s.addItem);

  const [notFound, setNotFound] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [createBaseUrl, setCreateBaseUrl] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createToken, setCreateToken] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const list = await client.list(scope);
        if (!cancelled) setItems(list);
      } catch {
        // PROV-04: any failure to load the list — 403, 404 or otherwise — is treated as
        // "this scope doesn't exist or you don't have access to it", the same IDOR
        // convention `WorkspaceMembersPage` already uses.
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, scope, setItems]);

  const createDisabled =
    creating ||
    createBaseUrl.trim().length === 0 ||
    createModel.trim().length === 0 ||
    createToken.trim().length === 0;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (createDisabled) return;

    setCreateError(null);
    setCreating(true);
    try {
      const result = await client.create({
        scope,
        baseUrl: createBaseUrl.trim(),
        model: createModel.trim(),
        token: createToken,
      });

      if (result.status === 'created') {
        addItem(result.config);
        setCreateBaseUrl('');
        setCreateModel('');
        setCreateToken('');
        setAnnouncement(t('adminProviders.created'));
        return;
      }
      // PROV-12: a rejected baseUrl keeps every typed value in place so the
      // operator can fix the URL instead of retyping the key.
      const message =
        result.status === 'rejected' ? t('adminProviders.rejectedUrl') : t('nav.error.generic');
      setCreateError(message);
      setAnnouncement(message);
    } finally {
      setCreating(false);
    }
  }

  if (notFound) {
    return (
      <div>
        <Link to={backTo}>{t('nav.back')}</Link>
        <p>{t('nav.notFound')}</p>
      </div>
    );
  }

  return (
    <div>
      <Link to={backTo}>{t('nav.back')}</Link>
      <h2>{t('adminProviders.title')}</h2>
      <p>{workspaceId ? t('adminProviders.workspaceScope') : t('adminProviders.globalScope')}</p>
      <div aria-live="polite" data-testid="ai-provider-announcement">
        {announcement}
      </div>

      {status === 'ready' && items.length === 0 && <p>{t('adminProviders.empty')}</p>}

      {status === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.baseUrl}</span> <span>{item.model}</span>{' '}
              <span data-testid={`ai-provider-state-${item.id}`}>
                {item.enabled ? t('adminProviders.active') : t('adminProviders.inactive')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void handleCreate(event)}>
        <label htmlFor="provider-create-base-url">{t('adminProviders.baseUrlLabel')}</label>
        <input
          id="provider-create-base-url"
          value={createBaseUrl}
          onChange={(event) => setCreateBaseUrl(event.target.value)}
        />

        <label htmlFor="provider-create-model">{t('adminProviders.modelLabel')}</label>
        <input
          id="provider-create-model"
          value={createModel}
          onChange={(event) => setCreateModel(event.target.value)}
        />

        <label htmlFor="provider-create-token">{t('adminProviders.keyLabel')}</label>
        {/* Same shape as `LoginPage`'s password field, but `autoComplete="off"`:
            this is a provider credential being registered, not a login credential
            the browser should offer to remember (PROV-11). */}
        <input
          id="provider-create-token"
          type="password"
          autoComplete="off"
          value={createToken}
          onChange={(event) => setCreateToken(event.target.value)}
        />

        <button type="submit" disabled={createDisabled}>
          {t('adminProviders.create')}
        </button>
        {createError && <p>{createError}</p>}
      </form>
    </div>
  );
}
