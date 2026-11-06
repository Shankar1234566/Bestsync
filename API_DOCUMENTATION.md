# BeatSync — API Documentation

Base URL: `/api` (HTTP) and `/ws` (WebSocket).
All request/response bodies are JSON (`Content-Type: application/json`).

- **Auth:** `Authorization: Bearer <JWT>` on protected endpoints. Tokens are issued by
  `/api/auth/register` and `/api/auth/login` (HS256, 7-day expiry, issuer `beatsync`).
- **Errors:** `{ "error": "<human readable message>" }` with a conventional status:
  `400` validation · `401` missing/invalid token · `404` unknown route ·
  `409` conflict (duplicate user, double join) · `422` score rejected by authority ·
  `429` rate limited (body may include `retryAfterMs`).
- **Rate limits** (sliding window, in memory): global 600/min per IP on `/api`;
  tighter per-route buckets are listed with each endpoint.

---

## Health

### `GET /api/health`
Public readiness check.

```json
{ "status": "ok", "service": "beatsync-api", "uptimeMs": 12345, "time": "2026-11-05T12:00:00.000Z" }
```

---

## Auth — `/api/auth` (bucket: 20/min per IP + identity)

### `POST /api/auth/register`
| Field | Rules |
|-------|-------|
| `username` | 3–24 chars, `[A-Za-z0-9_]` style pattern |
| `email` | valid email, stored lowercased |
| `password` | 1–200 chars (hashed with bcryptjs cost 10) |
| `country` | optional, validated against the country pattern |

**201** → `{ "token": "...", "user": { id, username, country, avatar, level, xp } }`
**409** if the username or email already exists.

### `POST /api/auth/login`
| Field | Rules |
|-------|-------|
| `identifier` | username **or** email |
| `password` | |

**200** → same body as register. **401** on unknown user or wrong password.

### `GET /api/auth/me` · *protected*
**200** → `{ "user": PublicUser, "profile": ProfileSummary }`
**401** when the token is missing/expired or the account was deleted.

---

## Users — `/api/users`

### `GET /api/users/me` · *protected*
**200** → `{ "profile": ProfileSummary, "recentPerformances": [...] }`

### `PATCH /api/users/me` · *protected*
Optional fields: `username` (3–24), `country`, `avatar` (≤8 chars).
**200** → `{ "profile": ProfileSummary }`

### `GET /api/users/:username` · public
**200** → `{ "profile": ProfileSummary | null, "isSelf": boolean, "recentPerformances": [...] }`

`ProfileSummary` includes `level, levelName, xp, xpToNextLevel, totalSongsCompleted,
averageAccuracy, bestWpm, highestScore, currentStreak, longestStreak, totalChars,
badges[], globalRank, createdAt`.

---

## Songs — `/api/songs`

### `POST /api/songs/metadata` · bucket 30/min
Body `{ "url": "<song link>" }`. Classifies the link, upserts the `songs` row and
best-effort fetches public embed metadata (title/artwork).
**200** → `{ "detection": ProviderDetection, "song": {...} }`

### `POST /api/songs/validate`
Body `{ "url": "..." }`. Pure classification, no DB writes.
**200** → `{ "detection": ProviderDetection }` where `detection.valid === false`
always carries a human-readable `reason`.

### `GET /api/songs/recent` · *protected*
**200** → `{ "songs": [...] }` — last 12 played songs.

### `GET /api/songs/favourites` · *protected*
**200** → `{ "songs": [...] }`

### `POST /api/songs/favourites` · *protected*
Body `{ "url": "..." }` — **201** `{ "song": {...}, "favourite": true }`, **400** for
invalid links.

### `DELETE /api/songs/favourites/:songId` · *protected*
**200** → `{ "songId": 12, "favourite": false }`

### `PUT /api/songs/lyrics` · *protected*
Body `{ "url": "...", "lyrics": "<LRC or plain text>" }` (≤20 000 chars).
**200** → `{ "songId": 1, "lineCount": 24, "timed": true }`
Lyrics are stored verbatim; `timed` reflects `parseLyricsInput`'s verdict.

### `GET /api/songs/lyrics?url=...` · *protected*
**200** → `{ "lyrics": null }` or
`{ "lyrics": { "content": "...", "timed": true, "updatedAt": 1762000000000 } }`

---

## Scores — `/api/scores`

### `POST /api/scores` · *protected* · bucket 30/min — **the authority**
Body (`ScoreSubmission`):

```json
{
  "songUrl": "https://www.youtube.com/watch?v=...", "mode": "practice",
  "wpm": 60, "cpm": 300, "accuracy": 97.5,
  "correctChars": 900, "incorrectChars": 22, "totalMistakes": 25, "keystrokes": 925,
  "bestCombo": 84, "score": 379, "completion": 100, "elapsedMs": 90000,
  "linesCompleted": 30, "linesMissed": 2, "totalLines": 32,
  "tempoRate": 1.25, "adaptiveTempo": true
}
```

Validation pipeline (`scoreService.submit`):

1. Shape/type checks in the route (numeric ranges per field).
2. `validateScorePlausibility` — WPM ≤ 350 and ≥ 0, session ≥ 5 s and ≤ 12 h,
   accuracy within 0–100 **and** consistent with `totalMistakes/keystrokes`,
   completion 0–100, WPM consistent with `correctChars/elapsedMs` within ±20%.
3. Score recomputed with the shared `computeScore` formula — accepted if within
   ±10% of the claimed score (or the claim is below the 5-point floor).

**201** → `ScoreAck`:

```json
{
  "accepted": true, "sessionId": 42, "xpGained": 327,
  "level": 3, "levelName": "Beat Beginner", "leveledUp": false,
  "unlockedBadges": [{ "id": "perfect-typist", "...": "..." }],
  "challengesCompleted": [{ "id": "daily-song", "...": "..." }],
  "rank": 17
}
```

**422** → `{ "error": "<which rule failed>" }` when plausibility or score
recomputation fails. **401** unauthenticated.

### `GET /api/scores/limits`
**200** → `{ "limits": { "minSessionMs": 5000, "maxWpm": 350 } }` — lets the client
explain the rules before submitting.

---

## Leaderboard — `/api/leaderboard`

### `GET /api/leaderboard`
Query params:
| Param | Values | Notes |
|-------|--------|-------|
| `scope` | `global` (default) · `weekly` · `monthly` · `country` · `friends` · `song` | |
| `limit` | number, default 50 | |
| `songId` | required when `scope=song` | else **400** |
| `country` | optional when `scope=country` | falls back to the caller's country; **400** if neither |

`friends` requires auth (**401** otherwise). Ranking is always computed server-side:
`score DESC, accuracy DESC, wpm DESC`.

**200** → `{ "scope": "global", "entries": [ LeaderboardEntry ] }` where each entry
has `rank, userId, username, country, avatar, level, score, accuracy, wpm, badges[]`.

### `GET /api/leaderboard/me` · *protected*
**200** → `{ "rank": 17, "highestScore": 812, "level": 3 }`

---

## Progression — mounted directly on `/api`

### `GET /api/badges` · *protected*
**200** → `{ "badges": [ { ...BadgeDefinition, unlocked: true, unlockedAt: 1762... } ] }`
(all 9 catalogue entries, unlock state included).

### `GET /api/challenges` · *protected*
**200** → `{ "daily": ChallengeProgressView[4], "weekly": ChallengeProgressView[5] }`
Each view extends the definition with `progress, completed, completedAt, periodKey`.

### `GET /api/levels` · public
**200** → `{ "levels": [ { level, name, minXp, ... } ] }` — the 10-level ladder.

---

## Friends — `/api/friends` · *all protected* (bucket: requests 15/min)

### `GET /api/friends`
**200** → `{ "friends": Friend[], "incoming": FriendRequest[], "outgoing": FriendRequest[] }`

### `GET /api/friends/search?q=bo`
Prefix/substring search over usernames (≤40 chars). **200** → `{ "users": [...] }`

### `POST /api/friends/request`
Body `{ "username": "bob" }` → **201** `{ "request": FriendRequest }`
**400** for self-requests/unknown users, **409** for duplicates.

### `POST /api/friends/:id/respond`
Body `{ "action": "accept" | "reject" }` → **200** with the updated list shape above.

### `DELETE /api/friends/:userId`
Removes the friendship → **200** with the updated list shape.

---

## Battles — `/api/battles` · *all protected* (create bucket 10/min)

### `GET /api/battles/active`
**200** → `{ "battle": Battle | null }` — the caller's waiting/active battle (used for
rejoin-after-refresh and the host's join polling).

### `POST /api/battles`
Body `{ "songUrl": "...", "mode": "battle" | "challenge" | ... }` →
**201** `{ "battle": Battle }` with `status: "waiting"` and a 6-character `joinCode`.

### `POST /api/battles/join`
Body `{ "code": "ABC123" }` → **200** `{ "battle": Battle }` (`status: "active"`).
**400** joining your own battle / unknown code, **409** already joined or battle full.

### `GET /api/battles/:id/standings`
**200** → `{ "battle": Battle, "players": [ { userId, username, score, isWinner, ... } ] }`

### `POST /api/battles/:id/forfeit`
Cancels (waiting) or forfeits (active) → **200** `{ "battle": Battle | null }`.

`Battle` DTO: `id, joinCode, songUrl, mode, status, host {…}, opponent {…}|null,
hostScore, opponentScore, winnerId, createdAt, startedAt, finishedAt`.

---

## WebSocket — `/ws` (battle realtime)

Connect during the HTTP upgrade:

```
ws://<host>/ws?token=<JWT>&battleId=<id>
```

- **401** if the token is missing/invalid or the user no longer exists.
- **403** if the caller is not the host or opponent of that battle.
- Only the `/ws` path upgrades; any other path is destroyed (no hanging upgrades).

### Client → server

| Message | Shape | Notes |
|---------|-------|-------|
| `score` | `{ type: "score", battleId, score, wpm?, accuracy?, progress? }` | persisted at most every **900 ms** per client; frames > 4 KB dropped |
| `finish` | `{ type: "finish", battleId, score }` | records the final score, finishes the battle |

### Server → client

| Message | Payload |
|---------|---------|
| `joined` | `{ type, battleId, players: [{ userId, username }] }` — sent to the connecting client |
| `presence` | `{ type, userId, username, connected: boolean }` — broadcast on connect/disconnect |
| `scores` | `{ type, hostScore, opponentScore }` — broadcast after each persisted score |
| `finished` | `{ type, standings }` — same shape as `GET /battles/:id/standings` |
| `error` | `{ type, message }` — malformed input, storage failure |

**Security:** battle scores are display-only. XP, badges and leaderboards only ever
change through `POST /api/scores`, which re-validates the whole submission.

---

## Changelog behaviour to rely on

- Unknown `scope` on the leaderboard falls back to `global` (never an error).
- `GET /api/songs/lyrics` for a never-seen song returns `{ "lyrics": null }` — the
  client treats that as "open the editor", not an error.
- `POST /api/battles/:id/forfeit` on an already-finished battle returns
  `{ "battle": null }` with 200 (idempotent from the client's perspective).
