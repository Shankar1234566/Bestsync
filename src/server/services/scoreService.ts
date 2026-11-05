/**
 * Score submission — the server-side authority for XP, levels, badges and
 * challenge progress. Every submission is re-validated: plausibility limits,
 * accuracy/keystroke consistency, WPM-vs-duration consistency and full score
 * reproduction with the exact shared formula. Client numbers are never
 * trusted at face value.
 */
import type { Database } from '../db/database';
import { HttpError } from '../http/helpers';
import {
  GAME_MODES,
  BADGES,
  badgeById,
  computeScore,
  computeXp,
  evaluateBadges,
  levelForXp,
  parsePlayerUrl,
  validateScorePlausibility,
  type BadgeDefinition,
  type GameMode,
  type ScoreAck,
  type ScoreSubmission,
} from '../../shared';
import type { AuthService } from './authService';
import { ProfileService } from './profileService';
import { SongService } from './songService';
import { ChallengeService } from './challengeService';

/** Tolerance when reproducing the client's score server-side (frame drift). */
const SCORE_TOLERANCE = 0.1;
const SCORE_ABSOLUTE_FLOOR = 5;

export class ScoreService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly profile: ProfileService,
    private readonly songs: SongService,
    private readonly challenges: ChallengeService,
  ) {}

  /**
   * Validate and persist one completed game session.
   * Throws 422 with a clear reason when a submission looks fabricated.
   */
  submit(userId: number, sub: ScoreSubmission): ScoreAck {
    this.validate(sub);

    // Re-validate the song link exactly like the loader does.
    let songId: number | null = null;
    if (sub.songUrl) {
      const detection = parsePlayerUrl(sub.songUrl);
      if (!detection.valid || !detection.normalizedUrl) {
        throw new HttpError(422, detection.reason ?? 'Invalid song link.', { songUrl: 'invalid' });
      }
      songId = this.songs.upsert(detection).id;
    }

    const expectedScore = computeScore({
      correctChars: sub.correctChars,
      linesCompleted: sub.linesCompleted,
      bestCombo: sub.bestCombo,
      accuracy: sub.accuracy,
      completion: sub.completion,
      mode: sub.mode,
      tempoRate: sub.tempoRate,
    });
    const allowedDrift = Math.max(expectedScore * SCORE_TOLERANCE, SCORE_ABSOLUTE_FLOOR);
    if (Math.abs(expectedScore - sub.score) > allowedDrift) {
      throw new HttpError(422, 'Score does not match the reported statistics.', {
        score: 'mismatch',
      });
    }

    const previous = this.auth.ensureProfile(userId);
    const previousLevel = previous.level;

    const now = Date.now();
    const completed = sub.completion >= 100;
    const streak = this.profile.recordPlay(userId);

    const outcome = this.db.transaction(() => {
      // 1. Profile aggregates.
      this.db.run(
        `UPDATE profiles SET
           total_songs_completed = total_songs_completed + ?,
           clean_runs = clean_runs + ?,
           accuracy_sum = accuracy_sum + ?,
           accuracy_count = accuracy_count + 1,
           best_wpm = MAX(best_wpm, ?),
           best_combo = MAX(best_combo, ?),
           highest_score = MAX(highest_score, ?),
           total_chars = total_chars + ?
         WHERE user_id = ?`,
        completed ? 1 : 0,
        completed && sub.accuracy >= 90 ? 1 : 0,
        sub.accuracy,
        sub.wpm,
        sub.bestCombo,
        sub.score,
        sub.correctChars,
        userId,
      );

      // 2. Session row (authoritative record).
      const session = this.db.run(
        `INSERT INTO game_sessions
           (user_id, song_id, mode, status, started_at, ended_at, elapsed_ms,
            wpm, cpm, accuracy, correct_chars, incorrect_chars, total_mistakes,
            keystrokes, best_combo, score, xp_earned, completion, tempo_rate,
            adaptive_tempo, lines_completed, total_lines)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        userId,
        songId,
        sub.mode,
        now - sub.elapsedMs,
        now,
        Math.round(sub.elapsedMs),
        sub.wpm,
        sub.cpm,
        sub.accuracy,
        sub.correctChars,
        sub.incorrectChars,
        sub.totalMistakes,
        sub.keystrokes,
        sub.bestCombo,
        sub.score,
        sub.completion,
        sub.tempoRate,
        sub.adaptiveTempo ? 1 : 0,
        sub.linesCompleted,
        sub.totalLines,
      );

      // 3. XP: base run + challenge rewards.
      const runXp = computeXp({
        score: sub.score,
        completion: sub.completion,
        accuracy: sub.accuracy,
        bestCombo: sub.bestCombo,
        streak,
      });
      const challengeOutcome = this.challenges.applySession(
        userId,
        {
          chars: sub.correctChars,
          completed,
          accuracy: sub.accuracy,
          bestCombo: sub.bestCombo,
          wpm: sub.wpm,
        },
        now,
      );
      const totalXp = runXp + challengeOutcome.xp;

      const updated = this.auth.ensureProfile(userId);
      const newXp = updated.xp + totalXp;
      const newLevel = levelForXp(newXp).level;
      this.db.run(
        'UPDATE profiles SET xp = ?, level = ? WHERE user_id = ?',
        newXp,
        newLevel,
        userId,
      );
      this.db.run(
        'INSERT INTO xp_ledger (user_id, amount, reason, session_id, created_at) VALUES (?, ?, ?, ?, ?)',
        userId,
        runXp,
        'session-complete',
        session.lastInsertRowid,
        now,
      );
      if (challengeOutcome.xp > 0) {
        this.db.run(
          'INSERT INTO xp_ledger (user_id, amount, reason, session_id, created_at) VALUES (?, ?, ?, ?, ?)',
          userId,
          challengeOutcome.xp,
          'challenge-reward',
          session.lastInsertRowid,
          now,
        );
      }
      this.db.run('UPDATE game_sessions SET xp_earned = ? WHERE id = ?', totalXp, session.lastInsertRowid);

      // 4. Global rank (by highest score) — needed for the Global Star badge.
      const rank = this.rankAfterScore(userId);

      // 5. Badges — evaluate fresh unlocks only.
      const owned = new Set(
        this.db
          .all<{ badge_id: string }>('SELECT badge_id FROM user_badges WHERE user_id = ?', userId)
          .map((r) => r.badge_id),
      );
      const qualified = evaluateBadges({
        session: {
          accuracy: sub.accuracy,
          completion: sub.completion,
          bestCombo: sub.bestCombo,
          wpm: sub.wpm,
          totalMistakes: sub.totalMistakes,
          songsCompleted: completed ? 1 : 0,
        },
        profile: {
          totalSongsCompleted: completed
            ? updated.total_songs_completed + 1
            : updated.total_songs_completed,
          bestWpm: Math.max(updated.best_wpm, sub.wpm),
          cleanRuns:
            updated.clean_runs + (completed && sub.accuracy >= 90 ? 1 : 0),
          streak,
        },
        rank,
      });

      const unlocked: BadgeDefinition[] = [];
      for (const badgeId of BADGES.map((b) => b.id)) {
        if (owned.has(badgeId)) continue;
        if (!qualified.includes(badgeId)) continue;
        this.db.run(
          'INSERT OR IGNORE INTO user_badges (user_id, badge_id, unlocked_at) VALUES (?, ?, ?)',
          userId,
          badgeId,
          now,
        );
        const def = badgeById(badgeId);
        if (def) unlocked.push(def);
      }

      return {
        sessionId: session.lastInsertRowid,
        totalXp,
        newLevel,
        unlocked,
        challengesCompleted: challengeOutcome.completed,
        rank,
      };
    });

    return {
      accepted: true,
      sessionId: outcome.sessionId,
      xpGained: outcome.totalXp,
      level: outcome.newLevel,
      levelName: levelForXp(this.auth.ensureProfile(userId).xp).name,
      leveledUp: outcome.newLevel > previousLevel,
      unlockedBadges: outcome.unlocked,
      challengesCompleted: outcome.challengesCompleted,
      rank: outcome.rank,
    };
  }

  /** 1-based global rank by highest score (null when the user never scored). */
  rankAfterScore(userId: number): number | null {
    const profile = this.auth.ensureProfile(userId);
    if (profile.highest_score <= 0) return null;
    const higher = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM profiles WHERE highest_score > ?',
      profile.highest_score,
    );
    return (higher?.c ?? 0) + 1;
  }

  /** Full validation — every failure returns an actionable 422 message. */
  private validate(sub: ScoreSubmission): void {
    if (!GAME_MODES.includes(sub.mode as GameMode)) {
      throw new HttpError(422, 'Unknown game mode.', { mode: 'invalid' });
    }
    if (!Number.isFinite(sub.tempoRate) || sub.tempoRate < 0.25 || sub.tempoRate > 2) {
      throw new HttpError(422, 'Tempo rate out of range.', { tempoRate: 'invalid' });
    }
    if (sub.totalLines < 0 || sub.linesCompleted < 0 || sub.linesMissed < 0) {
      throw new HttpError(422, 'Line counters cannot be negative.', { lines: 'invalid' });
    }
    if (sub.linesCompleted + sub.linesMissed > sub.totalLines) {
      throw new HttpError(422, 'More lines processed than exist in the song.', {
        lines: 'invalid',
      });
    }
    if (sub.totalLines > 0) {
      const minCompletion = (sub.linesCompleted / sub.totalLines) * 100;
      if (sub.completion + 0.5 < minCompletion) {
        throw new HttpError(422, 'Completion does not match completed lines.', {
          completion: 'mismatch',
        });
      }
    }
    if (!Number.isFinite(sub.cpm) || sub.cpm < 0) {
      throw new HttpError(422, 'CPM must be a non-negative number.', { cpm: 'invalid' });
    }

    const problem = validateScorePlausibility({
      wpm: sub.wpm,
      cpm: sub.cpm,
      accuracy: sub.accuracy,
      correctChars: sub.correctChars,
      totalMistakes: sub.totalMistakes,
      keystrokes: sub.keystrokes,
      score: sub.score,
      completion: sub.completion,
      elapsedMs: sub.elapsedMs,
      mode: sub.mode,
      tempoRate: sub.tempoRate,
    });
    if (problem) throw new HttpError(422, problem, { submission: 'implausible' });
  }
}
