/**
 * Ordered schema migrations. Each migration runs exactly once inside a
 * transaction and is recorded in `schema_migrations`.
 */
import type { Database } from './database';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        country       TEXT NOT NULL DEFAULT '',
        avatar        TEXT NOT NULL DEFAULT '',
        created_at    INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE profiles (
        user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        level                INTEGER NOT NULL DEFAULT 1,
        xp                   INTEGER NOT NULL DEFAULT 0,
        total_songs_completed INTEGER NOT NULL DEFAULT 0,
        clean_runs           INTEGER NOT NULL DEFAULT 0,
        accuracy_sum         REAL NOT NULL DEFAULT 0,
        accuracy_count       INTEGER NOT NULL DEFAULT 0,
        best_wpm             REAL NOT NULL DEFAULT 0,
        best_combo           INTEGER NOT NULL DEFAULT 0,
        highest_score        INTEGER NOT NULL DEFAULT 0,
        total_chars          INTEGER NOT NULL DEFAULT 0,
        current_streak       INTEGER NOT NULL DEFAULT 0,
        longest_streak       INTEGER NOT NULL DEFAULT 0,
        last_play_date       TEXT,
        created_at           INTEGER NOT NULL
      );

      CREATE TABLE songs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        provider    TEXT NOT NULL,
        media_id    TEXT,
        url         TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL DEFAULT '',
        artist      TEXT NOT NULL DEFAULT '',
        artwork_url TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE song_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        played_at INTEGER NOT NULL
      );
      CREATE INDEX idx_history_user_played ON song_history(user_id, played_at DESC);

      CREATE TABLE favourites (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, song_id)
      );

      CREATE TABLE lyrics (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id         INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        is_timestamped  INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL,
        UNIQUE (song_id, user_id)
      );

      CREATE TABLE game_sessions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id       INTEGER REFERENCES songs(id) ON DELETE SET NULL,
        battle_id     INTEGER,
        mode          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'completed',
        started_at    INTEGER NOT NULL,
        ended_at      INTEGER NOT NULL,
        elapsed_ms    INTEGER NOT NULL,
        wpm           REAL NOT NULL,
        cpm           REAL NOT NULL,
        accuracy      REAL NOT NULL,
        correct_chars INTEGER NOT NULL,
        incorrect_chars INTEGER NOT NULL,
        total_mistakes INTEGER NOT NULL,
        keystrokes    INTEGER NOT NULL DEFAULT 0,
        best_combo    INTEGER NOT NULL,
        score         INTEGER NOT NULL,
        xp_earned     INTEGER NOT NULL DEFAULT 0,
        completion    REAL NOT NULL,
        tempo_rate    REAL NOT NULL DEFAULT 1,
        adaptive_tempo INTEGER NOT NULL DEFAULT 0,
        lines_completed INTEGER NOT NULL DEFAULT 0,
        total_lines   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_sessions_user_score ON game_sessions(user_id, score DESC);
      CREATE INDEX idx_sessions_song_score ON game_sessions(song_id, score DESC);
      CREATE INDEX idx_sessions_score ON game_sessions(score DESC);
      CREATE INDEX idx_sessions_ended ON game_sessions(ended_at DESC);

      CREATE TABLE xp_ledger (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount     INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        session_id INTEGER REFERENCES game_sessions(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_xp_user ON xp_ledger(user_id, created_at DESC);

      CREATE TABLE user_badges (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_id   TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, badge_id)
      );

      CREATE TABLE challenge_progress (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_key   TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        progress     REAL NOT NULL DEFAULT 0,
        target       REAL NOT NULL DEFAULT 0,
        completed    INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL,
        completed_at INTEGER,
        PRIMARY KEY (user_id, period_key, challenge_id)
      );

      CREATE TABLE play_days (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day     TEXT NOT NULL,
        PRIMARY KEY (user_id, day)
      );

      CREATE TABLE friends (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  INTEGER NOT NULL,
        responded_at INTEGER,
        UNIQUE (requester_id, addressee_id),
        CHECK (requester_id <> addressee_id)
      );
      CREATE INDEX idx_friends_addressee ON friends(addressee_id, status);
      CREATE INDEX idx_friends_requester ON friends(requester_id, status);

      CREATE TABLE battles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        join_code    TEXT NOT NULL UNIQUE,
        host_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opponent_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        song_id      INTEGER REFERENCES songs(id) ON DELETE SET NULL,
        song_url     TEXT NOT NULL,
        mode         TEXT NOT NULL DEFAULT 'challenge',
        status       TEXT NOT NULL DEFAULT 'waiting',
        host_score   INTEGER NOT NULL DEFAULT 0,
        opponent_score INTEGER NOT NULL DEFAULT 0,
        winner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        finished_at  INTEGER
      );
      CREATE INDEX idx_battles_host ON battles(host_id, status);
      CREATE INDEX idx_battles_opponent ON battles(opponent_id, status);
    `,
  },
];

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .all<{ id: number }>('SELECT id FROM schema_migrations')
      .map((row) => Number(row.id)),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.run(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        migration.id,
        migration.name,
        Date.now(),
      );
    });
  }
}
