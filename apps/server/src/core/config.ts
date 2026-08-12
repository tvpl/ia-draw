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
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  sessionSecret: string;
  encryptionKey: string;
  publicUrl: string;
  databaseUrl: string;
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
  };
}
