import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** infra/migrations lives 3 levels above both src/ and dist/ (packages/database/{src,dist}/..). */
export const MIGRATIONS_FOLDER = path.resolve(currentDir, '../../../infra/migrations');

/** One-shot migration runner (used by the `migrate` compose service and CI). */
export async function migrate(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool);
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
