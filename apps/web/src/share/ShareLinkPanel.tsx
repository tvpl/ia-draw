import type { Role } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createShareLinkClient } from './shareLinkClient.js';

/** Roles ordered exactly like the server's own `ROLE_VALUES` (`apps/server/src/modules/workspace/routes.ts`). */
const ROLE_VALUES: readonly Role[] = [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
];

/** Maps a `Role` to its `share.roleOptions.*` i18n key segment. */
const ROLE_KEY: Record<Role, string> = {
  org_admin: 'orgAdmin',
  workspace_admin: 'workspaceAdmin',
  editor: 'editor',
  reviewer: 'reviewer',
  viewer: 'viewer',
};

/**
 * A link created on this screen. `url` holds the ONLY copy of the plaintext token
 * that exists anywhere in the client — the server keeps just its SHA-256, so once
 * this component unmounts the URL is unrecoverable by anyone.
 */
interface CreatedLink {
  id: string;
  role: Role;
  expiresAt: string;
  url: string;
  revoked: boolean;
}

export interface ShareLinkPanelProps {
  diagramId: string;
  /** `mutatePermissions.allowed` from the diagram bootstrap — the same gate `AiDock` uses. */
  canMutate: boolean;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Share-link management inside the diagram editor (SHR-01..11).
 *
 * The list only ever holds links created on THIS mount: the server exposes no
 * listing route for share links, and the plaintext token is unrecoverable after
 * creation, so there is nothing to restore on reload. The panel says so instead of
 * pretending to be a complete inventory (SHR-08).
 */
export function ShareLinkPanel({
  diagramId,
  canMutate,
  fetchImpl,
}: ShareLinkPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const client = useMemo(() => createShareLinkClient(fetchImpl), [fetchImpl]);

  const [role, setRole] = useState<Role | ''>('');
  const [expiresAt, setExpiresAt] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [links, setLinks] = useState<readonly CreatedLink[]>([]);

  if (!canMutate) return null;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (inFlight) return;
    if (!role || !expiresAt) return;
    const chosenRole = role;

    // The server accepts any date (`z.coerce.date()` with no lower bound), so a past
    // expiry would create a link that is dead on arrival. Blocked here as UX defense,
    // never as authorization — the server stays the authority.
    const when = new Date(expiresAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError(t('share.error.expiresInPast'));
      setAnnouncement(t('share.error.expiresInPast'));
      return;
    }

    setError(null);
    setInFlight(true);
    try {
      const result = await client.createForDiagram(diagramId, chosenRole, when.toISOString());

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
        setAnnouncement(t('share.created'));
        return;
      }

      if (result.status === 'forbidden') {
        setError(t('share.error.roleCeiling'));
        setAnnouncement(t('share.error.roleCeiling'));
        return;
      }

      setError(t('share.error.generic'));
      setAnnouncement(t('share.error.generic'));
    } finally {
      setInFlight(false);
    }
  }

  async function handleRevoke(link: CreatedLink): Promise<void> {
    const result = await client.revoke(link.id);
    if (result.status === 'revoked') {
      // Dropping `url` here is what makes the token stop being readable on screen.
      setLinks((current) =>
        current.map((item) => (item.id === link.id ? { ...item, revoked: true } : item)),
      );
      setAnnouncement(t('share.revoked'));
      return;
    }
    setAnnouncement(t('share.error.generic'));
  }

  return (
    <div>
      <div aria-live="polite" data-testid="share-announcement">
        {announcement}
      </div>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <label>
          {t('share.roleLabel')}
          <select value={role} onChange={(event) => setRole(event.target.value as Role | '')}>
            <option value="">{t('share.roleSelectPlaceholder')}</option>
            {ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`share.roleOptions.${ROLE_KEY[value]}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('share.expiresAtLabel')}
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <button type="submit">{t('share.create')}</button>
        {error && <p>{error}</p>}
      </form>

      <h3>{t('share.createdListTitle')}</h3>
      <p>{t('share.sessionOnlyNotice')}</p>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <span>{t(`share.roleOptions.${ROLE_KEY[link.role]}`)}</span>{' '}
            <span>{link.expiresAt}</span>{' '}
            {link.revoked ? (
              <span>{t('share.revokedBadge')}</span>
            ) : (
              <>
                <label>
                  {t('share.urlLabel')}
                  <input type="text" readOnly value={link.url} />
                </label>
                <p>{t('share.oneShotNotice')}</p>
                <button type="button" onClick={() => void handleRevoke(link)}>
                  {t('share.revoke')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
