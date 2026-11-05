/**
 * Friends routes: search, requests, accept/reject, list, remove.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap, isRecord, requireString, requireEnum } from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

export function friendRoutes(ctx: AppContext): Router {
  const router = Router();

  router.use(requireAuth);

  const requestLimiter = rateLimit({
    bucket: 'friend-request',
    windowMs: 60_000,
    max: 15,
  });

  router.get(
    '/',
    wrap((req, res) => {
      res.json(ctx.social.list(authedUserId(req)));
    }),
  );

  router.get(
    '/search',
    wrap((req, res) => {
      const userId = authedUserId(req);
      const query = String(req.query.q ?? '').slice(0, 40);
      res.json({ users: ctx.social.search(userId, query) });
    }),
  );

  router.post(
    '/request',
    requestLimiter,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const username = requireString(body, 'username', { min: 1, max: 24, label: 'Username' });
      const request = ctx.social.request(userId, username);
      res.status(201).json({ request });
    }),
  );

  router.post(
    '/:id/respond',
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const action = requireEnum(body, 'action', ['accept', 'reject'] as const);
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid request id.' });
        return;
      }
      ctx.social.respond(userId, id, action);
      res.json(ctx.social.list(userId));
    }),
  );

  router.delete(
    '/:userId',
    wrap((req, res) => {
      const userId = authedUserId(req);
      const otherId = Number(req.params.userId);
      if (!Number.isInteger(otherId)) {
        res.status(400).json({ error: 'Invalid user id.' });
        return;
      }
      ctx.social.remove(userId, otherId);
      res.json(ctx.social.list(userId));
    }),
  );

  return router;
}
