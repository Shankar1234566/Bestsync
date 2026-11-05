/**
 * Profile reads/updates and play-streak bookkeeping.
 */
import type { Database } from '../db/database';
import { HttpError, COUNTRY_RE, USERNAME_RE } from '../http/helpers';
import { badgeById, levelForXp, xpToNextLevel, type ProfileSummary } from '../../shared';
import type { AuthService, ProfileRow, UserRow } from './authService';

export interface SessionRow {
  id: number;
  song_id: number | null;
  mode: string;
  ended_at: number;
  wpm: number;
  accuracy: number;
  score: number;
  completion: number;
  tempo_rate: number;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function previousUtcDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  summary(userId: number): ProfileSummary {
    const user = this.auth.byId(userId);
    const profile = this.auth.ensureProfile(userId);
    if (!user) throw new HttpError(404, 'User not found.');

    const badges = this.db
      .all<{ badge_id: string }>('SELECT badge_id FROM user_badges WHERE user_id = ?', userId)
      .map((r) => r.badge_id)
      .filter((id) => badgeById(id) !== undefined);

    const higherScores = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM profiles WHERE highest_score > ?',
      profile.highest_score,
    );
    const totalUsers = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM profiles');
    const globalRank =
      (higherScores?.c ?? 0) + 1 <= (totalUsers?.c ?? 1)
        ? (higherScores?.c ?? 0) + 1
        : null;

    const averageAccuracy =
      profile.accuracy_count > 0 ? profile.accuracy_sum / profile.accuracy_count : 0;

    return {
      id: user.id,
      username: user.username,
      country: user.country,
      avatar: user.avatar,
      level: profile.level,
      levelName: levelForXp(profile.xp).name,
      xp: profile.xp,
      xpToNextLevel: xpToNextLevel(profile.xp),
      totalSongsCompleted: profile.total_songs_completed,
      averageAccuracy: Math.round(averageAccuracy * 100) / 100,
      bestWpm: profile.best_wpm,
      highestScore: profile.highest_score,
      currentStreak: profile.current_streak,
      longestStreak: profile.longest_streak,
      totalChars: profile.total_chars,
      badges,
      globalRank,
      createdAt: user.created_at,
    };
  }

  publicProfile(username: string): ProfileSummary {
    const user = this.auth.byUsername(username);
    if (!user) throw new HttpError(404, 'User not found.');
    return this.summary(user.id);
  }

  recentPerformances(userId: number, limit = 10): SessionRow[] {
    return this.db.all<SessionRow>(
      `SELECT id, song_id, mode, ended_at, wpm, accuracy, score, completion, tempo_rate
       FROM game_sessions
       WHERE user_id = ?
       ORDER BY ended_at DESC
       LIMIT ?`,
      userId,
      Math.min(Math.max(limit, 1), 50),
    );
  }

  update(
    userId: number,
    patch: { username?: string; country?: string; avatar?: string },
  ): { user: UserRow; profile: ProfileRow } {
    const user = this.auth.byId(userId);
    if (!user) throw new HttpError(404, 'User not found.');

    if (patch.username !== undefined && patch.username !== user.username) {
      if (!USERNAME_RE.test(patch.username)) {
        throw new HttpError(400, 'Username must be 3–24 letters, numbers or underscores.', {
          username: 'invalid_format',
        });
      }
      const taken = this.db.get<{ id: number }>(
        'SELECT id FROM users WHERE username = ? AND id <> ?',
        patch.username,
        userId,
      );
      if (taken) throw new HttpError(409, 'That username is already taken.', { username: 'taken' });
      this.db.run('UPDATE users SET username = ? WHERE id = ?', patch.username, userId);
    }

    if (patch.country !== undefined) {
      if (!COUNTRY_RE.test(patch.country)) {
        throw new HttpError(400, 'Country contains unsupported characters.', {
          country: 'invalid_format',
        });
      }
      this.db.run('UPDATE users SET country = ? WHERE id = ?', patch.country.trim(), userId);
    }

    if (patch.avatar !== undefined) {
      if (patch.avatar.length > 8) {
        throw new HttpError(400, 'Avatar must be a short emoji or initials.', {
          avatar: 'too_long',
        });
      }
      this.db.run('UPDATE users SET avatar = ? WHERE id = ?', patch.avatar, userId);
    }

    return { user: this.auth.byId(userId)!, profile: this.auth.ensureProfile(userId) };
  }

  /**
   * Record that the user played today: updates streak counters and the
   * `play_days` table (drives the weekly "Show Up" challenge).
   * Returns the current streak after the update.
   */
  recordPlay(userId: number): number {
    const profile = this.auth.ensureProfile(userId);
    const today = utcDay();

    if (profile.last_play_date === today) {
      this.db.run(
        'INSERT OR IGNORE INTO play_days (user_id, day) VALUES (?, ?)',
        userId,
        today,
      );
      return profile.current_streak;
    }

    let streak = 1;
    if (profile.last_play_date === previousUtcDay(today)) {
      streak = profile.current_streak + 1;
    }

    const longest = Math.max(profile.longest_streak, streak);
    this.db.run(
      `UPDATE profiles
         SET current_streak = ?, longest_streak = ?, last_play_date = ?
       WHERE user_id = ?`,
      streak,
      longest,
      today,
      userId,
    );
    this.db.run('INSERT OR IGNORE INTO play_days (user_id, day) VALUES (?, ?)', userId, today);
    return streak;
  }

  /** Distinct play days within an ISO day range (inclusive). */
  countActiveDays(userId: number, fromDay: string, toDay: string): number {
    const row = this.db.get<{ c: number }>(
      'SELECT COUNT(DISTINCT day) AS c FROM play_days WHERE user_id = ? AND day >= ? AND day <= ?',
      userId,
      fromDay,
      toDay,
    );
    return row?.c ?? 0;
  }

  currentStreak(userId: number): number {
    return this.auth.ensureProfile(userId).current_streak;
  }
}
