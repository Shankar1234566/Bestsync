/**
 * Daily/weekly challenge progress: reading views for the client and
 * authoritative progress updates after each validated session.
 */
import type { Database } from '../db/database';
import {
  ALL_CHALLENGES,
  DAILY_CHALLENGES,
  WEEKLY_CHALLENGES,
  challengeById,
  clampProgress,
  isChallengeCompleted,
  nextProgress,
  periodKey,
  type ChallengeDefinition,
  type ChallengeMetric,
  type ChallengeProgressView,
} from '../../shared';

export interface SessionObservations {
  chars: number;
  completed: boolean;
  accuracy: number;
  bestCombo: number;
  wpm: number;
}

interface ProgressRow {
  challenge_id: string;
  progress: number;
  completed: number;
  completed_at: number | null;
}

export interface ChallengeOutcome {
  completed: ChallengeDefinition[];
  xp: number;
}

export class ChallengeService {
  constructor(private readonly db: Database) {}

  /** Progress views for every active daily and weekly challenge. */
  views(userId: number, now = Date.now()): ChallengeProgressView[] {
    const date = new Date(now);
    const views: ChallengeProgressView[] = [];

    for (const kind of ['daily', 'weekly'] as const) {
      const key = periodKey(kind, date);
      const defs = kind === 'daily' ? DAILY_CHALLENGES : WEEKLY_CHALLENGES;
      const rows = this.db.all<ProgressRow>(
        `SELECT challenge_id, progress, completed, completed_at
         FROM challenge_progress
         WHERE user_id = ? AND period_key = ?`,
        userId,
        key,
      );
      const byId = new Map(rows.map((r) => [r.challenge_id, r]));

      for (const def of defs) {
        const row = byId.get(def.id);
        const progress = row?.progress ?? 0;
        views.push({
          ...def,
          progress: Math.round(progress * 10) / 10,
          completed: row?.completed === 1 || isChallengeCompleted(progress, def.target),
          completedAt: row?.completed_at ?? null,
          periodKey: key,
        });
      }
    }
    return views;
  }

  private observe(
    metric: ChallengeMetric,
    def: ChallengeDefinition,
    obs: SessionObservations,
    userId: number,
    now: number,
  ): number {
    switch (metric) {
      case 'charsTyped':
        return obs.chars;
      case 'songsCompleted':
        return obs.completed ? 1 : 0;
      case 'accuracySessions':
        return obs.accuracy >= (def.threshold ?? 0) && obs.completed ? 1 : 0;
      case 'bestCombo':
        return obs.bestCombo;
      case 'bestWpm':
        return obs.wpm;
      case 'daysActive':
        return this.countActiveDaysInPeriod(userId, def.kind, now);
      default:
        return 0;
    }
  }

  private countActiveDaysInPeriod(userId: number, kind: 'daily' | 'weekly', now: number): number {
    const currentKey = periodKey(kind, new Date(now));
    const rows = this.db.all<{ day: string }>(
      'SELECT day FROM play_days WHERE user_id = ?',
      userId,
    );
    return rows.filter((row) => {
      const day = new Date(`${row.day}T00:00:00Z`);
      return Number.isFinite(day.getTime()) && periodKey(kind, day) === currentKey;
    }).length;
  }

  /**
   * Apply one validated session to every active challenge.
   * Must run inside the caller's transaction.
   */
  applySession(userId: number, obs: SessionObservations, now = Date.now()): ChallengeOutcome {
    const date = new Date(now);
    const completed: ChallengeDefinition[] = [];
    let xp = 0;

    for (const def of ALL_CHALLENGES) {
      const key = periodKey(def.kind, date);
      const row = this.db.get<ProgressRow & { target: number }>(
        `SELECT challenge_id, progress, completed, completed_at, target
         FROM challenge_progress
         WHERE user_id = ? AND period_key = ? AND challenge_id = ?`,
        userId,
        key,
        def.id,
      );

      const previous = row?.progress ?? 0;
      const rawValue = this.observe(def.metric, def, obs, userId, now);
      const combined = nextProgress(previous, def.metric, rawValue);
      const progress = clampProgress(combined, def.target);
      const wasCompleted = row?.completed === 1;
      const nowCompleted = wasCompleted || isChallengeCompleted(progress, def.target);

      const completedAt = nowCompleted ? (row?.completed_at ?? now) : null;
      this.db.run(
        `INSERT INTO challenge_progress (user_id, period_key, challenge_id, progress, target, completed, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, period_key, challenge_id)
         DO UPDATE SET progress = excluded.progress,
                       target = excluded.target,
                       completed = excluded.completed,
                       updated_at = excluded.updated_at,
                       completed_at = excluded.completed_at`,
        userId,
        key,
        def.id,
        progress,
        def.target,
        nowCompleted ? 1 : 0,
        now,
        completedAt,
      );

      if (nowCompleted && !wasCompleted) {
        completed.push(def);
        xp += def.xpReward;
      }
    }

    return { completed, xp };
  }

  /** All challenge ids known to the system (used by tests and docs). */
  static get definitions(): ChallengeDefinition[] {
    return ALL_CHALLENGES;
  }

  static byId(id: string): ChallengeDefinition | undefined {
    return challengeById(id);
  }
}
