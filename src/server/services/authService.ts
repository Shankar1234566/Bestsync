/**
 * Authentication: registration, login, token issuance.
 * Passwords are hashed with bcrypt (cost 10); no plaintext ever stored.
 */
import bcrypt from 'bcryptjs';
import type { AppConfig } from '../config';
import type { Database } from '../db/database';
import { signToken } from '../middleware/auth';
import { HttpError } from '../http/helpers';
import { levelForXp, type AuthResponse, type PublicUser } from '../../shared';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  country: string;
  avatar: string;
  created_at: number;
  last_login_at: number | null;
}

export interface ProfileRow {
  user_id: number;
  level: number;
  xp: number;
  total_songs_completed: number;
  clean_runs: number;
  accuracy_sum: number;
  accuracy_count: number;
  best_wpm: number;
  best_combo: number;
  highest_score: number;
  total_chars: number;
  current_streak: number;
  longest_streak: number;
  last_play_date: string | null;
  created_at: number;
}

const BCRYPT_ROUNDS = 10;

export function toPublicUser(row: UserRow, profile?: ProfileRow | null): PublicUser {
  return {
    id: row.id,
    username: row.username,
    country: row.country,
    avatar: row.avatar,
    level: profile ? profile.level : 1,
    xp: profile ? profile.xp : 0,
  };
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  register(input: {
    username: string;
    email: string;
    password: string;
    country?: string;
  }): AuthResponse {
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();

    if (input.password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters.', {
        password: 'too_short',
      });
    }
    if (input.password.length > 128) {
      throw new HttpError(400, 'Password must be at most 128 characters.', {
        password: 'too_long',
      });
    }

    const existingUser = this.db.get<{ id: number }>(
      'SELECT id FROM users WHERE username = ?',
      username,
    );
    if (existingUser) {
      throw new HttpError(409, 'That username is already taken.', { username: 'taken' });
    }
    const existingEmail = this.db.get<{ id: number }>(
      'SELECT id FROM users WHERE email = ?',
      email,
    );
    if (existingEmail) {
      throw new HttpError(409, 'An account with that email already exists.', {
        email: 'taken',
      });
    }

    const passwordHash = bcrypt.hashSync(input.password, BCRYPT_ROUNDS);
    const now = Date.now();

    const user = this.db.transaction(() => {
      const inserted = this.db.run(
        `INSERT INTO users (username, email, password_hash, country, avatar, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        username,
        email,
        passwordHash,
        (input.country ?? '').trim(),
        '',
        now,
      );
      this.db.run(
        `INSERT INTO profiles (user_id, created_at) VALUES (?, ?)`,
        inserted.lastInsertRowid,
        now,
      );
      return this.byId(inserted.lastInsertRowid)!;
    });

    const profile = this.profileOf(user.id);
    return {
      token: signToken(user.id, this.config),
      user: toPublicUser(user, profile),
    };
  }

  login(identifier: string, password: string): AuthResponse {
    const user = this.db.get<UserRow>(
      'SELECT * FROM users WHERE email = ? OR username = ?',
      identifier.trim().toLowerCase(),
      identifier.trim(),
    );

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect username/email or password.');
    }

    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), user.id);
    const profile = this.profileOf(user.id);
    return {
      token: signToken(user.id, this.config),
      user: toPublicUser(user, profile),
    };
  }

  byId(id: number): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  byUsername(username: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
  }

  profileOf(userId: number): ProfileRow | undefined {
    return this.db.get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', userId);
  }

  /** Ensure a row exists (defensive for legacy data). */
  ensureProfile(userId: number): ProfileRow {
    const existing = this.profileOf(userId);
    if (existing) return existing;
    this.db.run('INSERT OR IGNORE INTO profiles (user_id, created_at) VALUES (?, ?)', userId, Date.now());
    return this.profileOf(userId)!;
  }
}

export function levelNameForXp(xp: number): string {
  return levelForXp(xp).name;
}
