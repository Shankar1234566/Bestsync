/**
 * User profile routes: own summary, public profiles, editing, history.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap, isRecord, optionalString, USERNAME_RE, COUNTRY_RE } from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';

export function userRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/me',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      res.json({
        profile: ctx.profile.summary(userId),
        recentPerformances: ctx.profile.recentPerformances(userId, 10),
      });
    }),
  );

  router.patch(
    '/me',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const patch: { username?: string; country?: string; avatar?: string } = {};

      const username = optionalString(body, 'username', { max: 24, pattern: USERNAME_RE });
      if (username !== undefined) patch.username = username;
      const country = optionalString(body, 'country', { max: 60, pattern: COUNTRY_RE });
      if (country !== undefined) patch.country = country;
      const avatar = optionalString(body, 'avatar', { max: 8 });
      if (avatar !== undefined) patch.avatar = avatar;

      ctx.profile.update(userId, patch);
      res.json({ profile: ctx.profile.summary(userId) });
    }),
  );

  router.get(
    '/:username',
    wrap((req, res) => {
      const username = String(req.params.username ?? '');
      const profile = ctx.profile.publicProfile(username);
      const user = ctx.auth.byUsername(username);
      res.json({
        profile,
        isSelf: req.userId === profile.id,
        recentPerformances: user ? ctx.profile.recentPerformances(user.id, 10) : [],
      });
    }),
  );

  return router;
}
