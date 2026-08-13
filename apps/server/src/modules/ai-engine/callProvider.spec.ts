import { createServer, type IncomingMessage, type Server } from 'node:http';
import { encryptToken } from '@arch-canvas/ai-tools';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AiProviderCallConfig,
  type ChatCompletionRequest,
  callProvider,
} from './callProvider.js';

const ENCRYPTION_KEY = 'test-master-key-for-callProvider-spec';
const TEST_TOKEN = 'sk-super-secret-provider-token-do-not-leak';

/** A real, local, ephemeral (`port: 0`) HTTP server — never a real network call (T49 "Done when"). */
async function startMockServer(
  handler: (
    req: IncomingMessage,
    body: unknown,
  ) => { status: number; body?: unknown; delayMs?: number },
): Promise<{ server: Server; baseUrl: string; receivedAuthHeaders: string[] }> {
  const receivedAuthHeaders: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedAuthHeaders.push(req.headers.authorization ?? '');
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsedBody = raw ? JSON.parse(raw) : undefined;
      const { status, body, delayMs } = handler(req, parsedBody);
      const send = () => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (delayMs) setTimeout(send, delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('mock server failed to bind an ephemeral port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, receivedAuthHeaders };
}

function baseConfig(
  baseUrl: string,
  overrides: Partial<AiProviderCallConfig> = {},
): AiProviderCallConfig {
  return {
    baseUrl,
    model: 'test-model',
    encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
    encryptionKey: ENCRYPTION_KEY,
    timeoutMs: 2000,
    ...overrides,
  };
}

const basicRequest: ChatCompletionRequest = {
  messages: [{ role: 'user', content: 'design an aws multi-az architecture' }],
};

describe('callProvider (T49, AIC-02)', () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
      activeServer = undefined;
    }
  });

  it('parses a successful response from the mock provider correctly', async () => {
    const { server, baseUrl } = await startMockServer(() => ({
      status: 200,
      body: {
        id: 'chatcmpl-1',
        model: 'test-model',
        choices: [
          {
            message: {
              content: 'Here is the plan',
              tool_calls: [
                { id: 'call_1', function: { name: 'inspect_diagram', arguments: '{"foo":"bar"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    }));
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl), basicRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.response).toEqual({
      id: 'chatcmpl-1',
      model: 'test-model',
      content: 'Here is the plan',
      toolCalls: [{ id: 'call_1', name: 'inspect_diagram', arguments: '{"foo":"bar"}' }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it('produces a structured timeout error_code, never an unhandled throw, when the mock is slow', async () => {
    const { server, baseUrl } = await startMockServer(() => ({
      status: 200,
      body: {
        id: 'x',
        model: 'test-model',
        choices: [{ message: { content: 'late' }, finish_reason: 'stop' }],
      },
      delayMs: 300,
    }));
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl, { timeoutMs: 50 }), basicRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.error.errorCode).toBe('timeout');
  });

  it('produces a structured http_error error_code (with status) on a non-2xx mock response', async () => {
    const { server, baseUrl } = await startMockServer(() => ({
      status: 500,
      body: { error: 'boom' },
    }));
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl), basicRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.error).toEqual({
      errorCode: 'http_error',
      message: 'provider responded with status 500',
      httpStatus: 500,
    });
  });

  it('produces a structured malformed_response error_code when the mock returns an unexpected shape', async () => {
    const { server, baseUrl } = await startMockServer(() => ({
      status: 200,
      body: { unexpected: true },
    }));
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl), basicRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.error.errorCode).toBe('malformed_response');
  });

  it('rejects a request whose maxTokens exceeds the configured budget WITHOUT calling the provider', async () => {
    let requestCount = 0;
    const { server, baseUrl } = await startMockServer(() => {
      requestCount += 1;
      return {
        status: 200,
        body: { id: 'x', model: 'm', choices: [{ message: {}, finish_reason: 'stop' }] },
      };
    });
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl, { tokenBudget: 100 }), {
      ...basicRequest,
      maxTokens: 500,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.error.errorCode).toBe('token_budget_exceeded');
    expect(requestCount).toBe(0);
  });

  it('uses the decrypted token only as the outbound Authorization header, never in the returned result', async () => {
    const { server, baseUrl, receivedAuthHeaders } = await startMockServer(() => ({
      status: 200,
      body: {
        id: 'x',
        model: 'test-model',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      },
    }));
    activeServer = server;

    const result = await callProvider(baseConfig(baseUrl), basicRequest);

    expect(result.ok).toBe(true);
    // The provider DID receive the token, proving it was actually used...
    expect(receivedAuthHeaders).toEqual([`Bearer ${TEST_TOKEN}`]);
    // ...but it never appears anywhere in what callProvider hands back to its caller.
    expect(JSON.stringify(result)).not.toContain(TEST_TOKEN);
  });

  it('produces a structured invalid_token error_code, never a throw, when decryption fails', async () => {
    const { server, baseUrl } = await startMockServer(() => ({ status: 200, body: {} }));
    activeServer = server;

    const result = await callProvider(
      baseConfig(baseUrl, { encryptedToken: 'not-a-valid-ciphertext' }),
      basicRequest,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.error.errorCode).toBe('invalid_token');
  });
});
