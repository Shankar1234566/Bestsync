/**
 * Score submission route — the only write path into leaderboards, XP and
 * badges. All validation lives in ScoreService; this layer only parses input.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import {
  wrap,
  isRecord,
  requireEnum,
  requireNumber,
  requireInt,
} from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { GAME_MODES, type ScoreSubmission } from '../../shared';

export function scoreRoutes(ctx: AppContext): Router {
  const router = Router();

  const submitLimiter = rateLimit({
    bucket: 'score-submit',
    windowMs: 60_000,
    max: 30,
  });

  router.post(
    '/',
    requireAuth,
    submitLimiter,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};

      const songUrl =
        typeof body.songUrl === 'string' && body.songUrl.trim().length > 0
          ? body.songUrl.trim()
          : null;

      const submission: ScoreSubmission = {
        songUrl,
        mode: requireEnum(body, 'mode', GAME_MODES),
        wpm: requireNumber(body, 'wpm', { min: 0, max: 1000 }),
        cpm: requireNumber(body, 'cpm', { min: 0, max: 10000 }),
        accuracy: requireNumber(body, 'accuracy', { min: 0, max: 100 }),
        correctChars: requireInt(body, 'correctChars', { min: 0, max: 5_000_000 }),
        incorrectChars: requireInt(body, 'incorrectChars', { min: 0, max: 5_000_000 }),
        totalMistakes: requireInt(body, 'totalMistakes', { min: 0, max: 5_000_000 }),
        keystrokes: requireInt(body, 'keystrokes', { min: 0, max: 10_000_000 }),
        bestCombo: requireInt(body, 'bestCombo', { min: 0, max: 5_000_000 }),
        score: requireInt(body, 'score', { min: 0, max: 100_000_000 }),
        completion: requireNumber(body, 'completion', { min: 0, max: 100 }),
        elapsedMs: requireInt(body, 'elapsedMs', { min: 0, max: 12 * 60 * 60 * 1000 }),
        linesCompleted: requireInt(body, 'linesCompleted', { min: 0, max: 100_000 }),
        linesMissed: requireInt(body, 'linesMissed', { min: 0, max: 100_000 }),
        totalLines: requireInt(body, 'totalLines', { min: 0, max: 100_000 }),
        tempoRate: requireNumber(body, 'tempoRate', { min: 0.25, max: 2 }),
        adaptiveTempo: body.adaptiveTempo === true,
      };

      const ack = ctx.scores.submit(userId, submission);
      res.status(201).json(ack);
    }),
  );

  /** Plausibility limits — lets the client explain rules before submitting. */
  router.get(
    '/limits',
    wrap((_req, res) => {
      res.json({ limits: { minSessionMs: 5000, maxWpm: 350 } });
    }),
  );

  return router;
}
