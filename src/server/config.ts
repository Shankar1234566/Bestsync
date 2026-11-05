/**
 * Server configuration loaded from environment variables.
 * No secrets are hardcoded — production refuses to boot without JWT_SECRET.
 */
import path from 'node:path';

export interface AppConfig {
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  dbPath: string;
  corsOrigins: string[];
  nodeEnv: string;
  isProduction: boolean;
  /** Directory served as static SPA build in production (may not exist in dev). */
  clientDist: string;
}

const DEV_JWT_SECRET = 'beatsync-dev-only-secret-do-not-use-in-production';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const jwtSecret = env.JWT_SECRET?.trim() || '';
  if (!jwtSecret) {
    if (isProduction) {
      throw new Error(
        'JWT_SECRET is required in production. Set it in the environment before starting BeatSync.',
      );
    }
    // Development/test convenience — clearly labelled, never used in production.
    env.JWT_SECRET = DEV_JWT_SECRET;
  }

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const dbPath =
    env.DB_PATH?.trim() || path.join(process.cwd(), 'beatsync-data', 'beatsync.db');

  const corsOrigins = (env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:4000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    port,
    jwtSecret: jwtSecret || DEV_JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
    dbPath,
    corsOrigins,
    nodeEnv,
    isProduction,
    clientDist: env.CLIENT_DIST?.trim() || path.join(process.cwd(), 'dist'),
  };
}
