/**
 * Gamification routes: badges catalogue + daily/weekly challenge progress.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap } from '../http/helpers';
import { requireAuth } from '../middleware/auth';
import { BADGES, LEVELS } from '../../shared';

export function progressionRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/badges',
    requireAuth,
    wrap((req, res) => {
      const userId = req.userId!;
      const rows = ctx.db.all<{ badge_id: string; unlocked_at: number }>(
        'SELECT badge_id, unlocked_at FROM user_badges WHERE user_id = ?',
        userId,
      );
      const unlockedAt = new Map(rows.map((r) => [r.badge_id, r.unlocked_at]));
      res.json({
        badges: BADGES.map((badge) => ({
          ...badge,
          unlocked: unlockedAt.has(badge.id),
          unlockedAt: unlockedAt.get(badge.id) ?? null,
        })),
      });
    }),
  );

  router.get(
    '/challenges',
    requireAuth,
    wrap((req, res) => {
      const userId = req.userId!;
      const views = ctx.challenges.views(userId);
      res.json({
        daily: views.filter((v) => v.kind === 'daily'),
        weekly: views.filter((v) => v.kind === 'weekly'),
      });
    }),
  );

  router.get(
    '/levels',
    wrap((_req, res) => {
      res.json({ levels: LEVELS });
    }),
  );

  return router;
}
