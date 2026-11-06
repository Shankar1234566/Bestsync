# BeatSync — Project Roadmap

BeatSync is a music-powered typing game: paste a song link (YouTube, Spotify or a
direct audio file), type the synchronized lyrics in time with the track, and earn
XP, badges and leaderboard rank — with a dancing teddy mascot cheering you on.

This roadmap tracks the ten delivery phases. Status values are `done`, `in progress`
or `not started`; only work that actually exists in this repository is marked `done`.

## Phase status

| # | Phase | Status | Evidence |
|---|-------|--------|----------|
| 1 | Audit & documentation skeleton | **done** | Repo scaffold, `tsconfig`/`vite`/`vitest` config, docs below, git history with conventional commits |
| 2 | Music engine (providers, playback, capabilities) | **done** | `src/shared/urlValidator.ts`, `src/client/music/*`, adapter factory with capability flags per provider |
| 3 | Lyrics sync (LRC parsing, line highlighting) | **done** | `src/shared/lrc.ts`, `src/client/lyrics/*`, playback-clock sync in `useTypingGame` |
| 4 | Tempo control (presets, custom, adaptive) | **done** | `src/shared/tempo.ts`, `src/client/tempo/useTempo.ts`, smoothing + accuracy bands |
| 5 | Typing engine (input, stats, scoring) | **done** | `src/shared/typing.ts`, `src/shared/scoring.ts`, `src/client/game/*` |
| 6 | Teddy mascot & UI shell | **done** | `src/client/teddy/Teddy.tsx`, `src/client/styles/*`, routes in `src/client/App.tsx` |
| 7 | Auth, profiles, XP, badges | **done** | `src/server/routes/auth.ts`, `src/server/services/{authService,profileService,scoreService}`, JWT + bcrypt |
| 8 | Leaderboards & social (friends, challenges) | **done** | `src/server/routes/leaderboard.ts`, `friends.ts`, `progression.ts`, `src/shared/leaderboard.ts` |
| 9 | Multiplayer battles (REST + WebSocket) | **done** | `src/server/routes/battles.ts`, `src/server/ws/battles.ts`, `src/client/battle/*` |
| 10 | Testing & deployment readiness | **done** | `tests/` (138 tests), `scripts/smoke.mjs`, `npm run build`, docs in this repo |

## What "done" means per phase

- **Phase 1** — project builds from an empty directory; shared/server/client layout
  defined; roadmap, architecture, schema, API and log documents exist.
- **Phase 2** — a pasted link is classified (YouTube / Spotify / direct audio) with a
  human-readable reason when unsupported; each provider exposes honest capability
  flags (seek, volume, playback rate); no protected audio is ever downloaded.
- **Phase 3** — LRC files parse into timed lines; plain lyrics parse into untimed
  lines; during playback the active line follows the player's clock and missed lines
  are counted, not silently skipped.
- **Phase 4** — slow/normal/fast presets, a clamped custom rate, and Adaptive Tempo
  bands (<60% accuracy slow down, 60–80% hold, 80–95% speed up, >95% faster) with
  rate smoothing so playback never jumps.
- **Phase 5** — character-level input with backspace, combo, accuracy and WPM
  (5-char convention), mode-dependent scoring, and results computed client-side but
  re-validated server-side.
- **Phase 6** — responsive game screen: HUD, typing area, lyrics panel, player
  controls, teddy states (idle/dancing/happy/excited/confused/relaxed/victory), toasts.
- **Phase 7** — register/login with JWT + bcrypt, profile pages, XP ledger, levels,
  badge unlocks, daily/weekly challenges — all computed by the server from validated
  score submissions.
- **Phase 8** — ranked leaderboards with tie-breaks and scopes (global/weekly/monthly/
  country/friends/song), friend requests/accept, challenge progress views.
- **Phase 9** — create/join battles by code, live score streaming over WebSocket with
  auth on upgrade, standings and forfeit.
- **Phase 10** — unit + integration + realtime tests green, backend smoke script,
  production build, deployment notes in `ARCHITECTURE.md`.

## Deliverable documents

| Document | Purpose |
|----------|---------|
| `PROJECT_ROADMAP.md` | This file — phase plan and status |
| `ARCHITECTURE.md` | Runtime topology, module boundaries, data flow |
| `DATABASE_SCHEMA.md` | Tables, indexes, migration policy |
| `API_DOCUMENTATION.md` | REST endpoints + WebSocket protocol |
| `DEVELOPMENT_LOG.md` | Chronological work log per phase |
| `TESTING_REPORT.md` | Test inventory and results |
| `CONTRIBUTING.md` | Branching, commit and review rules |
| `TEAM_ALLOCATION.md` | Logical ownership of areas (no invented people) |
| `LOC_REPORT.md` | Real line-of-code counts by area |
| `README.md` | Quick start for developers |

## Deferred / out of scope (deliberate)

- **Spotify tempo/seek/volume** — the Spotify embed does not expose these controls;
  the UI disables them with a visible explanation rather than faking them.
- **YouTube/Spotify audio download or extraction** — never implemented; BeatSync only
  embeds the provider's official player.
- **Lyrics auto-fetch from third-party sites** — lyrics come from user input or the
  user's own saved lyrics; no scraping.
- **Horizontal scaling of the rate limiter / battle rooms** — both are in-memory and
  documented as single-instance in `ARCHITECTURE.md`.
- **Password reset / email verification** — not implemented; registration issues a
  session immediately.
