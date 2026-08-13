import type { Role } from '@arch-canvas/auth';
import { ROLES } from '@arch-canvas/auth';
import { z } from 'zod';

/**
 * Known development placeholder secret (documented in infra/compose/.env.example).
 * Booting in production with any secret still equal to this value is refused.
 */
export const INSECURE_DEV_SECRET = 'dev-insecure-secret-change-me';

/** Env vars checked against the insecure dev default when NODE_ENV=production. */
const SECRET_ENV_VARS = ['SESSION_SECRET', 'ENCRYPTION_KEY'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(1).default(INSECURE_DEV_SECRET),
  ENCRYPTION_KEY: z.string().min(1).default(INSECURE_DEV_SECRET),
  /** Public origin the server is reachable at; scheme drives the session cookie's Secure flag. */
  PUBLIC_URL: z.string().min(1).default('http://localhost:3000'),
  /** Postgres connection string; matches infra/compose's server service default for local dev. */
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://arch_canvas:dev-insecure-secret-change-me@localhost:5432/arch_canvas'),
  /** MinIO/S3-compatible endpoint (infra/compose's `minio` service, T27). */
  S3_ENDPOINT: z.string().min(1).default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().min(1).default('arch-canvas-dev'),
  S3_SECRET_KEY: z.string().min(1).default(INSECURE_DEV_SECRET),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /**
   * Optional (AD-006/AD-009, F4/T81) — `ws-gateway`'s presence broadcaster
   * uses `RedisPresenceBroadcaster` when set, `InMemoryPresenceBroadcaster`
   * otherwise. The server always boots and works fully without it; presence
   * just stays scoped to a single process (consistent with AD-003's
   * single-process MVP) rather than crossing multiple `apps/server`
   * instances behind a load balancer.
   */
  REDIS_URL: z.string().min(1).optional(),
  /**
   * SEC-01: comma-separated allowlist of origins permitted to make
   * cross-site requests (`@fastify/cors`'s `origin` option, `core/server.ts`).
   * Empty by default — no cross-site origin is permitted until an operator
   * deliberately opts one in; same-origin requests are never affected by
   * CORS either way (browsers only send the `Origin` header cross-site).
   */
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  /**
   * OIDC-01/02/03 (T87) — all optional. The server boots and local
   * email/password auth works fully with none of these set; `GET
   * /auth/oidc/login`/`callback` respond 503 until `OIDC_ISSUER_URL`,
   * `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are ALL present (that trio
   * together is what "OIDC configured" means below).
   */
  OIDC_ISSUER_URL: z.string().min(1).optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /** ID token claim carrying the user's IdP groups. */
  OIDC_GROUP_CLAIM: z.string().min(1).default('groups'),
  /**
   * JSON object mapping an IdP group name to the workspace role granted for
   * it, e.g. `{"platform-team":"editor"}`. A group with no entry here never
   * grants any role — the map is an explicit ALLOWlist, never a default.
   */
  OIDC_GROUP_ROLE_MAP: z.string().default('{}'),
  /**
   * DEVIATION (T87, documented in tasks-f5.md's Status note): the task's
   * own config-field list (OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET/
   * GROUP_CLAIM/GROUP_ROLE_MAP) has no field naming which workspace an
   * OIDC-mapped role applies to, but `workspace_members.role` is stored
   * per-workspace (no global/org-wide role column exists anywhere in the
   * schema) — so a target workspace is structurally required for group
   * mapping to mean anything. Optional: when unset, OIDC login still
   * authenticates and creates a session (local auth is never weakened
   * either way), it just never provisions/updates any workspace membership
   * — a reasonable least-privilege default for an incompletely configured
   * deployment.
   */
  OIDC_DEFAULT_WORKSPACE_ID: z.string().min(1).optional(),
});

const ROLE_VALUES = ROLES as readonly [Role, ...Role[]];

/**
 * Parses and validates `OIDC_GROUP_ROLE_MAP`'s JSON. Returns `{}` for the
 * default `'{}'`. Throws a clear, operator-facing error on malformed JSON or
 * on any value that is not one of the five known `Role`s — this only runs
 * when OIDC is actually configured (see `loadConfig` below), so a stray/
 * malformed leftover env var never blocks boot for a deployment not using
 * OIDC at all.
 */
function parseOidcGroupRoleMap(raw: string): Record<string, Role> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid OIDC_GROUP_ROLE_MAP: not valid JSON. Expected an object like {"group-name":"editor"}.`,
    );
  }

  const shape = z.record(z.string(), z.enum(ROLE_VALUES));
  const result = shape.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Invalid OIDC_GROUP_ROLE_MAP: every value must be one of ${ROLE_VALUES.join(', ')}. ` +
        `Got: ${raw}`,
    );
  }
  return result.data;
}

/** Splits a CSV env value into trimmed, non-empty origins. `''` (the default) yields `[]`. */
function parseCorsAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  sessionSecret: string;
  encryptionKey: string;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  /** Optional — see the env schema's own doc comment on `REDIS_URL` above. */
  redisUrl?: string;
  /** SEC-01 — see the env schema's own doc comment on `CORS_ALLOWED_ORIGINS` above. Always an array, empty by default. */
  corsAllowedOrigins: string[];
  /**
   * OIDC-01/02/03 (T87) — present only when `OIDC_ISSUER_URL`/`CLIENT_ID`/
   * `CLIENT_SECRET` are ALL set; `undefined` means OIDC is not configured
   * (the routes respond 503, local auth is unaffected either way).
   */
  oidc?: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    groupClaim: string;
    groupRoleMap: Record<string, Role>;
    /** See `OIDC_DEFAULT_WORKSPACE_ID`'s doc comment above (Deviation). */
    defaultWorkspaceId?: string;
    /** Computed from `publicUrl` — never independently configurable (one less thing to misconfigure). */
    redirectUri: string;
  };
}

/**
 * Validates process env into an AppConfig. Throws with a clear, variable-naming
 * error when NODE_ENV=production and a secret is still the documented dev
 * placeholder (FND-03 / docs/product-spec.md §12).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  if (parsed.NODE_ENV === 'production') {
    for (const varName of SECRET_ENV_VARS) {
      if (parsed[varName] === INSECURE_DEV_SECRET) {
        throw new Error(
          `Refusing to start in production: ${varName} is still set to the known development placeholder ` +
            `("${INSECURE_DEV_SECRET}"). Set a unique, secret value for ${varName} before starting in production.`,
        );
      }
    }
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    sessionSecret: parsed.SESSION_SECRET,
    encryptionKey: parsed.ENCRYPTION_KEY,
    publicUrl: parsed.PUBLIC_URL,
    databaseUrl: parsed.DATABASE_URL,
    s3: {
      endpoint: parsed.S3_ENDPOINT,
      accessKeyId: parsed.S3_ACCESS_KEY,
      secretAccessKey: parsed.S3_SECRET_KEY,
      region: parsed.S3_REGION,
    },
    redisUrl: parsed.REDIS_URL,
    corsAllowedOrigins: parseCorsAllowedOrigins(parsed.CORS_ALLOWED_ORIGINS),
    oidc:
      parsed.OIDC_ISSUER_URL && parsed.OIDC_CLIENT_ID && parsed.OIDC_CLIENT_SECRET
        ? {
            issuerUrl: parsed.OIDC_ISSUER_URL,
            clientId: parsed.OIDC_CLIENT_ID,
            clientSecret: parsed.OIDC_CLIENT_SECRET,
            groupClaim: parsed.OIDC_GROUP_CLAIM,
            groupRoleMap: parseOidcGroupRoleMap(parsed.OIDC_GROUP_ROLE_MAP),
            defaultWorkspaceId: parsed.OIDC_DEFAULT_WORKSPACE_ID,
            redirectUri: `${parsed.PUBLIC_URL.replace(/\/$/, '')}/auth/oidc/callback`,
          }
        : undefined,
  };
}
