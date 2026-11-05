/**
 * Typing battles: creation, joining, live score persistence and results.
 * Realtime transport lives in ws/battles.ts — this service owns the data.
 */
import crypto from 'node:crypto';
import type { Database } from '../db/database';
import { HttpError } from '../http/helpers';
import { parsePlayerUrl, type GameMode } from '../../shared';
import type { ProfileService } from './profileService';
import type { SongService } from './songService';

export interface BattleRow {
  id: number;
  join_code: string;
  host_id: number;
  opponent_id: number | null;
  song_id: number | null;
  song_url: string;
  mode: string;
  status: 'waiting' | 'active' | 'finished' | 'cancelled';
  host_score: number;
  opponent_score: number;
  winner_id: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface BattleView {
  id: number;
  joinCode: string;
  hostId: number;
  opponentId: number | null;
  songUrl: string;
  mode: GameMode;
  status: BattleRow['status'];
  hostScore: number;
  opponentScore: number;
  winnerId: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export function toBattleView(row: BattleRow): BattleView {
  return {
    id: row.id,
    joinCode: row.join_code,
    hostId: row.host_id,
    opponentId: row.opponent_id,
    songUrl: row.song_url,
    mode: row.mode as GameMode,
    status: row.status,
    hostScore: row.host_score,
    opponentScore: row.opponent_score,
    winnerId: row.winner_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function generateJoinCode(): string {
  // Unambiguous alphabet — no 0/O/1/I confusion when friends read codes aloud.
  return crypto
    .randomBytes(6)
    .toString('base64url')
    .replace(/[-_]/g, '')
    .slice(0, 6)
    .toUpperCase()
    .padEnd(6, 'X');
}

export class BattleService {
  constructor(
    private readonly db: Database,
    private readonly songs: SongService,
    private readonly profile: ProfileService,
  ) {}

  create(hostId: number, input: { songUrl: string; mode: GameMode }): BattleView {
    const detection = parsePlayerUrl(input.songUrl);
    if (!detection.valid || !detection.normalizedUrl) {
      throw new HttpError(400, detection.reason ?? 'Invalid song link.', { songUrl: 'invalid' });
    }
    const song = this.songs.upsert(detection);

    let joinCode = generateJoinCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = this.db.get<{ id: number }>('SELECT id FROM battles WHERE join_code = ?', joinCode);
      if (!clash) break;
      joinCode = generateJoinCode();
    }

    const inserted = this.db.run(
      `INSERT INTO battles (join_code, host_id, song_id, song_url, mode, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?)`,
      joinCode,
      hostId,
      song.id,
      detection.normalizedUrl,
      input.mode,
      Date.now(),
    );
    return toBattleView(this.byId(inserted.lastInsertRowid)!);
  }

  join(opponentId: number, joinCode: string): BattleView {
    const battle = this.byCode(joinCode.trim().toUpperCase());
    if (!battle) throw new HttpError(404, 'No battle found with that code.');
    if (battle.status !== 'waiting') throw new HttpError(409, 'That battle already started.');
    if (battle.host_id === opponentId) {
      throw new HttpError(400, 'That is your own battle — share the code with a friend.');
    }

    this.db.run(
      `UPDATE battles SET opponent_id = ?, status = 'active', started_at = ? WHERE id = ? AND status = 'waiting'`,
      opponentId,
      Date.now(),
      battle.id,
    );
    return toBattleView(this.byId(battle.id)!);
  }

  byId(id: number): BattleRow | undefined {
    return this.db.get<BattleRow>('SELECT * FROM battles WHERE id = ?', id);
  }

  byCode(code: string): BattleRow | undefined {
    return this.db.get<BattleRow>('SELECT * FROM battles WHERE join_code = ?', code);
  }

  activeBattleFor(userId: number): BattleView | null {
    const row = this.db.get<BattleRow>(
      `SELECT * FROM battles
       WHERE (host_id = ? OR opponent_id = ?) AND status IN ('waiting', 'active')
       ORDER BY created_at DESC
       LIMIT 1`,
      userId,
      userId,
    );
    return row ? toBattleView(row) : null;
  }

  /** Persist a live score tick (called by the WebSocket layer). */
  recordScore(battleId: number, userId: number, score: number): void {
    const battle = this.byId(battleId);
    if (!battle) throw new HttpError(404, 'Battle not found.');
    if (battle.status !== 'active') return;
    const safeScore = Math.max(0, Math.round(score));

    if (battle.host_id === userId) {
      this.db.run(
        'UPDATE battles SET host_score = MAX(host_score, ?) WHERE id = ?',
        safeScore,
        battleId,
      );
    } else if (battle.opponent_id === userId) {
      this.db.run(
        'UPDATE battles SET opponent_score = MAX(opponent_score, ?) WHERE id = ?',
        safeScore,
        battleId,
      );
    } else {
      throw new HttpError(403, 'You are not part of that battle.');
    }
  }

  /** Mark finished, decide the winner by final score, return the result. */
  finish(battleId: number): BattleView {
    const battle = this.byId(battleId);
    if (!battle) throw new HttpError(404, 'Battle not found.');
    if (battle.status === 'finished') return toBattleView(battle);

    let winnerId: number | null = null;
    if (battle.host_score !== battle.opponent_score) {
      winnerId = battle.host_score > battle.opponent_score ? battle.host_id : battle.opponent_id;
    }

    this.db.run(
      `UPDATE battles SET status = 'finished', winner_id = ?, finished_at = ? WHERE id = ?`,
      winnerId,
      Date.now(),
      battleId,
    );
    return toBattleView(this.byId(battleId)!);
  }

  cancel(battleId: number, userId: number): void {
    const battle = this.byId(battleId);
    if (!battle) throw new HttpError(404, 'Battle not found.');
    if (battle.host_id !== userId && battle.opponent_id !== userId) {
      throw new HttpError(403, 'You are not part of that battle.');
    }
    if (battle.status === 'finished') return;
    this.db.run(`UPDATE battles SET status = 'cancelled', finished_at = ? WHERE id = ?`, Date.now(), battleId);
  }

  /** Final standings with display names. */
  standings(battleId: number): {
    battle: BattleView;
    players: { userId: number; username: string; score: number; isWinner: boolean }[];
  } {
    const battle = this.byId(battleId);
    if (!battle) throw new HttpError(404, 'Battle not found.');
    const ids = [battle.host_id, battle.opponent_id].filter((id): id is number => id !== null);
    const names = new Map<number, string>();
    if (ids.length > 0) {
      const rows = this.db.all<{ id: number; username: string }>(
        `SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ...ids,
      );
      for (const row of rows) names.set(row.id, row.username);
    }

    const players = ids.map((id) => ({
      userId: id,
      username: names.get(id) ?? 'unknown',
      score: id === battle.host_id ? battle.host_score : battle.opponent_score,
      isWinner: battle.winner_id === id,
    }));
    players.sort((a, b) => b.score - a.score);

    return { battle: toBattleView(battle), players };
  }

  /** Ensure the profile streak is recorded for a participant who played. */
  recordParticipant(userId: number): void {
    this.profile.recordPlay(userId);
  }
}
