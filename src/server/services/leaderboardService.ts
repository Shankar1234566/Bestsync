/**
 * Global leaderboards — server-side ranking with scope filters.
 * Only data that passed scoreService validation is ever ranked.
 */
import type { Database } from '../db/database';
import { badgeById, type LeaderboardEntry, type LeaderboardScope } from '../../shared';

export interface LeaderboardQuery {
  scope: LeaderboardScope;
  /** Required for scope === 'song'. */
  songId?: number | null;
  /** Required for scope === 'country'. */
  country?: string;
  /** User ids for scope === 'friends' (viewer included by the caller). */
  friendIds?: number[];
  limit?: number;
  now?: number;
}

interface BestRow {
  user_id: number;
  score: number;
  accuracy: number;
  wpm: number;
  song_id: number | null;
}

export class LeaderboardService {
  constructor(private readonly db: Database) {}

  list(query: LeaderboardQuery): LeaderboardEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const now = query.now ?? Date.now();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.scope === 'weekly') {
      conditions.push('ended_at >= ?');
      params.push(now - 7 * 86_400_000);
    } else if (query.scope === 'monthly') {
      conditions.push('ended_at >= ?');
      params.push(now - 30 * 86_400_000);
    }

    if (query.scope === 'song') {
      if (!query.songId) return [];
      conditions.push('song_id = ?');
      params.push(query.songId);
    }

    if (query.scope === 'friends') {
      const ids = (query.friendIds ?? []).filter((id) => Number.isInteger(id));
      if (ids.length === 0) return [];
      conditions.push(`user_id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const best = this.db.all<BestRow>(
      `SELECT user_id, score, accuracy, wpm, song_id FROM (
         SELECT user_id, score, accuracy, wpm, song_id,
                ROW_NUMBER() OVER (
                  PARTITION BY user_id
                  ORDER BY score DESC, accuracy DESC, wpm DESC
                ) AS rn
         FROM game_sessions
         ${whereSql}
       ) WHERE rn = 1
       ORDER BY score DESC, accuracy DESC, wpm DESC
       LIMIT ?`,
      ...params,
      limit,
    );

    if (best.length === 0) return [];

    // Country scope filters on the user, not the session.
    let rows = best;
    if (query.scope === 'country') {
      const country = (query.country ?? '').trim();
      if (!country) return [];
      const users = this.loadUsers(best.map((b) => b.user_id));
      rows = best.filter((b) => users.get(b.user_id)?.country === country);
    }

    const userIds = rows.map((r) => r.user_id);
    const users = this.loadUsers(userIds);
    const profiles = this.loadProfiles(userIds);
    const badges = this.loadBadges(userIds);

    return rows.map((row, index) => {
      const user = users.get(row.user_id);
      const profile = profiles.get(row.user_id);
      return {
        rank: index + 1,
        userId: row.user_id,
        username: user?.username ?? 'unknown',
        country: user?.country ?? '',
        avatar: user?.avatar ?? '',
        level: profile?.level ?? 1,
        score: row.score,
        accuracy: Math.round(row.accuracy * 100) / 100,
        wpm: Math.round(row.wpm * 10) / 10,
        badges: (badges.get(row.user_id) ?? []).filter((id) => badgeById(id) !== undefined),
        songId: row.song_id,
      };
    });
  }

  private loadUsers(ids: number[]): Map<number, { username: string; country: string; avatar: string }> {
    const map = new Map<number, { username: string; country: string; avatar: string }>();
    if (ids.length === 0) return map;
    const rows = this.db.all<{ id: number; username: string; country: string; avatar: string }>(
      `SELECT id, username, country, avatar FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    for (const row of rows) map.set(row.id, row);
    return map;
  }

  private loadProfiles(ids: number[]): Map<number, { level: number }> {
    const map = new Map<number, { level: number }>();
    if (ids.length === 0) return map;
    const rows = this.db.all<{ user_id: number; level: number }>(
      `SELECT user_id, level FROM profiles WHERE user_id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    for (const row of rows) map.set(row.user_id, row);
    return map;
  }

  private loadBadges(ids: number[]): Map<number, string[]> {
    const map = new Map<number, string[]>();
    if (ids.length === 0) return map;
    const rows = this.db.all<{ user_id: number; badge_id: string }>(
      `SELECT user_id, badge_id FROM user_badges WHERE user_id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    for (const row of rows) {
      const list = map.get(row.user_id) ?? [];
      list.push(row.badge_id);
      map.set(row.user_id, list);
    }
    return map;
  }
}
