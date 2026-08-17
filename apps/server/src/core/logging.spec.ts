import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { redactSensitiveUrl } from './logging.js';
import { buildServer } from './server.js';

/**
 * NODE_ENV=test makes `buildLoggerOptions` return `{ level: 'silent' }` (existing
 * convention, keeps normal test runs quiet) — these tests need real log output to
 * assert on, so they build a `development` config and capture pino's stream instead
 * of letting it hit the real console.
 */
function devConfigWithCapturedLogs() {
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x/x' });
  const lines: string[] = [];
  const stream = { write: (msg: string) => void lines.push(msg) };
  return { config, lines, stream };
}

describe('structured JSON log redaction (T36, OPS-05)', () => {
  it('an Authorization: Bearer header is never present in plaintext in the log output', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/x', async () => ({ ok: true }));
    await app.ready();

    await app.inject({
      method: 'GET',
      url: '/x',
      headers: { authorization: 'Bearer secret-token-abc123' },
    });
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('secret-token-abc123');
    expect(output).toContain('"authorization":"[REDACTED]"');
  });

  it('a session cookie in Set-Cookie is redacted in the log output', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/x', async (_request, reply) => {
      reply.header('set-cookie', 'session=super-secret-session-token; HttpOnly; SameSite=Lax');
      return { ok: true };
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/x' });
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('super-secret-session-token');
    expect(output).toContain('"set-cookie":"[REDACTED]"');
  });

  it('an incoming Cookie request header is also redacted (not just the outgoing Set-Cookie)', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/x', async () => ({ ok: true }));
    await app.ready();

    await app.inject({
      method: 'GET',
      url: '/x',
      headers: { cookie: 'session=incoming-secret-cookie-value' },
    });
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('incoming-secret-cookie-value');
    expect(output).toContain('"cookie":"[REDACTED]"');
  });

  it('every HTTP request log line includes requestId', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/x', async () => ({ ok: true }));
    await app.ready();

    await app.inject({ method: 'GET', url: '/x' });
    await app.close();

    expect(lines.length).toBeGreaterThanOrEqual(2); // "incoming request" + "request completed"
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.requestId).toBeDefined();
      expect(typeof parsed.requestId).toBe('string');
    }
  });

  it('an AI provider token logged anywhere (field name, prepared ahead of F2) is redacted, not just headers', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    await app.ready();

    app.log.info({ aiProviderToken: 'sk-real-secret-value' }, 'calling AI provider');
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('sk-real-secret-value');
    expect(output).toContain('"aiProviderToken":"[REDACTED]"');
  });

  it('an email field nested one level deep is redacted, while a sibling non-PII field stays visible', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    await app.ready();

    app.log.info({ user: { id: 'user-123', email: 'person@example.com' } }, 'user logged in');
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('person@example.com');
    expect(output).toContain('"email":"[REDACTED]"');
    expect(output).toContain('"id":"user-123"');
  });
});

describe('credential-bearing URLs are redacted in the log (T1, SHR-23..26)', () => {
  it('the share token segment is replaced by [REDACTED] in the logged url (SHR-23)', () => {
    expect(redactSensitiveUrl('/share/abc123')).toBe('/share/[REDACTED]');
  });

  it('the ticket query parameter value is replaced by [REDACTED] in the logged url (SHR-25)', () => {
    expect(redactSensitiveUrl('/ws/diagrams/d-1?ticket=abc123')).toBe(
      '/ws/diagrams/d-1?ticket=[REDACTED]',
    );
  });

  it('a url carrying neither credential comes back byte-for-byte identical', () => {
    expect(redactSensitiveUrl('/diagrams/d-1/bootstrap?format=json')).toBe(
      '/diagrams/d-1/bootstrap?format=json',
    );
  });

  it('a real GET /share/:token request never writes the token in plaintext to the log (SHR-24)', async () => {
    const { config, lines, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/share/:token', async () => ({ ok: true }));
    await app.ready();

    await app.inject({ method: 'GET', url: '/share/real-share-token-abc123' });
    await app.close();

    const output = lines.join('\n');
    expect(output).not.toContain('real-share-token-abc123');
    expect(output).toContain('"url":"/share/[REDACTED]"');
  });

  it('redaction touches only the logged value — the response body still receives the original url (SHR-26)', async () => {
    const { config, stream } = devConfigWithCapturedLogs();
    const app = buildServer(config, { loggerOverrides: { stream } });
    app.get('/share/:token', async (request) => ({ seenByHandler: request.url }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/share/real-share-token-abc123' });
    await app.close();

    expect(response.json()).toEqual({ seenByHandler: '/share/real-share-token-abc123' });
  });
});
