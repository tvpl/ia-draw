import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createResourceListStore } from './resourceListStore.js';
import { WebhookSecretPanel } from './WebhookSecretPanel.js';
import {
  createWebhookClient,
  WEBHOOK_EVENT_TYPES,
  type WebhookEndpoint,
  type WebhookEventType,
} from './webhookClient.js';

/** The in-row edit buffer, kept out of the store so a failed `PATCH` leaves the list untouched. */
interface EditDraft {
  url: string;
  events: WebhookEventType[];
}

function sameEvents(a: readonly WebhookEventType[], b: readonly WebhookEventType[]): boolean {
  return a.length === b.length && a.every((event) => b.includes(event));
}

function toggle(events: WebhookEventType[], event: WebhookEventType): WebhookEventType[] {
  return events.includes(event) ? events.filter((it) => it !== event) : [...events, event];
}

export interface WorkspaceWebhooksPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `WorkspaceMembersPage`). */
  fetchImpl?: typeof fetch;
}

/**
 * `/w/:workspaceId/webhooks` route (spec.md) — admin-only workspace webhook management: list,
 * create, edit (URL / events / enabled), rotate secret, remove. Unlike the members screen there
 * is no in-page role gate: every one of the 5 server routes, `GET` included, already requires
 * `workspace:manage_members`, so a non-admin never gets past the list fetch and lands on the
 * shared "doesn't exist or no access" message (WHK-03). The entry link in `ProjectListPage`
 * carries the role check so non-admins are never sent here in the first place (WHK-02).
 *
 * Both paths that reveal a raw secret — creation and rotation — render the same
 * `WebhookSecretPanel`, which holds until dismissed (spec.md's Tech Decision).
 */
export function WorkspaceWebhooksPage({
  fetchImpl: fetchImplProp,
}: WorkspaceWebhooksPageProps): JSX.Element | null {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { t } = useTranslation();

  const client = useMemo(() => createWebhookClient(fetchImplProp), [fetchImplProp]);
  const store = useMemo(() => createResourceListStore<WebhookEndpoint>(), []);

  const items = store((s) => s.items);
  const listStatus = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const addItem = store((s) => s.addItem);
  const removeItem = store((s) => s.removeItem);
  const replaceItem = store((s) => s.replaceItem);

  const [notFound, setNotFound] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [createUrl, setCreateUrl] = useState('');
  const [createEvents, setCreateEvents] = useState<WebhookEventType[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInFlight, setCreateInFlight] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ url: '', events: [] });
  const [editError, setEditError] = useState<string | null>(null);

  const [rotatingId, setRotatingId] = useState<string | null>(null);
  // Only ever holds ONE secret: a second reveal replaces the first, never stacks (edge case 2).
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<WebhookEndpoint | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await client.list(workspaceId);
        if (!cancelled) setItems(list);
      } catch {
        // WHK-03: any non-2xx — 403 for a non-admin member, 404 for a non-member — collapses to
        // the same "doesn't exist or no access" message, never distinguishing the two.
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, client, setItems]);

  useEffect(() => {
    if (removeTarget) dialogRef.current?.showModal();
  }, [removeTarget]);

  if (!workspaceId) return null;
  // Narrowed alias: the handlers below are separate function scopes, so TS doesn't carry the
  // `!workspaceId` guard's narrowing into their closures (same shape as WorkspaceMembersPage).
  const currentWorkspaceId = workspaceId;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    // Edge case 1: a second submit while the first is in flight emits nothing.
    if (createInFlight) return;

    const url = createUrl.trim();
    if (!url) {
      setCreateError(t('nav.webhooks.urlRequired'));
      setAnnouncement(t('nav.webhooks.urlRequired'));
      return;
    }
    if (createEvents.length === 0) {
      setCreateError(t('nav.webhooks.eventsRequired'));
      setAnnouncement(t('nav.webhooks.eventsRequired'));
      return;
    }

    setCreateError(null);
    setCreateInFlight(true);
    try {
      const result = await client.create(currentWorkspaceId, { url, events: createEvents });
      if (result.status === 'created') {
        addItem(result.webhook);
        setCreateUrl('');
        setCreateEvents([]);
        setRevealedSecret(result.secret);
        setAnnouncement(t('nav.webhooks.created'));
        return;
      }
      setCreateError(t('nav.error.generic'));
      setAnnouncement(t('nav.error.generic'));
    } finally {
      setCreateInFlight(false);
    }
  }

  function startEdit(item: WebhookEndpoint): void {
    setEditingId(item.id);
    setEditDraft({ url: item.url, events: [...item.events] });
    setEditError(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditError(null);
  }

  async function submitEdit(item: WebhookEndpoint): Promise<void> {
    const url = editDraft.url.trim();
    if (!url) {
      setEditError(t('nav.webhooks.urlRequired'));
      return;
    }
    // Edge case 4: the server rejects an empty `events` array, so the screen blocks it first.
    if (editDraft.events.length === 0) {
      setEditError(t('nav.webhooks.eventsRequired'));
      return;
    }
    // WHK-19: the server requires at least one changed field; an unchanged save emits nothing.
    if (url === item.url && sameEvents(editDraft.events, item.events)) {
      setEditingId(null);
      return;
    }

    const result = await client.update(currentWorkspaceId, item.id, {
      url,
      events: editDraft.events,
      enabled: item.enabled,
    });
    if (result.status === 'ok') {
      replaceItem(item.id, result.webhook);
      setEditingId(null);
      setAnnouncement(t('nav.webhooks.updated'));
      return;
    }
    setEditError(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
  }

  async function toggleEnabled(item: WebhookEndpoint): Promise<void> {
    const result = await client.update(currentWorkspaceId, item.id, { enabled: !item.enabled });
    if (result.status === 'ok') {
      replaceItem(item.id, result.webhook);
      setAnnouncement(t('nav.webhooks.updated'));
      return;
    }
    setAnnouncement(t('nav.error.generic'));
  }

  async function confirmRotate(item: WebhookEndpoint): Promise<void> {
    const result = await client.rotateSecret(currentWorkspaceId, item.id);
    setRotatingId(null);
    if (result.status === 'rotated') {
      replaceItem(item.id, result.webhook);
      setRevealedSecret(result.secret);
      setAnnouncement(t('nav.webhooks.rotated'));
      return;
    }
    setAnnouncement(t('nav.error.generic'));
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    setRemoveTarget(null);
  }

  async function confirmRemove(): Promise<void> {
    if (!removeTarget) return;
    const target = removeTarget;

    const result = await client.remove(currentWorkspaceId, target.id);
    if (result.status === 'removed') {
      removeItem(target.id);
      setAnnouncement(t('nav.webhooks.removed'));
    } else {
      setAnnouncement(t('nav.error.generic'));
    }
    closeDialog();
  }

  if (notFound) {
    return (
      <div>
        <Link to={`/w/${workspaceId}`}>{t('nav.back')}</Link>
        <p>{t('nav.notFound')}</p>
      </div>
    );
  }

  return (
    <div>
      <Link to={`/w/${workspaceId}`}>{t('nav.back')}</Link>
      <h2>{t('nav.webhooks.title')}</h2>
      <div aria-live="polite" data-testid="webhooks-announcement">
        {announcement}
      </div>

      {revealedSecret !== null && (
        <WebhookSecretPanel secret={revealedSecret} onDismiss={() => setRevealedSecret(null)} />
      )}

      {listStatus === 'ready' && items.length === 0 && <p>{t('nav.webhooks.empty')}</p>}

      {listStatus === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => {
            const isEditing = editingId === item.id;

            return (
              <li key={item.id}>
                {isEditing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitEdit(item);
                    }}
                  >
                    <label>
                      {t('nav.webhooks.urlLabel')}
                      <input
                        value={editDraft.url}
                        onChange={(event) =>
                          setEditDraft((draft) => ({ ...draft, url: event.target.value }))
                        }
                      />
                    </label>
                    <fieldset>
                      <legend>{t('nav.webhooks.eventsLabel')}</legend>
                      {WEBHOOK_EVENT_TYPES.map((event) => (
                        <label key={event}>
                          <input
                            type="checkbox"
                            checked={editDraft.events.includes(event)}
                            onChange={() =>
                              setEditDraft((draft) => ({
                                ...draft,
                                events: toggle(draft.events, event),
                              }))
                            }
                          />
                          {t(`nav.webhooks.eventOptions.${event}`)}
                        </label>
                      ))}
                    </fieldset>
                    <button type="submit">{t('nav.webhooks.save')}</button>
                    <button type="button" onClick={cancelEdit}>
                      {t('nav.webhooks.cancel')}
                    </button>
                    {editError && <p>{editError}</p>}
                  </form>
                ) : (
                  <>
                    <span data-testid={`webhook-url-${item.id}`}>{item.url}</span>
                    <span data-testid={`webhook-events-${item.id}`}>
                      {item.events
                        .map((event) => t(`nav.webhooks.eventOptions.${event}`))
                        .join(', ')}
                    </span>
                    <span data-testid={`webhook-enabled-${item.id}`}>
                      {item.enabled ? t('nav.webhooks.enabled') : t('nav.webhooks.disabled')}
                    </span>
                    <button type="button" onClick={() => startEdit(item)}>
                      {t('nav.webhooks.edit')}
                    </button>
                    <button type="button" onClick={() => void toggleEnabled(item)}>
                      {item.enabled
                        ? t('nav.webhooks.toggleDisable')
                        : t('nav.webhooks.toggleEnable')}
                    </button>
                    {rotatingId === item.id ? (
                      <>
                        <span>{t('nav.webhooks.rotateWarning')}</span>
                        <button type="button" onClick={() => void confirmRotate(item)}>
                          {t('nav.webhooks.rotateConfirm')}
                        </button>
                        <button type="button" onClick={() => setRotatingId(null)}>
                          {t('nav.webhooks.cancel')}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setRotatingId(item.id)}>
                        {t('nav.webhooks.rotate')}
                      </button>
                    )}
                    <button type="button" onClick={() => setRemoveTarget(item)}>
                      {t('nav.webhooks.remove')}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={(event) => void handleCreate(event)}>
        <label>
          {t('nav.webhooks.urlLabel')}
          <input value={createUrl} onChange={(event) => setCreateUrl(event.target.value)} />
        </label>
        <fieldset>
          <legend>{t('nav.webhooks.eventsLabel')}</legend>
          {WEBHOOK_EVENT_TYPES.map((event) => (
            <label key={event}>
              <input
                type="checkbox"
                checked={createEvents.includes(event)}
                onChange={() => setCreateEvents((current) => toggle(current, event))}
              />
              {t(`nav.webhooks.eventOptions.${event}`)}
            </label>
          ))}
        </fieldset>
        <button type="submit">{t('nav.webhooks.create')}</button>
        {createError && <p>{createError}</p>}
      </form>

      {removeTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={removeTarget.url}
          onConfirm={() => void confirmRemove()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
