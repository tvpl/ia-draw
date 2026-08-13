/**
 * OIDC-with-PKCE relying-party support (T87, OIDC-01/02/03).
 *
 * Uses `openid-client` v6's function-based API (researched directly from
 * the installed package's `build/index.d.ts` before writing any of this —
 * v6 replaced the old `Issuer`/`Client` classes with plain functions over a
 * `Configuration` value; `discovery()` returns that `Configuration`,
 * `buildAuthorizationUrl`/`authorizationCodeGrant` take it as their first
 * argument). NEVER a parallel session mechanism — every OIDC-originated
 * login ends by calling the exact same `createSession` (F1a, `./session.js`)
 * used by local email/password login, so `/auth/refresh` and `/auth/logout`
 * work identically regardless of how the session began.
 */
import type { Role } from '@arch-canvas/auth';
import { ROLES } from '@arch-canvas/auth';
import { users, workspaceMembers } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import * as client from 'openid-client';
import type { AppConfig } from '../../core/config.js';
import type { LocalUser } from './accounts.js';
import type { Db } from './db.js';

export type OidcConfig = NonNullable<AppConfig['oidc']>;

/**
 * One `Configuration` (openid-client's discovered-metadata handle) is
 * cached per issuer+client pair — discovery is a network round-trip and
 * this module is called on every `/auth/oidc/login` hit. Keyed (not a
 * single bare cache) and explicitly resettable so tests that spin up a
 * fresh in-process provider per run (T88) never see a stale discovery
 * document from a previous test's provider instance/port.
 */
let cachedConfiguration: { key: string; promise: Promise<client.Configuration> } | null = null;

/** Test-only escape hatch — see the cache doc comment above. */
export function resetOidcClientConfigurationCache(): void {
  cachedConfiguration = null;
}

/**
 * Discovers (or returns the cached discovery of) the OIDC provider's
 * `Configuration`. `http:` issuers (only ever real in local dev/tests — an
 * in-process `oidc-provider` in T88's case) opt into `allowInsecureRequests`
 * exactly as openid-client's own docs demonstrate; a real production issuer
 * is always `https:` and never takes this branch.
 */
export function getOidcClientConfiguration(oidc: OidcConfig): Promise<client.Configuration> {
  const key = `${oidc.issuerUrl}::${oidc.clientId}`;
  if (cachedConfiguration && cachedConfiguration.key === key) {
    return cachedConfiguration.promise;
  }

  const issuerUrl = new URL(oidc.issuerUrl);
  const discoveryOptions =
    issuerUrl.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined;

  const promise = client.discovery(
    issuerUrl,
    oidc.clientId,
    oidc.clientSecret,
    undefined,
    discoveryOptions,
  );
  cachedConfiguration = { key, promise };
  return promise;
}

/**
 * Maps the ID token's group claim to a workspace role, per
 * `OIDC_GROUP_ROLE_MAP`. This is the ONLY place a role is ever derived from
 * an ID token, and it deliberately reads nothing else off the token:
 *
 * - A group with no entry in `groupRoleMap` grants nothing — the map is an
 *   explicit allowlist, never a default-permissive lookup.
 * - Any OTHER claim on the token (a top-level `role`, `admin`, or similar
 *   suggestive field an attacker-controlled/malformed IdP response might
 *   carry) is never read here at all — only `groupClaimValue` (the exact
 *   claim named by `OIDC_GROUP_CLAIM`) is consulted.
 * - When multiple groups match, the HIGHEST-privilege mapped role wins
 *   (never a role beyond what any single matched group's map entry says).
 *
 * Returns `null` when no group matches — the caller must never invent a
 * fallback role for that case.
 */
export function resolveOidcRole(
  groupClaimValue: unknown,
  groupRoleMap: Record<string, Role>,
): Role | null {
  if (!Array.isArray(groupClaimValue)) return null;

  let best: Role | null = null;
  for (const entry of groupClaimValue) {
    if (typeof entry !== 'string') continue;
    const mapped = groupRoleMap[entry];
    if (!mapped) continue;
    if (best === null || ROLES.indexOf(mapped) < ROLES.indexOf(best)) {
      best = mapped;
    }
  }
  return best;
}

export interface OidcIdentity {
  issuerUrl: string;
  subject: string;
  email?: string;
  displayName?: string;
}

/**
 * Finds the local user previously provisioned for this IdP subject, or
 * creates one. Lookup is by `authSubject` (`"<issuerUrl>#<sub>"`) ONLY —
 * deliberately never by email — so a same-looking email on an existing
 * local (or different-IdP) account can never be silently taken over by an
 * OIDC login claiming that email; a genuine collision surfaces as a real
 * unique-constraint error instead of a silent account merge.
 */
export async function resolveOrCreateOidcUser(db: Db, identity: OidcIdentity): Promise<LocalUser> {
  const authSubject = `${identity.issuerUrl}#${identity.subject}`;

  const [existing] = await db.select().from(users).where(eq(users.authSubject, authSubject));
  if (existing) {
    return { id: existing.id, email: existing.email, displayName: existing.displayName };
  }

  const email =
    identity.email ??
    `${identity.subject}@${new URL(identity.issuerUrl).host}.oidc-subject.invalid`;
  const displayName = identity.displayName ?? identity.email ?? identity.subject;

  const [created] = await db.insert(users).values({ email, displayName, authSubject }).returning();
  if (!created) throw new Error('resolveOrCreateOidcUser: insert returned no row');
  return { id: created.id, email: created.email, displayName: created.displayName };
}

/**
 * Upserts `role` for `userId` in `workspaceId` — synced on every OIDC login
 * so a group's mapped role stays current (e.g. a demotion in the IdP takes
 * effect on the very next login, mirroring AUTH-05's "next request" bound
 * for local role changes). Only ever called with a `role` `resolveOidcRole`
 * actually returned — never a caller-invented fallback.
 */
export async function syncOidcWorkspaceRole(
  db: Db,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role, updatedAt: new Date() },
    });
}
