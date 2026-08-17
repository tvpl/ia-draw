import type { Role } from '@arch-canvas/auth';
import type { SceneElement } from '@arch-canvas/editor-adapter';

/** Mirrors the server's `toPublicShareLink` projection (`apps/server/src/modules/share/routes.ts`) — never includes `tokenHash`, which the API never re-exposes. */
export interface ShareLink {
  id: string;
  resourceType: 'diagram' | 'presentation';
  resourceId: string;
  role: Role;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

/** `token` is the plaintext share token, revealed exactly once by the `201` and never recoverable again — not even by the server, which only stores its SHA-256. */
export type CreateShareLinkResult =
  | { status: 'created'; shareLink: ShareLink; token: string }
  | { status: 'forbidden' }
  | { status: 'error' };

export type RevokeResult =
  | { status: 'revoked'; shareLink: ShareLink }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error' };

/** Mirrors the server's `FrameRow`, notes already redacted per the link's own role
 * (never re-checked here — same "server is the authority" convention as
 * `apps/web/src/presentation/presentationClient.ts`). */
export interface PublicFrame {
  id: string;
  position: number;
  elementId: string | null;
  frameId: string | null;
  notes: string | null;
  navLinksJson: { targetFrameId: string }[];
}

/**
 * `GET /share/:token`'s two response shapes plus its failure modes. The server
 * folds "token does not exist", "expired" and "revoked" into ONE indistinguishable
 * `404` (IDOR-safe), so `not_found` deliberately carries no reason either.
 *
 * presentation-mode/T4: the presentation branch now carries `frames` and, once the
 * presentation has been published (server-side, T1), `scene` — the FROZEN scene
 * from the published snapshot, never live. Before the first publish, `scene` stays
 * `null` and `published` stays `false`, exactly like the placeholder R11 already
 * renders for that state (SHR-27/28 unaffected).
 */
export type ResolveResult =
  | { status: 'diagram'; role: Role; scene: readonly SceneElement[]; revision: number }
  | {
      status: 'presentation';
      role: Role;
      presentation: { id: string; name: string };
      frameCount: number;
      frames: readonly PublicFrame[];
      scene: readonly SceneElement[] | null;
      published: boolean;
    }
  | { status: 'not_found' }
  | { status: 'error' };

export interface ShareLinkClient {
  createForDiagram(
    diagramId: string,
    role: Role,
    expiresAt: string,
  ): Promise<CreateShareLinkResult>;
  /** presentation-mode/T4 (PRZ-27/28): same shape/semantics as `createForDiagram`, targeting a
   * presentation's own `POST /presentations/:id/share-links` instead. */
  createForPresentation(
    presentationId: string,
    role: Role,
    expiresAt: string,
  ): Promise<CreateShareLinkResult>;
  revoke(shareLinkId: string): Promise<RevokeResult>;
  resolve(token: string): Promise<ResolveResult>;
}

interface CreateResponseBody {
  shareLink?: ShareLink;
  token?: string;
}

interface RevokeResponseBody {
  shareLink?: ShareLink;
}

interface ResolveResponseBody {
  resourceType?: 'diagram' | 'presentation';
  role?: Role;
  scene?: readonly SceneElement[];
  revision?: number;
  presentation?: { id: string; name: string };
  frames?: readonly PublicFrame[];
  published?: boolean;
}

/**
 * Dedicated share-link HTTP client (design.md) — deliberately NOT the generic
 * `resourceClient` from `workspace-navigation`: creation takes two fields and
 * answers with a one-shot `{shareLink, token}` pair, and revoke uses the custom
 * method verb `:revoke`. Same `fetchImpl` injection style as `memberClient.ts`.
 *
 * Every call site below reads `fetchImpl(...)` literally (no locally-aliased
 * wrapper), which is what `repo-tools`' route-inventory extractor recognizes —
 * a `doFetch` alias would leave these routes in the `pending-product` bucket.
 */
export function createShareLinkClient(fetchImplOption?: typeof fetch): ShareLinkClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function createForDiagram(
    diagramId: string,
    role: Role,
    expiresAt: string,
  ): Promise<CreateShareLinkResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/diagrams/${diagramId}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, expiresAt }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as CreateResponseBody;
    // A `201` without the one-shot token is unusable: showing a link without its
    // token would hand the user a URL that 404s forever (spec.md Edge Cases).
    if (!body.shareLink || !body.token) return { status: 'error' };
    return { status: 'created', shareLink: body.shareLink, token: body.token };
  }

  async function createForPresentation(
    presentationId: string,
    role: Role,
    expiresAt: string,
  ): Promise<CreateShareLinkResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/presentations/${presentationId}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, expiresAt }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as CreateResponseBody;
    if (!body.shareLink || !body.token) return { status: 'error' };
    return { status: 'created', shareLink: body.shareLink, token: body.token };
  }

  async function revoke(shareLinkId: string): Promise<RevokeResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/share-links/${shareLinkId}:revoke`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as RevokeResponseBody;
    if (!body.shareLink) return { status: 'error' };
    return { status: 'revoked', shareLink: body.shareLink };
  }

  async function resolve(token: string): Promise<ResolveResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/share/${token}`);
    } catch {
      return { status: 'error' };
    }

    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as ResolveResponseBody;
    if (!body.role) return { status: 'error' };

    if (body.resourceType === 'diagram') {
      return {
        status: 'diagram',
        role: body.role,
        scene: body.scene ?? [],
        revision: body.revision ?? 0,
      };
    }

    if (body.resourceType === 'presentation' && body.presentation) {
      const frames = body.frames ?? [];
      return {
        status: 'presentation',
        role: body.role,
        // Projected to exactly id+name: nothing else from the presentation row
        // crosses this boundary.
        presentation: { id: body.presentation.id, name: body.presentation.name },
        frameCount: frames.length,
        // SHR-28, kept for the presentation-mode/T4 shape: `notes` is stripped at
        // THIS boundary too, defense-in-depth on top of the server's own
        // per-link-role redaction — a frame's `notes` never crosses into
        // anything this client returns, no matter what the response body held.
        frames: frames.map((frame) => ({ ...frame, notes: null })),
        scene: body.scene ?? null,
        published: body.published === true,
      };
    }

    return { status: 'error' };
  }

  return { createForDiagram, createForPresentation, revoke, resolve };
}
