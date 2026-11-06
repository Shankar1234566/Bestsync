# BeatSync — Development Log

Chronological record of real work on this repository. Entries describe what was
built, what broke and how it was fixed — no invented history. All work to date
happened on **2026-11-05**; commits are conventional and land on feature branches
(see `CONTRIBUTING.md`).

---

## 2026-11-05 — Phase 1: scaffold & decisions

**Commit `e61bf47` — `chore: scaffold vite+express+typescript project with shared core layout`**

- Started from an empty directory. Chose a **single npm package** over workspaces:
  one `tsconfig.json` (client + shared + tests, `noUnusedLocals`/`noUnusedParameters`)
  and one `tsconfig.server.json` (server → CommonJS → `dist-server/`).
- Stack pinned: React 19 + Vite 8, Express 5, `ws`, `node:sqlite` (no native deps),
  JWT (`jsonwebtoken`) + `bcryptjs`, Vitest 5.
- Directory contract: `src/shared` (pure logic), `src/server`, `src/client`,
  `tests/`, `scripts/`.
- `scripts/dev.mjs` launches API + Vite together with prefixed logs; `vite.config.ts`
  proxies `/api` and `/ws` so the browser sees one origin.
- `.gitignore` written up front (node_modules, dist, dist-server, `*.db`, `.env`
  with `!.env.example`).

## 2026-11-05 — Phase 2–5: shared core

**Commit `955bf5b` — `feat(shared): url validation, lrc parsing, typing engine, scoring, xp, badges, tempo, challenges, leaderboard core`**

Twelve dependency-free modules — every rule that both client and server must agree
on lives here:

| Module | Key decisions |
|--------|---------------|
| `urlValidator.ts` | One classifier for YouTube (watch/shorts/embed/live/youtu.be), Spotify (intl prefixes, entity kinds) and direct audio; never downloads media; rejects playlists/channels/short links with a human `reason`; `quantizeRateForProvider` snaps rates to YouTube's steps and forces Spotify to 1x |
| `lrc.ts` | Fractional timestamps (`.x/.xx/.xxx`), multi-timestamp expansion, `[offset:]`, metadata kept under raw LRC keys (`ti`, `ar`), plain-lyrics fallback, ≥30%-stamped auto-detection |
| `typing.ts` | Character-level state machine; mistakes are cumulative (never reduced by backspace) while `correctChars` is live — prevents WPM gaming |
| `scoring.ts` | `computeScore` (mode × accuracy² × tempo factors) + `validateScorePlausibility` (WPM ≤ 350, ≥ 5 s, ±20% WPM/duration, accuracy ↔ keystrokes) |
| `xp.ts` / `badges.ts` | 10-level ladder, XP bonuses with streak cap at 7; 9 badges evaluated against session+profile+rank context |
| `tempo.ts` | Presets (0.75/1.0/1.25), custom 0.5–1.5 clamp, Adaptive bands (<60 slow, 60–80 hold, 80–95 speed up, >95 faster) and `smoothRate` limited to 0.35 steps/s |
| `challenges.ts` | 4 daily + 5 weekly definitions; high-water vs cumulative metrics; `periodKey` day and ISO-week keys |
| `leaderboard.ts` | Tie-break order score → accuracy → WPM; scope windows (7-day weekly, 30-day monthly) |

## 2026-11-05 — Phase 7–9: server API

**Commit `139e488` — `feat(server): sqlite persistence, auth, profiles, songs, scores, leaderboards, friends, battles api with ws`**

- `node:sqlite` wrapper with WAL + foreign keys + busy timeout; ordered migrations
  in `db/migrations.ts`, each applied once inside a transaction.
- Composition root (`context.ts`) builds db + 8 services exactly once; tests reuse
  it with temp databases.
- Express app factory with `start()/close()` so integration tests bind ephemeral
  ports; JSON 404 before the SPA fallback; static `dist/` served in production.
- Auth: register/login/me, bcrypt cost 10, 7-day JWT; production **refuses to boot**
  without `JWT_SECRET` (dev fallback is clearly labelled).
- Score authority in `scoreService.submit`: plausibility → shared-formula score
  reproduction (±10%, floor 5) → XP → badges → challenge progress → leaderboard row.
- Friends, battles (REST) and the `/ws` battle transport with JWT verified during
  the upgrade, participant check (403 otherwise), 4 KB frame cap and 900 ms
  score-persist throttle.
- Rate limiting: sliding windows per bucket (global 600/min, auth 20/min per
  IP+identity, score 30/min, metadata 30/min, friend 15/min, battle 10/min).
- Backend smoke script `scripts/smoke.mjs` — 15 black-box steps.

## 2026-11-05 — Phase 6: client

Built the full SPA (32 files, `src/client/`):

- **Shell:** `main.tsx`, `App.tsx` routes (`/`, `/game`, `/leaderboard`, `/profile`,
  `/friends`, `/auth`), `Layout` with nav + theme toggle, token-first styles
  (`tokens.css` → `app.css` → `pages.css`), dark/light via `[data-theme]`.
- **State:** `AuthContext` (JWT persistence, `authFetch`), `ThemeContext`,
  `ToastContext`; typed `api/client.ts` mirroring every REST endpoint.
- **Music:** three adapters behind `createAdapter` + `usePlayer` hook; uploads use a
  module-scope `pendingFile` (a `File` cannot live in a URL) and an object URL that
  never leaves the browser.
- **Tempo:** `useTempo` holds target rate, applies `smoothRate` on a tick and reports
  accuracy samples to Adaptive Tempo.
- **Game:** `useTypingGame` owns phase/line/counters, mode rules (typing-driven vs
  playback-driven), pause/finish, score submission; `TypingArea` (hidden input +
  keydown + `beforeinput` fallback, paste blocked), `StatsHud`, `ResultsScreen`.
- **Lyrics:** `LyricsPanel` (click a line to seek when the provider allows) and
  `LyricsEditor` (paste LRC/plain, save to server).
- **Teddy:** pure CSS/SVG mascot with 7 states driven by phase, combo and
  per-keystroke feedback.
- **Battles:** `useBattleSocket` (auth via `?token=`, join/presence/scores/finished)
  and `BattlePanel` (create/join/leave, live scores, standings).

**Bugs found and fixed during client work:**

1. `activeLineIndex` returns **−1** before the first timed line — the playback sync
   loop passed it straight to `advancePlaybackTo`, which would have thrown on
   `lines[-1].text`. Fixed by clamping the target with `Math.max(0, …)` and guarding
   `advancePlaybackTo`/`rewindPlaybackTo` against out-of-range indexes.
2. Removed a dead `totalLines` local and an unstable `player.state.status` effect
   dependency (extracted `playerStatus`) — both were `tsc` errors under
   `noUnusedLocals`/`noUnusedParameters`.
3. Verified `index.html`'s `<title>` byte-for-byte after a garbled terminal render —
   the file was correct (`BeatSync — Type to the Beat`); display artifact only.

## 2026-11-05 — Phase 10: tests

**Wrote `tests/` — 10 files, 138 tests; `npx vitest run` → 138/138 passing.**

- Unit tests for all nine shared modules (pure functions, no mocks).
- `tests/api.test.ts`: real Express app on an ephemeral port with a temp SQLite file
  — auth, validation, score authority (accept + 4 rejections), progression,
  leaderboard, lyrics, friends, battles REST, **and a live two-client WebSocket
  battle** (join → score exchange → finish → server-decided winner), plus 429 rate
  limiting.
- First run: **5 failures, all in my test expectations rather than product code** —
  fixed the assertions to match documented behaviour:
  - metadata keys are raw LRC tags (`metadata.ti`), not `metadata.title`;
  - `parseLyricsInput` keeps only stamped lines when a mostly-timed file has strays
    (heuristic drops unstamped lines once input is detected as LRC);
  - `typingInput` returns `line-complete` only on the **last** character;
  - the accuracy test typed past a 9-character target, capping accepted keystrokes at 9.
- Re-run: **138/138 green** (1.95 s).

## 2026-11-05 — documentation

Wrote the nine required documents plus `README.md` and `.env.example`:

`PROJECT_ROADMAP.md` · `ARCHITECTURE.md` · `DATABASE_SCHEMA.md` ·
`API_DOCUMENTATION.md` · `DEVELOPMENT_LOG.md` (this file) · `TESTING_REPORT.md` ·
`CONTRIBUTING.md` · `TEAM_ALLOCATION.md` · `LOC_REPORT.md`.

## Next up

- Browser walkthrough of home → game → typing → results with the dev servers running;
  confirm zero console errors.
- Commit the client, tests and docs in conventional commits.
- Possible follow-ups (not yet scoped): Playwright E2E, password reset, shared
  rate-limit/battle-room store for multi-instance deployment.
