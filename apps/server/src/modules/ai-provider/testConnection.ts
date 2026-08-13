/**
 * Calls the configured provider's `POST {baseUrl}/chat/completions` to
 * verify authentication, model availability and tool-calling support
 * (AIC-02) — the ONLY place in this module the plaintext token is ever
 * read into memory, and it is used exclusively as the `Authorization`
 * header value, never logged, persisted or included in the returned
 * result. Real production calls use the global `fetch` (this file is the
 * single reviewed entry in `no-egress.spec.ts`'s allowlist); tests always
 * inject `fetchImpl` with a deterministic mock, never hitting the network.
 */
export interface TestConnectionResult {
  success: boolean;
  modelAvailable: boolean;
  toolCallingSupported: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

export async function testProviderConnection(
  baseUrl: string,
  model: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TestConnectionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'connection test — ignore' }],
        tools: [
          {
            type: 'function',
            function: { name: 'ping', description: 'test tool', parameters: {} },
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        modelAvailable: false,
        toolCallingSupported: false,
        error: `provider responded with status ${response.status}`,
      };
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: unknown[] } }>;
    };
    const toolCallingSupported = Boolean(body.choices?.[0]?.message?.tool_calls?.length);

    return { success: true, modelAvailable: true, toolCallingSupported };
  } catch (error) {
    return {
      success: false,
      modelAvailable: false,
      toolCallingSupported: false,
      error: error instanceof Error ? error.message : 'unknown error testing provider connection',
    };
  } finally {
    clearTimeout(timeout);
  }
}
