import { decryptToken } from '@arch-canvas/ai-tools';

/**
 * HTTP client for the configured OpenAI-compatible AI provider (T49, AIC-02).
 * `config.encryptedToken` is decrypted with `decryptToken` (F2a) into a
 * local `token` variable that lives ONLY inside this function's try block,
 * used exclusively as the outbound `Authorization` header — never stored on
 * `this`/module scope, never logged, never included in `CallProviderResult`
 * (success or failure). This file is the one deliberately allowlisted
 * network-capable module in `core/no-egress.spec.ts`; production calls use
 * the global `fetch`, tests always inject `fetchImpl` pointed at a local
 * ephemeral HTTP server, never the real network.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ProviderToolDefinition[];
  /** Requested completion budget — checked against `config.tokenBudget` before any network call is made. */
  maxTokens?: number;
}

export interface ChatCompletionToolCall {
  id: string;
  name: string;
  /** Raw JSON-encoded arguments string, exactly as the provider returned it — parsing/validating them is the tool registry's job (T51/T52), not this client's. */
  arguments: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls: ChatCompletionToolCall[];
  finishReason: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type CallProviderErrorCode =
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'malformed_response'
  | 'invalid_token'
  | 'token_budget_exceeded';

export interface CallProviderError {
  errorCode: CallProviderErrorCode;
  message: string;
  httpStatus?: number;
}

export type CallProviderResult =
  | { ok: true; response: ChatCompletionResponse }
  | { ok: false; error: CallProviderError };

export interface AiProviderCallConfig {
  baseUrl: string;
  model: string;
  /** AES-256-GCM ciphertext from `ai_provider_configs.encrypted_token` — never a plaintext token. */
  encryptedToken: string;
  /** Master key used to decrypt `encryptedToken` — never persisted or logged by this function. */
  encryptionKey: string;
  /** Request timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
  /** Token budget the caller resolved from `ai_provider_configs.capabilitiesJson` — `undefined` means unlimited. */
  tokenBudget?: number;
  /** Injectable for tests — defaults to the real global `fetch` in production. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Cross-realm-safe message extraction — jsdom's test environment throws errors from its own realm, not `instanceof` this realm's `Error`, but `.message` is reliable on both. */
function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : fallback;
}

interface RawToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface RawChatCompletionBody {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: RawToolCall[];
    };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

/** Parses+validates the provider's raw JSON body into `ChatCompletionResponse`. Returns `null` (never throws) on any shape mismatch — the caller turns that into a `malformed_response` error. */
function parseChatCompletionBody(body: unknown): ChatCompletionResponse | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as RawChatCompletionBody;

  const choice = raw.choices?.[0];
  if (!choice || typeof choice !== 'object') return null;
  const message = choice.message;
  if (typeof raw.id !== 'string' || typeof raw.model !== 'string') return null;

  const toolCalls: ChatCompletionToolCall[] = [];
  for (const rawCall of message?.tool_calls ?? []) {
    if (
      typeof rawCall.id !== 'string' ||
      typeof rawCall.function?.name !== 'string' ||
      typeof rawCall.function?.arguments !== 'string'
    ) {
      return null;
    }
    toolCalls.push({
      id: rawCall.id,
      name: rawCall.function.name,
      arguments: rawCall.function.arguments,
    });
  }

  const content = message?.content;
  if (content !== undefined && content !== null && typeof content !== 'string') return null;

  const finishReason = choice.finish_reason;
  if (finishReason !== undefined && finishReason !== null && typeof finishReason !== 'string')
    return null;

  let usage: ChatCompletionResponse['usage'];
  if (raw.usage !== undefined) {
    const {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    } = raw.usage;
    if (
      typeof promptTokens !== 'number' ||
      typeof completionTokens !== 'number' ||
      typeof totalTokens !== 'number'
    ) {
      return null;
    }
    usage = { promptTokens, completionTokens, totalTokens };
  }

  return {
    id: raw.id,
    model: raw.model,
    content: content ?? null,
    toolCalls,
    finishReason: finishReason ?? null,
    usage,
  };
}

/**
 * Calls `POST {baseUrl}/chat/completions` on the configured provider with
 * tool-calling support. Always resolves with a `CallProviderResult` — never
 * throws and never lets a network/timeout/malformed-response failure escape
 * as an unhandled exception (which could otherwise leak the token via a
 * stack trace).
 */
export async function callProvider(
  config: AiProviderCallConfig,
  request: ChatCompletionRequest,
): Promise<CallProviderResult> {
  if (
    config.tokenBudget !== undefined &&
    request.maxTokens !== undefined &&
    request.maxTokens > config.tokenBudget
  ) {
    return {
      ok: false,
      error: {
        errorCode: 'token_budget_exceeded',
        message: `requested maxTokens (${request.maxTokens}) exceeds the configured budget (${config.tokenBudget})`,
      },
    };
  }

  let token: string;
  try {
    // The ONLY place in this module the plaintext token is read into memory.
    token = decryptToken(config.encryptedToken, config.encryptionKey);
  } catch (error) {
    return {
      ok: false,
      error: {
        errorCode: 'invalid_token',
        message: errorMessage(error, 'failed to decrypt provider token'),
      },
    };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          ...(request.tools ? { tools: request.tools } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Not `instanceof Error` — under vitest's jsdom test environment, `fetch`/
      // `AbortController` are jsdom's own realm's implementations, whose thrown
      // `DOMException` is not an instance of this realm's global `Error`. `.name`
      // is reliable across both realms, so branch on that alone.
      if ((error as { name?: unknown })?.name === 'AbortError') {
        return {
          ok: false,
          error: {
            errorCode: 'timeout',
            message: `provider did not respond within ${timeoutMs}ms`,
          },
        };
      }
      return {
        ok: false,
        error: {
          errorCode: 'network_error',
          message: errorMessage(error, 'unknown network error calling provider'),
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          errorCode: 'http_error',
          message: `provider responded with status ${response.status}`,
          httpStatus: response.status,
        },
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        error: { errorCode: 'malformed_response', message: 'provider response was not valid JSON' },
      };
    }

    const parsed = parseChatCompletionBody(body);
    if (!parsed) {
      return {
        ok: false,
        error: {
          errorCode: 'malformed_response',
          message: 'provider response did not match the expected chat-completion shape',
        },
      };
    }

    return { ok: true, response: parsed };
  } finally {
    clearTimeout(timeout);
  }
}
