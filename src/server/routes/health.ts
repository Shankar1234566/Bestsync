/**
 * Health/readiness endpoint used by monitoring and CI smoke tests.
 */
import { Router } from 'express';
import { wrap } from '../http/helpers';

export function healthRoutes(startedAt: number): Router {
  const router = Router();

  router.get(
    '/',
    wrap((_req, res) => {
      res.json({
        status: 'ok',
        service: 'beatsync-api',
        uptimeMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      });
    }),
  );

  return router;
}
