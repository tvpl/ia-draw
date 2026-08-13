import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.js';

/**
 * Pino `redact` paths (OPS-05: "emit structured JSON logs with requestId while
 * redacting tokens, cookies and PII"). Fastify's default `req`/`res` log serializers
 * do NOT include headers at all, so nothing here would ever be redacted by default —
 * `buildLoggerOptions` below adds headers back into both serializers specifically so
 * this redaction has something real to act on (defense in depth: any future code path
 * that logs headers, or an object with one of these field names anywhere in the app,
 * is covered, not just the two literal cases this task's Done-when names).
 */
export const REDACT_PATHS: readonly string[] = [
  // Session cookie (AUTH-01's HttpOnly cookie) and bearer/proxy auth headers.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',

  // AI provider tokens (design.md's ai-engine component: "token cifrado
  // AES-256-GCM" at rest). No AI routes exist yet in F1 — this prepares the
  // redaction pattern ahead of F2, so a future route logging its decrypted token
  // (by field name, wherever it's nested one level deep) is covered from day one.
  'aiProviderToken',
  '*.aiProviderToken',
  'apiKey',
  '*.apiKey',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secretAccessKey',
  '*.secretAccessKey',
  'password',
  '*.password',

  // PII (OPS-05's "known PII fields — email in some log contexts", granularity
  // chosen here): redact the `email` field wherever it's logged, at the top level
  // or one level deep. User ids/roles/session tokens' non-secret metadata stay
  // visible — only the address itself is PII for this redaction's purposes.
  'email',
  '*.email',
];

const REDACT_CENSOR = '[REDACTED]';

/**
 * Renames Fastify's default `reqId` log field to `requestId` (OPS-05: "every HTTP
 * request log line includes requestId"). `requestIdLogLabel` is deprecated in favor
 * of a `logController` option fastify@5.11.3's public types don't yet expose as a
 * stable API — verified against the installed package (`node_modules/fastify/types`)
 * before choosing this over the newer, undocumented option. It still works exactly as
 * documented in this pinned version; only removed in fastify@6, which this project
 * isn't on.
 */
export const REQUEST_ID_LOG_LABEL = 'requestId';

export interface LoggerOverrides {
  /** Injectable pino destination — production leaves this unset (defaults to stdout); `logging.spec.ts` captures output here instead of writing to the real console. */
  stream?: { write(msg: string): void };
}

/**
 * Builds the `logger` option `buildServer` passes to Fastify: structured JSON (pino,
 * Fastify's default), redaction, and `req`/`res` serializers that include headers so
 * the redaction above is exercised for real instead of redacting fields that were
 * never logged in the first place.
 */
export function buildLoggerOptions(
  config: AppConfig,
  overrides: LoggerOverrides = {},
): FastifyServerOptions['logger'] {
  if (config.nodeEnv === 'test') {
    return { level: 'silent' };
  }

  return {
    level: 'info',
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    stream: overrides.stream,
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          host: request.headers.host,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
          headers: request.headers,
        };
      },
      // Fastify types this as `Partial<FastifyReply> & Pick<..., 'statusCode'>` —
      // only `statusCode` is guaranteed present (e.g. on an aborted request),
      // hence the optional-call guard on `getHeaders`.
      res(reply) {
        return {
          statusCode: reply.statusCode,
          headers: reply.getHeaders?.() ?? {},
        };
      },
    },
  };
}
