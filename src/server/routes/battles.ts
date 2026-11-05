/**
 * Battle REST endpoints — realtime traffic flows over /ws (ws/battles.ts).
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap, isRecord, requireString, requireEnum } from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { GAME_MODES, type GameMode } from '../../shared';

export function battleRoutes(ctx: AppContext): Router {
  const router = Router();

  router.use(requireAuth);

  const createLimiter = rateLimit({
    bucket: 'battle-create',
    windowMs: 60_000,
    max: 10,
  });

  router.get(
    '/active',
    wrap((req, res) => {
      res.json({ battle: ctx.battles.activeBattleFor(authedUserId(req)) });
    }),
  );

  router.post(
    '/',
    createLimiter,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const songUrl = requireString(body, 'songUrl', { max: 2048, label: 'Song link' });
      const mode = requireEnum<GameMode>(body, 'mode', GAME_MODES);
      const battle = ctx.battles.create(userId, {
        songUrl,
        mode: mode === 'battle' ? 'battle' : 'challenge',
      });
      res.status(201).json({ battle });
    }),
  );

  router.post(
    '/join',
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const code = requireString(body, 'code', { min: 4, max: 12, label: 'Battle code' });
      const battle = ctx.battles.join(userId, code);
      res.json({ battle });
    }),
  );

  router.get(
    '/:id/standings',
    wrap((req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid battle id.' });
        return;
      }
      res.json(ctx.battles.standings(id));
    }),
  );

  router.post(
    '/:id/forfeit',
    wrap((req, res) => {
      const userId = authedUserId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid battle id.' });
        return;
      }
      ctx.battles.cancel(id, userId);
      res.json({ battle: ctx.battles.byId(id) ? ctx.battles.standings(id).battle : null });
    }),
  );

  return router;
}
