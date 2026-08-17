/**
 * Mirrors the server's `ProviderConfigPublic`
 * (`apps/server/src/modules/ai-provider/providerConfigs.ts`) field for field.
 * `createdAt`/`updatedAt` are `string` because JSON serialization turns the
 * server's `Date` into ISO text.
 *
 * There is deliberately NO token field of any kind — not the plaintext, not the
 * ciphertext, not a `hasKey` flag. The server never returns one, and the absence
 * here is the client-side half of that contract (PROV-03).
 */
export interface ProviderConfig {
  id: string;
  scope: string;
  baseUrl: string;
  model: string;
  capabilitiesJson: unknown;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderInput {
  scope: string;
  baseUrl: string;
  model: string;
  token: string;
}

export interface UpdateProviderInput {
  baseUrl?: string;
  model?: string;
  /** Absent = the currently stored (encrypted) key stays untouched server-side (PROV-13). */
  token?: string;
  enabled?: boolean;
}

/** Mirrors the `:test` response body (`apps/server/src/modules/ai-provider/testConnection.ts`). */
export interface TestConnectionResult {
  success: boolean;
  modelAvailable: boolean;
  toolCallingSupported: boolean;
  error?: string;
}

export type CreateResult =
  | { status: 'created'; config: ProviderConfig }
  | { status: 'rejected' }
  | { status: 'error' };

export type UpdateResult = { status: 'ok'; config: ProviderConfig } | { status: 'error' };

export type TestOutcome =
  | { status: 'done'; result: TestConnectionResult }
  | { status: 'rate_limited' }
  | { status: 'error' };

export interface AiProviderClient {
  list(scope: string): Promise<ProviderConfig[]>;
  create(input: CreateProviderInput): Promise<CreateResult>;
  update(id: string, patch: UpdateProviderInput): Promise<UpdateResult>;
  testConnection(id: string): Promise<TestOutcome>;
}

const BASE_URL = '/admin/ai-providers';

/**
 * Dedicated HTTP client for the 4 `/admin/ai-providers` routes (design.md's
 * Components) — deliberately NOT the generic `resourceClient`: the create body
 * carries five fields, `PATCH` has omission semantics (no `token` = keep the
 * stored key), and `:test` is a verb with a response shape of its own. None of
 * that fits `create(name)`/`rename(name)`.
 *
 * Every call site reads `fetchImpl(...)` literally, matching `memberClient.ts` —
 * `repo-tools`' route-inventory extractor only recognizes literal `fetch(`/
 * `fetchImpl(` calls, so a locally-aliased wrapper would keep these routes in
 * the `pending-product` bucket even though the product consumes them.
 */
export function createAiProviderClient(fetchImplOption?: typeof fetch): AiProviderClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(scope: string): Promise<ProviderConfig[]> {
    const response = await fetchImpl(`${BASE_URL}?scope=${encodeURIComponent(scope)}`);
    if (!response.ok) throw new Error(`list provider configs failed: ${response.status}`);
    const body = (await response.json()) as { items: ProviderConfig[] };
    return body.items;
  }

  async function create(input: CreateProviderInput): Promise<CreateResult> {
    let response: Response;
    try {
      response = await fetchImpl(BASE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      return { status: 'error' };
    }

    // 400 is the server's SSRF rejection of `baseUrl` (PROV-12) — a distinct,
    // actionable outcome, not lumped into the generic error branch.
    if (response.status === 400) return { status: 'rejected' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as { config: ProviderConfig };
    return { status: 'created', config: body.config };
  }

  async function update(id: string, patch: UpdateProviderInput): Promise<UpdateResult> {
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // `JSON.stringify` drops `undefined` properties, so an omitted `token`
        // never reaches the wire — that omission is what preserves the stored key.
        body: JSON.stringify(patch),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status !== 200) return { status: 'error' };
    const body = (await response.json()) as { config: ProviderConfig };
    return { status: 'ok', config: body.config };
  }

  async function testConnection(id: string): Promise<TestOutcome> {
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}/${id}:test`, { method: 'POST' });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 429) return { status: 'rate_limited' };
    if (response.status !== 200) return { status: 'error' };

    // A `200` carrying `success: false` is still `'done'`: the provider answered,
    // and the verdict lives in the body, never in the HTTP status (PROV-19).
    const result = (await response.json()) as TestConnectionResult;
    return { status: 'done', result };
  }

  return { list, create, update, testConnection };
}
