import { buildServer, loadConfig, registerGracefulShutdown } from './core/index.js';

const config = loadConfig();
const app = buildServer(config);

registerGracefulShutdown(app, {
  onShutdownComplete: () => process.exit(0),
});

app.listen({ port: config.port, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error(error, 'failed to start server');
  process.exit(1);
});
