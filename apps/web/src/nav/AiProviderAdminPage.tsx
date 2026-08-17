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
  const replaceItem = store((s) => s.replaceItem);

  const [notFound, setNotFound] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [createBaseUrl, setCreateBaseUrl] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createToken, setCreateToken] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editToken, setEditToken] = useState('');

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

  function startEdit(item: ProviderConfig): void {
    setEditingId(item.id);
    setEditBaseUrl(item.baseUrl);
    setEditModel(item.model);
    // Never prefilled: the server does not return the key, so there is nothing
    // to prefill it with, and an empty field is exactly what "keep the current
    // key" means on submit (PROV-13/15).
    setEditToken('');
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditToken('');
  }

  async function submitEdit(item: ProviderConfig): Promise<void> {
    const result = await client.update(item.id, {
      baseUrl: editBaseUrl.trim(),
      model: editModel.trim(),
      // An empty field omits `token` entirely, which is what makes the server
      // leave the stored ciphertext untouched (PROV-13).
      token: editToken.length > 0 ? editToken : undefined,
    });

    if (result.status === 'ok') {
      replaceItem(item.id, result.config);
      setEditingId(null);
      setEditToken('');
      setAnnouncement(t('adminProviders.updated'));
      return;
    }
    // PROV-16: the list keeps the previous values — nothing is replaced on failure.
    setAnnouncement(t('nav.error.generic'));
  }

  async function toggleEnabled(item: ProviderConfig, enabled: boolean): Promise<void> {
    const result = await client.update(item.id, { enabled });

    if (result.status === 'ok') {
      // PROV-22: the server enforces "at most one enabled per scope" inside the
      // same transaction, so the list mirrors that here instead of showing two
      // active configs until the next reload. Every page instance is scoped to a
      // single scope, so every other item in this list is a sibling of the one
      // just enabled.
      setItems(
        items.map((current) => {
          if (current.id === item.id) return result.config;
          return enabled ? { ...current, enabled: false } : current;
        }),
      );
      setAnnouncement(enabled ? t('adminProviders.activated') : t('adminProviders.deactivated'));
      return;
    }
    setAnnouncement(t('nav.error.generic'));
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
              </span>{' '}
              {editingId === item.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitEdit(item);
                  }}
                >
                  <label htmlFor="provider-edit-base-url">{t('adminProviders.baseUrlLabel')}</label>
                  <input
                    id="provider-edit-base-url"
                    value={editBaseUrl}
                    onChange={(event) => setEditBaseUrl(event.target.value)}
                  />

                  <label htmlFor="provider-edit-model">{t('adminProviders.modelLabel')}</label>
                  <input
                    id="provider-edit-model"
                    value={editModel}
                    onChange={(event) => setEditModel(event.target.value)}
                  />

                  <label htmlFor="provider-edit-token">{t('adminProviders.keyLabel')}</label>
                  <input
                    id="provider-edit-token"
                    type="password"
                    autoComplete="off"
                    value={editToken}
                    onChange={(event) => setEditToken(event.target.value)}
                  />
                  <p>{t('adminProviders.keyKeepHint')}</p>

                  <button type="submit">{t('adminProviders.save')}</button>
                  <button type="button" onClick={cancelEdit}>
                    {t('adminProviders.cancel')}
                  </button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => startEdit(item)}>
                    {t('adminProviders.edit')}
                  </button>
                  <button type="button" onClick={() => void toggleEnabled(item, !item.enabled)}>
                    {item.enabled ? t('adminProviders.deactivate') : t('adminProviders.activate')}
                  </button>
                </>
              )}
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
