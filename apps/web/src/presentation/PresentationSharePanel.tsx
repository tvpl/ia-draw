import type { Role } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createShareLinkClient } from '../share/shareLinkClient.js';

const ROLE_VALUES: readonly Role[] = [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
];

const ROLE_KEY: Record<Role, string> = {
  org_admin: 'orgAdmin',
  workspace_admin: 'workspaceAdmin',
  editor: 'editor',
  reviewer: 'reviewer',
  viewer: 'viewer',
};

interface CreatedLink {
  id: string;
  role: Role;
  expiresAt: string;
  url: string;
  revoked: boolean;
}

export interface PresentationSharePanelProps {
  presentationId: string;
  /** `true` once `presentation.publishedSnapshotId` is set — before that, the panel stays
   * visible but disabled (PRZ-26): distributing a link to an unpublished presentation would
   * only ever show the "not available yet" public placeholder. */
  published: boolean;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Presentation-scoped public share-link management (design.md — a sibling of
 * `apps/web/src/share/ShareLinkPanel.tsx`, not a reuse of it: that component's props are
 * bound to a `diagramId`, and this page never wants to risk the two surfaces silently
 * drifting apart by threading a resource-kind switch through a shared component). Same
 * UX contract as R11's diagram panel: role+expiry form, one-shot URL reveal, session-only
 * list, revoke.
 */
export function PresentationSharePanel({
  presentationId,
  published,
  fetchImpl,
}: PresentationSharePanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createShareLinkClient(fetchImpl), [fetchImpl]);

  const [role, setRole] = useState<Role | ''>('');
  const [expiresAt, setExpiresAt] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [links, setLinks] = useState<readonly CreatedLink[]>([]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (inFlight || !published) return;
    if (!role || !expiresAt) return;
    const chosenRole = role;

    const when = new Date(expiresAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError(t('share.error.expiresInPast'));
      setAnnouncement(t('share.error.expiresInPast'));
      return;
    }

    setError(null);
    setInFlight(true);
    try {
      const result = await client.createForPresentation(
        presentationId,
        chosenRole,
        when.toISOString(),
      );

      if (result.status === 'created') {
        setLinks((current) => [
          ...current,
          {
            id: result.shareLink.id,
            role: result.shareLink.role,
            expiresAt: result.shareLink.expiresAt,
            url: `${window.location.origin}/share/${result.token}`,
            revoked: false,
          },
        ]);
        setRole('');
        setExpiresAt('');
        setAnnouncement(t('presentation.sharePanel.created'));
        return;
      }

      if (result.status === 'forbidden') {
        setError(t('presentation.sharePanel.error.roleCeiling'));
        setAnnouncement(t('presentation.sharePanel.error.roleCeiling'));
        return;
      }

      setError(t('presentation.sharePanel.error.generic'));
      setAnnouncement(t('presentation.sharePanel.error.generic'));
    } finally {
      setInFlight(false);
    }
  }

  async function handleRevoke(link: CreatedLink): Promise<void> {
    const result = await client.revoke(link.id);
    if (result.status === 'revoked') {
      setLinks((current) =>
        current.map((item) => (item.id === link.id ? { ...item, revoked: true } : item)),
      );
      setAnnouncement(t('presentation.sharePanel.revoked'));
      return;
    }
    setAnnouncement(t('presentation.sharePanel.error.generic'));
  }

  return (
    <div>
      <h4>{t('presentation.sharePanel.title')}</h4>
      {!published && <p>{t('presentation.sharePanel.disabledBeforePublish')}</p>}

      <div aria-live="polite" data-testid="presentation-share-announcement">
        {announcement}
      </div>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <fieldset disabled={!published}>
          <label>
            {t('presentation.sharePanel.roleLabel')}
            <select value={role} onChange={(event) => setRole(event.target.value as Role | '')}>
              <option value="">{t('presentation.sharePanel.roleSelectPlaceholder')}</option>
              {ROLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`share.roleOptions.${ROLE_KEY[value]}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('presentation.sharePanel.expiresAtLabel')}
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <button type="submit">{t('presentation.sharePanel.create')}</button>
        </fieldset>
        {error && <p>{error}</p>}
      </form>

      <h5>{t('presentation.sharePanel.createdListTitle')}</h5>
      <p>{t('presentation.sharePanel.sessionOnlyNotice')}</p>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <span>{t(`share.roleOptions.${ROLE_KEY[link.role]}`)}</span>{' '}
            <span>{link.expiresAt}</span>{' '}
            {link.revoked ? (
              <span>{t('presentation.sharePanel.revokedBadge')}</span>
            ) : (
              <>
                <label>
                  {t('presentation.sharePanel.urlLabel')}
                  <input type="text" readOnly value={link.url} />
                </label>
                <p>{t('presentation.sharePanel.oneShotNotice')}</p>
                <button type="button" onClick={() => void handleRevoke(link)}>
                  {t('presentation.sharePanel.revoke')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
