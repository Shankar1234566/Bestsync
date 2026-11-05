/**
 * Express application factory. `buildApp` wires middleware and routes;
 * `start`/`close` manage the HTTP + WebSocket lifecycle (used by index.ts
 * and by integration tests on ephemeral ports).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import type { AppConfig } from './config';
import { createContext, type AppContext } from './context';
import { attachUser } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './http/errors';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { songRoutes } from './routes/songs';
import { scoreRoutes } from './routes/scores';
import { leaderboardRoutes } from './routes/leaderboard';
import { progressionRoutes } from './routes/progression';
import { friendRoutes } from './routes/friends';
import { battleRoutes } from './routes/battles';
import { healthRoutes } from './routes/health';
import { BattleSocketServer } from './ws/battles';

export interface AppInstance {
  app: Express;
  ctx: AppContext;
  server: http.Server;
  wss: BattleSocketServer;
  start(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function buildApp(config: AppConfig): AppInstance {
  const ctx = createContext(config);
  const app = express();
  const startedAt = Date.now();

  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin (Vite proxy) requests send no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, config.corsOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(attachUser(config));

  // Coarse API-wide guard; routes add tighter buckets where abuse matters.
  app.use(
    '/api',
    rateLimit({
      bucket: 'api-global',
      windowMs: 60_000,
      max: 600,
    }),
  );

  app.use('/api/health', healthRoutes(startedAt));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/users', userRoutes(ctx));
  app.use('/api/songs', songRoutes(ctx));
  app.use('/api/scores', scoreRoutes(ctx));
  app.use('/api/leaderboard', leaderboardRoutes(ctx));
  app.use('/api/friends', friendRoutes(ctx));
  app.use('/api/battles', battleRoutes(ctx));
  app.use('/api', progressionRoutes(ctx));

  // API 404 as JSON — before the SPA fallback.
  app.use('/api', notFoundHandler);

  // Production: serve the built client and fall back to the SPA shell.
  const distIndex = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);
  const wss = new BattleSocketServer(server, ctx);

  return {
    app,
    ctx,
    server,
    wss,
    start(port = config.port): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const address = server.address();
          const boundPort = typeof address === 'object' && address ? address.port : port;
          resolve(boundPort);
        });
      });
    },
    async close(): Promise<void> {
      await wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.db.close();
    },
  };
}
