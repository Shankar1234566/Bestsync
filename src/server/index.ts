/**
 * BeatSync API entry point.
 */
import { loadConfig } from './config';
import { buildApp } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const instance = buildApp(config);
  const port = await instance.start(config.port);

  console.log(`[beatsync] API listening on http://localhost:${port}`);
  console.log(`[beatsync] database: ${config.dbPath}`);
  console.log(`[beatsync] environment: ${config.nodeEnv}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[beatsync] ${signal} received — shutting down…`);
    try {
      await instance.close();
      process.exit(0);
    } catch (error) {
      console.error('[beatsync] shutdown error:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[beatsync] unhandled rejection:', reason);
  });
}

main().catch((error) => {
  console.error('[beatsync] failed to start:', error);
  process.exit(1);
});
