/**
 * The 5 event types the server accepts (`WEBHOOK_EVENT_TYPES` in
 * `apps/server/src/modules/webhook/webhooks.ts`), same order — the set is closed on the server
 * (`z.array(z.enum(...)).min(1)`), so the UI mirrors it instead of inventing options.
 */
export const WEBHOOK_EVENT_TYPES = [
  'diagram.created',
  'diagram.updated',
  'diagram.published',
  'spec.generated',
  'comment.mentioned',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Mirrors the server's public projection (`toPublicWebhookEndpoint`) field for field. There is
 * deliberately no `secret` here: the raw secret is returned only by `POST` and `:rotate-secret`,
 * alongside this object, never inside it and never again afterwards.
 */
export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookInput {
  url: string;
  events: WebhookEventType[];
}

/** At least one field is required by the server (`updateBodySchema`'s `refine`); the caller enforces that. */
export interface UpdateWebhookInput {
  url?: string;
  events?: WebhookEventType[];
  enabled?: boolean;
}

export type CreateResult =
  | { status: 'created'; webhook: WebhookEndpoint; secret: string }
  | { status: 'error' };

export type UpdateResult = { status: 'ok'; webhook: WebhookEndpoint } | { status: 'error' };

export type RemoveResult = { status: 'removed' } | { status: 'error' };

export type RotateResult =
  | { status: 'rotated'; webhook: WebhookEndpoint; secret: string }
  | { status: 'error' };

export interface WebhookClient {
  list(workspaceId: string): Promise<WebhookEndpoint[]>;
  create(workspaceId: string, input: CreateWebhookInput): Promise<CreateResult>;
  update(workspaceId: string, webhookId: string, patch: UpdateWebhookInput): Promise<UpdateResult>;
  remove(workspaceId: string, webhookId: string): Promise<RemoveResult>;
  rotateSecret(workspaceId: string, webhookId: string): Promise<RotateResult>;
}

interface ListResponseBody {
  items: WebhookEndpoint[];
}

interface EndpointResponseBody {
  webhookEndpoint: WebhookEndpoint;
}

interface SecretResponseBody extends EndpointResponseBody {
  secret: string;
}

/**
 * Dedicated workspace-webhook HTTP client (spec.md's Assumptions table) — deliberately NOT the
 * generic `resourceClient`: creating a webhook takes three fields including an array (not the
 * generic's single-string body), and `:rotate-secret` is a whole extra verb whose response
 * (`{webhookEndpoint, secret}`) the generic has no slot for. Same `fetchImpl`-injection style and
 * one-result-union-per-method shape as `memberClient.ts`.
 *
 * Every call site below reads `fetchImpl(...)` literally — never a local alias like `doFetch`,
 * which the `repo-tools` route-inventory extractor cannot see (it only recognizes literal
 * `fetch(`/`fetchImpl(` call sites).
 */
export function createWebhookClient(fetchImplOption?: typeof fetch): WebhookClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(workspaceId: string): Promise<WebhookEndpoint[]> {
    const response = await fetchImpl(`/workspaces/${workspaceId}/webhooks`);
    if (!response.ok) throw new Error(`list webhooks failed: ${response.status}`);
    const body = (await response.json()) as ListResponseBody;
    return body.items;
  }

  async function create(workspaceId: string, input: CreateWebhookInput): Promise<CreateResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/webhooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: input.url, events: input.events }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as SecretResponseBody;
    return { status: 'created', webhook: body.webhookEndpoint, secret: body.secret };
  }

  async function update(
    workspaceId: string,
    webhookId: string,
    patch: UpdateWebhookInput,
  ): Promise<UpdateResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/webhooks/${webhookId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as EndpointResponseBody;
    return { status: 'ok', webhook: body.webhookEndpoint };
  }

  async function remove(workspaceId: string, webhookId: string): Promise<RemoveResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/webhooks/${webhookId}`, {
        method: 'DELETE',
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 204) return { status: 'error' };
    return { status: 'removed' };
  }

  async function rotateSecret(workspaceId: string, webhookId: string): Promise<RotateResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/webhooks/${webhookId}:rotate-secret`, {
        method: 'PATCH',
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as SecretResponseBody;
    return { status: 'rotated', webhook: body.webhookEndpoint, secret: body.secret };
  }

  return { list, create, update, remove, rotateSecret };
}
