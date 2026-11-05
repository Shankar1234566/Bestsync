/**
 * Leaderboard routes. Ranking is always computed server-side.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap } from '../http/helpers';
import { authedUserId } from '../middleware/auth';
import { LEADERBOARD_SCOPES, type LeaderboardScope } from '../../shared';

export function leaderboardRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/',
    wrap((req, res) => {
      const rawScope = String(req.query.scope ?? 'global');
      const scope = (LEADERBOARD_SCOPES as string[]).includes(rawScope)
        ? (rawScope as LeaderboardScope)
        : 'global';
      const limit = Number(req.query.limit ?? 50);
      const songId = req.query.songId ? Number(req.query.songId) : null;
      const now = Date.now();

      if (scope === 'friends') {
        if (req.userId === undefined) {
          res.status(401).json({ error: 'Sign in to view the friends leaderboard.' });
          return;
        }
        const friendIds = [req.userId, ...ctx.social.friendIds(req.userId)];
        const entries = ctx.leaderboard.list({ scope, friendIds, limit, now });
        res.json({ scope, entries });
        return;
      }

      if (scope === 'country') {
        const explicit = typeof req.query.country === 'string' ? req.query.country.trim() : '';
        let country = explicit;
        if (!country && req.userId !== undefined) {
          country = ctx.auth.byId(req.userId)?.country ?? '';
        }
        if (!country) {
          res.status(400).json({ error: 'No country selected — set your country in your profile.' });
          return;
        }
        const entries = ctx.leaderboard.list({ scope, country, limit, now });
        res.json({ scope, country, entries });
        return;
      }

      if (scope === 'song') {
        if (!songId || !Number.isInteger(songId)) {
          res.status(400).json({ error: 'songId is required for the song leaderboard.' });
          return;
        }
        const entries = ctx.leaderboard.list({ scope, songId, limit, now });
        res.json({ scope, songId, entries });
        return;
      }

      const entries = ctx.leaderboard.list({ scope, limit, now });
      res.json({ scope, entries });
    }),
  );

  /** Viewer's own rank + score across scopes (for profile badges display). */
  router.get(
    '/me',
    wrap((req, res) => {
      if (req.userId === undefined) {
        res.status(401).json({ error: 'Sign in to see your rank.' });
        return;
      }
      const userId = authedUserId(req);
      const rank = ctx.scores.rankAfterScore(userId);
      const profile = ctx.profile.summary(userId);
      res.json({ rank, highestScore: profile.highestScore, level: profile.level });
    }),
  );

  return router;
}
