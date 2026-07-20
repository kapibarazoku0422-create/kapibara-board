import { app } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Yohaku Board listening on 0.0.0.0:${config.port} (${config.nodeEnv})`);
});

server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down gracefully`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
