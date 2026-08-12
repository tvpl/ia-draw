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
import { registerJobsGracefulShutdown, startJobs } from './modules/jobs/index.js';

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

// Starting pg-boss (T28) requires an actual Postgres connection up front (unlike the
// lazy /health/ready check above) — if Postgres isn't reachable yet, jobs (and VER-01's
// automatic compaction) stay disabled rather than blocking the HTTP server from booting.
let jobs: Awaited<ReturnType<typeof startJobs>> | undefined;
try {
  jobs = await startJobs(config);
} catch (error) {
  app.log.warn({ error }, 'failed to start job queue — background jobs are disabled');
}

await registerAllModules(app, db, config, { jobs });

registerGracefulShutdown(app, {
  onShutdownComplete: () => {
    void pool.end().finally(() => process.exit(0));
  },
});

if (jobs) {
  registerJobsGracefulShutdown(jobs);
}

app.listen({ port: config.port, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error(error, 'failed to start server');
  process.exit(1);
});
