# BeatSync — Database Schema

Storage is **SQLite** via Node's built-in `node:sqlite` (no native build step).
The database file defaults to `beatsync-data/beatsync.db` (`DB_PATH` overrides it).

Connection pragmas applied on open (`src/server/db/database.ts`):

| Pragma | Value | Why |
|--------|-------|-----|
| `journal_mode` | `WAL` | concurrent readers during writes |
| `foreign_keys` | `ON` | referential integrity enforced |
| `busy_timeout` | `5000` ms | wait instead of failing on a locked write |

## Migration policy

- Migrations live in `src/server/db/migrations.ts` as an **ordered array** of
  `{ id, name, sql }` entries.
- On startup `runMigrations` creates `schema_migrations (id, name, applied_at)`,
  skips ids already recorded, and runs each new migration **inside a transaction**.
- Never edit a shipped migration — append a new entry with the next id.

Current state: **migration 1 (`initial-schema`)** creates all tables below.

## Entity relationships

```
users 1─1 profiles          users 1─* song_history *─1 songs
users 1─* game_sessions *─0..1 songs
users 1─* xp_ledger         users 1─* user_badges
users 1─* challenge_progress users 1─* play_days
users *─* users (via friends)  users 1─* battles (host/opponent/winner)
songs 1─* lyrics *─1 users   songs 1─* favourites *─1 users
```

## Tables

### `users`
Authentication identity and public handle.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `username` | TEXT NOT NULL UNIQUE | `COLLATE NOCASE` |
| `email` | TEXT NOT NULL UNIQUE | `COLLATE NOCASE` |
| `password_hash` | TEXT NOT NULL | bcryptjs, cost 10 |
| `country` | TEXT NOT NULL DEFAULT `''` | used by the country leaderboard |
| `avatar` | TEXT NOT NULL DEFAULT `''` | emoji avatar key |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `last_login_at` | INTEGER | epoch ms, nullable |

### `profiles`
One row per user — gamification state, updated only by `ProfileService` /
`ScoreService` after a validated submission.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK → users(id) ON DELETE CASCADE | |
| `level` | INTEGER DEFAULT 1 | derived from `xp` |
| `xp` | INTEGER DEFAULT 0 | total XP (ledger is the audit trail) |
| `total_songs_completed` | INTEGER DEFAULT 0 | drives `first-song`, `music-lover` |
| `clean_runs` | INTEGER DEFAULT 0 | ≥90% accuracy **and** 100% completion |
| `accuracy_sum` / `accuracy_count` | REAL / INTEGER | average accuracy basis |
| `best_wpm` | REAL DEFAULT 0 | `speed-demon` badge source |
| `best_combo` | INTEGER DEFAULT 0 | |
| `highest_score` | INTEGER DEFAULT 0 | profile display + rank tie context |
| `total_chars` | INTEGER DEFAULT 0 | |
| `current_streak` / `longest_streak` | INTEGER DEFAULT 0 | daily play streak |
| `last_play_date` | TEXT | `YYYY-MM-DD` local day key |
| `created_at` | INTEGER NOT NULL | epoch ms |

### `songs`
Canonical per-link record (one row per normalized URL).

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `provider` | TEXT NOT NULL | `youtube` \| `spotify` \| `direct-audio` |
| `media_id` | TEXT | video/track id when known |
| `url` | TEXT NOT NULL UNIQUE | normalized URL |
| `title` / `artist` / `artwork_url` | TEXT DEFAULT `''` | best-effort metadata |
| `created_at` | INTEGER NOT NULL | epoch ms |

### `song_history`
Plays per user, newest first (`idx_history_user_played (user_id, played_at DESC)`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `user_id` | INTEGER NOT NULL → users | CASCADE |
| `song_id` | INTEGER NOT NULL → songs | CASCADE |
| `played_at` | INTEGER NOT NULL | epoch ms |

### `favourites`
`(user_id, song_id)` composite PK; `created_at` epoch ms.

### `lyrics`
User-owned lyrics per song — the only lyrics source (no scraping).

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `song_id` | INTEGER NOT NULL → songs | CASCADE |
| `user_id` | INTEGER NOT NULL → users | CASCADE |
| `content` | TEXT NOT NULL | raw LRC or plain text, ≤ 20 000 chars |
| `is_timestamped` | INTEGER 0/1 | parsed result of `parseLyricsInput` |
| `updated_at` | INTEGER NOT NULL | epoch ms |
| **UNIQUE** | `(song_id, user_id)` | one lyric set per user per song |

### `game_sessions`
One row per **accepted** score submission — the leaderboard's fact table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `user_id` | INTEGER NOT NULL → users | CASCADE |
| `song_id` | INTEGER → songs | SET NULL if the song row disappears |
| `battle_id` | INTEGER | informational, no FK |
| `mode` | TEXT NOT NULL | `practice` \| `beat` \| `challenge` \| `free` \| `battle` |
| `status` | TEXT DEFAULT `completed` | |
| `started_at` / `ended_at` | INTEGER NOT NULL | epoch ms |
| `elapsed_ms` | INTEGER NOT NULL | ≥ 5 000 enforced at submission |
| `wpm`, `cpm`, `accuracy` | REAL NOT NULL | re-validated server-side |
| `correct_chars`, `incorrect_chars`, `total_mistakes` | INTEGER NOT NULL | |
| `keystrokes` | INTEGER DEFAULT 0 | accuracy consistency check |
| `best_combo` | INTEGER NOT NULL | |
| `score` | INTEGER NOT NULL | recomputed within ±10% (floor 5) |
| `xp_earned` | INTEGER DEFAULT 0 | |
| `completion` | REAL NOT NULL | 0–100 |
| `tempo_rate` | REAL DEFAULT 1 | |
| `adaptive_tempo` | INTEGER 0/1 | |
| `lines_completed`, `total_lines` | INTEGER DEFAULT 0 | |

Indexes: `idx_sessions_user_score (user_id, score DESC)`,
`idx_sessions_song_score (song_id, score DESC)`, `idx_sessions_score (score DESC)`,
`idx_sessions_ended (ended_at DESC)` (powers weekly/monthly windows).

### `xp_ledger`
Audit trail of every XP change.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `user_id` | INTEGER NOT NULL → users | CASCADE |
| `amount` | INTEGER NOT NULL | signed (positive awards) |
| `reason` | TEXT NOT NULL | e.g. `session`, `challenge:daily-song` |
| `session_id` | INTEGER → game_sessions | SET NULL, nullable |
| `created_at` | INTEGER NOT NULL | epoch ms |

Index: `idx_xp_user (user_id, created_at DESC)`.

### `user_badges`
`(user_id, badge_id, unlocked_at)` — PK `(user_id, badge_id)`. `badge_id` matches a
definition in `src/shared/badges.ts` (`first-song`, `perfect-typist`, `speed-demon`,
`combo-master`, `flawless`, `global-star`, `music-lover`, `teddy-favourite`,
`daily-hero`).

### `challenge_progress`
Daily/weekly challenge state, keyed so old periods never leak into new ones.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER NOT NULL → users | CASCADE |
| `period_key` | TEXT NOT NULL | `d:YYYY-MM-DD` or `w:YYYY-Www` |
| `challenge_id` | TEXT NOT NULL | definition id from `src/shared/challenges.ts` |
| `progress` | REAL DEFAULT 0 | high-water or cumulative per metric |
| `target` | REAL DEFAULT 0 | snapshot of the definition target |
| `completed` | INTEGER 0/1 | |
| `updated_at` | INTEGER NOT NULL | epoch ms |
| `completed_at` | INTEGER | epoch ms, nullable |
| **PK** | `(user_id, period_key, challenge_id)` | |

### `play_days`
Distinct days a user played — `(user_id, day)` PK, `day` = `YYYY-MM-DD`.
Feeds the `daysActive` weekly challenge and streak logic.

### `friends`
Self-referential request/accept graph.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `requester_id` | INTEGER NOT NULL → users | CASCADE |
| `addressee_id` | INTEGER NOT NULL → users | CASCADE |
| `status` | TEXT DEFAULT `pending` | `pending` \| `accepted` \| `declined` \| `removed` |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `responded_at` | INTEGER | epoch ms, nullable |
| **UNIQUE** | `(requester_id, addressee_id)` | one row per pair |
| **CHECK** | `requester_id <> addressee_id` | no self-friending |

Indexes: `idx_friends_addressee (addressee_id, status)`,
`idx_friends_requester (requester_id, status)`.

### `battles`
Multiplayer rooms.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `join_code` | TEXT NOT NULL UNIQUE | 6 chars |
| `host_id` | INTEGER NOT NULL → users | CASCADE |
| `opponent_id` | INTEGER → users | SET NULL, nullable while `waiting` |
| `song_id` | INTEGER → songs | SET NULL |
| `song_url` | TEXT NOT NULL | denormalized so a join can load the song |
| `mode` | TEXT DEFAULT `challenge` | stored modes: `challenge` \| `battle` |
| `status` | TEXT DEFAULT `waiting` | `waiting` \| `active` \| `finished` \| `cancelled` |
| `host_score` / `opponent_score` | INTEGER DEFAULT 0 | last WS-reported score |
| `winner_id` | INTEGER → users | SET NULL, decided server-side |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `started_at` / `finished_at` | INTEGER | epoch ms, nullable |

Indexes: `idx_battles_host (host_id, status)`, `idx_battles_opponent (opponent_id, status)`.

## Conventions

- All timestamps are **epoch milliseconds** (`INTEGER`) except day/period keys, which
  are TEXT (`YYYY-MM-DD`, `YYYY-Www`) in local time for humans and stable grouping.
- Booleans are `INTEGER` 0/1.
- Every FK is declared and `PRAGMA foreign_keys = ON`; deletes cascade from `users`
  and `songs` except `game_sessions.song_id` / `battles.*`, which null out to keep
  history.
- Ranking never reads `profiles.highest_score` alone — leaderboards aggregate
  `game_sessions` with `ORDER BY score DESC, accuracy DESC, wpm DESC`.
