import * as schema from '@arch-canvas/database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  buildServer,
  loadConfig,
  registerAllModules,
  registerGracefulShutdown,
} from './core/index.js';

const config = loadConfig();

const pool = new Pool({ connectionString: config.databaseUrl });
const db = drizzle(pool, { schema });

const app = buildServer(config, {
  dependencyChecks: [
    {
      name: 'postgres',
      check: async () => {
        await db.execute(sql`select 1`);
        return true;
      },
    },
  ],
});

await registerAllModules(app, db, config);

registerGracefulShutdown(app, {
  onShutdownComplete: () => {
    void pool.end().finally(() => process.exit(0));
  },
});

app.listen({ port: config.port, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error(error, 'failed to start server');
  process.exit(1);
});
