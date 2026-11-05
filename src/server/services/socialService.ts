/**
 * Friends: search, requests, accept/reject, list and friend ids.
 */
import type { Database } from '../db/database';
import { HttpError } from '../http/helpers';
import type { Friend, FriendRequest, FriendStatus, PublicUser } from '../../shared';

interface FriendUserRow {
  id: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  best_wpm: number;
  highest_score: number;
}

const FRIEND_SELECT = `
  SELECT u.id, u.username, u.country, u.avatar,
         COALESCE(p.level, 1) AS level,
         COALESCE(p.best_wpm, 0) AS best_wpm,
         COALESCE(p.highest_score, 0) AS highest_score
  FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id
`;

export class SocialService {
  constructor(private readonly db: Database) {}

  /** Username search — exact prefix first, then substring. Excludes viewer. */
  search(viewerId: number, query: string, limit = 10): PublicUser[] {
    const q = query.trim();
    if (q.length < 1) return [];
    const rows = this.db.all<{
      id: number;
      username: string;
      country: string;
      avatar: string;
      level: number;
      xp: number;
    }>(
      `SELECT u.id, u.username, u.country, u.avatar,
              COALESCE(p.level, 1) AS level,
              COALESCE(p.xp, 0) AS xp
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id <> ? AND u.username LIKE ?
       ORDER BY (u.username = ?) DESC, LENGTH(u.username), u.username
       LIMIT ?`,
      viewerId,
      `%${q.replace(/[%_]/g, '')}%`,
      q,
      Math.min(Math.max(limit, 1), 25),
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      country: r.country,
      avatar: r.avatar,
      level: r.level,
      xp: r.xp,
    }));
  }

  list(userId: number): { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] } {
    const rows = this.db.all<{
      id: number;
      requester_id: number;
      addressee_id: number;
      status: FriendStatus;
      created_at: number;
    }>(
      `SELECT id, requester_id, addressee_id, status, created_at
       FROM friends
       WHERE requester_id = ? OR addressee_id = ?
       ORDER BY created_at DESC`,
      userId,
      userId,
    );

    const friends: Friend[] = [];
    const incoming: FriendRequest[] = [];
    const outgoing: FriendRequest[] = [];

    for (const row of rows) {
      const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
      const direction = row.requester_id === userId ? 'outgoing' : 'incoming';
      const user = this.loadUser(otherId);
      if (!user) continue;

      if (row.status === 'accepted') {
        friends.push({
          id: user.id,
          username: user.username,
          country: user.country,
          avatar: user.avatar,
          level: user.level,
          bestWpm: user.best_wpm,
          highestScore: user.highest_score,
        });
      } else if (row.status === 'pending') {
        const request: FriendRequest = {
          id: row.id,
          username: user.username,
          country: user.country,
          avatar: user.avatar,
          level: user.level,
          status: row.status,
          direction,
        };
        if (direction === 'incoming') incoming.push(request);
        else outgoing.push(request);
      }
    }

    return { friends, incoming, outgoing };
  }

  friendIds(userId: number): number[] {
    const rows = this.db.all<{ other_id: number }>(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS other_id
       FROM friends
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      userId,
      userId,
      userId,
    );
    return rows.map((r) => r.other_id);
  }

  request(fromUserId: number, toUsername: string): FriendRequest {
    const target = this.db.get<{ id: number }>(
      'SELECT id FROM users WHERE username = ?',
      toUsername.trim(),
    );
    if (!target) throw new HttpError(404, 'No user with that username.');
    if (target.id === fromUserId) {
      throw new HttpError(400, 'You cannot add yourself as a friend.');
    }

    const existing = this.db.get<{ id: number; status: string; requester_id: number }>(
      'SELECT id, status, requester_id FROM friends WHERE requester_id = ? AND addressee_id = ? OR requester_id = ? AND addressee_id = ?',
      fromUserId,
      target.id,
      target.id,
      fromUserId,
    );

    if (existing) {
      if (existing.status === 'accepted') {
        throw new HttpError(409, 'You are already friends.');
      }
      if (existing.status === 'pending') {
        throw new HttpError(409, 'A friend request is already pending.');
      }
      // Previously rejected/blocked — allow a fresh request from the original sender.
      this.db.run(
        `UPDATE friends SET requester_id = ?, addressee_id = ?, status = 'pending', created_at = ?, responded_at = NULL
         WHERE id = ?`,
        fromUserId,
        target.id,
        Date.now(),
        existing.id,
      );
      const user = this.loadUser(target.id)!;
      return {
        id: existing.id,
        username: user.username,
        country: user.country,
        avatar: user.avatar,
        level: user.level,
        status: 'pending',
        direction: 'outgoing',
      };
    }

    const inserted = this.db.run(
      `INSERT INTO friends (requester_id, addressee_id, status, created_at)
       VALUES (?, ?, 'pending', ?)`,
      fromUserId,
      target.id,
      Date.now(),
    );
    const user = this.loadUser(target.id)!;
    return {
      id: inserted.lastInsertRowid,
      username: user.username,
      country: user.country,
      avatar: user.avatar,
      level: user.level,
      status: 'pending',
      direction: 'outgoing',
    };
  }

  respond(userId: number, requestId: number, action: 'accept' | 'reject'): void {
    const row = this.db.get<{ id: number; requester_id: number; addressee_id: number; status: string }>(
      'SELECT id, requester_id, addressee_id, status FROM friends WHERE id = ?',
      requestId,
    );
    if (!row) throw new HttpError(404, 'Friend request not found.');
    if (row.addressee_id !== userId) {
      throw new HttpError(403, 'That request was not sent to you.');
    }
    if (row.status !== 'pending') {
      throw new HttpError(409, 'That request has already been handled.');
    }

    if (action === 'accept') {
      this.db.run(
        `UPDATE friends SET status = 'accepted', responded_at = ? WHERE id = ?`,
        Date.now(),
        requestId,
      );
    } else {
      this.db.run('DELETE FROM friends WHERE id = ?', requestId);
    }
  }

  remove(userId: number, otherUserId: number): void {
    const result = this.db.run(
      `DELETE FROM friends
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
      userId,
      otherUserId,
      otherUserId,
      userId,
    );
    if (result.changes === 0) throw new HttpError(404, 'That person is not your friend.');
  }

  private loadUser(id: number): FriendUserRow | undefined {
    return this.db.get<FriendUserRow>(`${FRIEND_SELECT} WHERE u.id = ?`, id);
  }
}
