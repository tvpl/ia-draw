/**
 * BOOT-13: HTTP client for the first-run surface, in the shape `memberClient.ts` and
 * `aiDockClient.ts` established — injectable `fetchImpl`, one branch per documented status,
 * and every call site written with the literal identifier `fetchImpl(` so `repo-tools`'
 * route-inventory extractor recognises it.
 */

export interface FirstRunInput {
  email: string;
  displayName: string;
  password: string;
  workspaceName: string;
}

export interface FirstRunUser {
  id: string;
  email: string;
  displayName: string;
}

/** `available` is false for every non-200, including a network failure: an instance that cannot be asked is not an instance to bootstrap. */
export type AvailabilityResult = { available: boolean };

export type SubmitResult =
  | { status: 'created'; user: FirstRunUser; workspaceId: string }
  /** The field the server refused, taken from its problem+json `title`. */
  | { status: 'invalid'; field: string }
  /** Someone else initialized this instance first — the form must fall back to credentials. */
  | { status: 'already_initialized' }
  | { status: 'rate_limited' }
  | { status: 'error' };

export interface FirstRunClient {
  checkAvailability: () => Promise<AvailabilityResult>;
  submit: (input: FirstRunInput) => Promise<SubmitResult>;
}

/** Maps the server's `Invalid <field>` problem title back to the field name the form highlights. */
function fieldFromTitle(title: unknown): string {
  if (typeof title !== 'string') return 'unknown';
  const match = /^Invalid\s+(\S+)$/.exec(title);
  return match?.[1] ?? 'unknown';
}

export function createFirstRunClient(fetchImplOption?: typeof fetch): FirstRunClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function checkAvailability(): Promise<AvailabilityResult> {
    let response: Response;
    try {
      response = await fetchImpl('/auth/first-run');
    } catch {
      return { available: false };
    }
    if (response.status !== 200) return { available: false };

    const body = (await response.json()) as { available?: boolean };
    return { available: body.available === true };
  }

  async function submit(input: FirstRunInput): Promise<SubmitResult> {
    let response: Response;
    try {
      response = await fetchImpl('/auth/first-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 201) {
      const body = (await response.json()) as { user: FirstRunUser; workspaceId: string };
      return { status: 'created', user: body.user, workspaceId: body.workspaceId };
    }
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { title?: unknown };
      return { status: 'invalid', field: fieldFromTitle(body.title) };
    }
    // 404 and 409 mean the same thing to the form: this instance is no longer empty.
    if (response.status === 404 || response.status === 409) {
      return { status: 'already_initialized' };
    }
    if (response.status === 429) return { status: 'rate_limited' };
    return { status: 'error' };
  }

  return { checkAvailability, submit };
}
