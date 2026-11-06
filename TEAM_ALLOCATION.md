# BeatSync — Team Allocation

**This document defines logical ownership for planning and review routing only.**
The eight roles below are responsibilities, not people. No contributor is named
because none has been recorded beyond this repository's actual git history — the
commit log is the only source of truth for who did what. If the team grows, map
real people onto these roles here; do not invent them.

## Roles

| # | Role | Owns | Key files |
|---|------|------|-----------|
| 1 | **Core Logic Engineer** | Gameplay rules: typing state machine, scoring formula, plausibility validation | `src/shared/typing.ts`, `src/shared/scoring.ts`, `src/shared/constants.ts`, `src/shared/types.ts` |
| 2 | **Audio & Music Engineer** | URL classification, provider adapters, playback capabilities, file uploads | `src/shared/urlValidator.ts`, `src/client/music/*`, `src/client/player/PlayerControls.tsx` |
| 3 | **Lyrics & Sync Engineer** | LRC/plain parsing, timed line highlighting, playback-clock synchronization | `src/shared/lrc.ts`, `src/client/lyrics/*`, sync loop in `src/client/game/useTypingGame.ts` |
| 4 | **Backend/API Engineer** | Express app, routes, middleware, auth, rate limiting, config, WebSocket transport | `src/server/app.ts`, `src/server/routes/*`, `src/server/middleware/*`, `src/server/ws/battles.ts`, `src/server/config.ts` |
| 5 | **Data Engineer** | SQLite layer, migrations, schema, all persistence services | `src/server/db/*`, `src/server/services/*`, `DATABASE_SCHEMA.md` |
| 6 | **Frontend/UI Engineer** | Pages, layout, design tokens, styles, teddy mascot, toasts, theming | `src/client/pages/*`, `src/client/components/*`, `src/client/teddy/*`, `src/client/styles/*`, `src/client/state/*` |
| 7 | **Gamification & Social Engineer** | XP, levels, badges, challenges, leaderboards, friends, battles end-to-end | `src/shared/xp.ts`, `badges.ts`, `challenges.ts`, `leaderboard.ts`, `tempo.ts`; `services/{scoreService,challengeService,leaderboardService,socialService,battleService,profileService}.ts`, `src/client/battle/*` |
| 8 | **QA & Release Engineer** | Test suite, smoke script, build pipeline, documentation, release hygiene | `tests/*`, `scripts/smoke.mjs`, `scripts/dev.mjs`, `*.md`, `package.json`, CI (future) |

## Area → owner map (for reviews)

| Area | Primary (1–8) | Consulted |
|------|---------------|-----------|
| Score/XP/badge rules change | 1 | 7, 8 |
| Provider playback bug | 2 | 3, 6 |
| Lyric timing/highlighting bug | 3 | 1, 2 |
| New endpoint or auth change | 4 | 5, 8 |
| Schema/migration | 5 | 4, 7 |
| Visual/UX change | 6 | 2, 3 |
| Leaderboard/battle/friends behaviour | 7 | 4, 5 |
| Test coverage / release | 8 | all |

## Working agreements

- Cross-role changes (e.g. a new score field touching 1, 5 and 7) get one owner
  for the PR and reviewers from the other affected roles.
- Each role updates its own documents when its area changes:
  2/3 → `ARCHITECTURE.md` §3–4 · 4 → `API_DOCUMENTATION.md` ·
  5 → `DATABASE_SCHEMA.md` · 8 → `TESTING_REPORT.md` and `LOC_REPORT.md` ·
  anyone → `DEVELOPMENT_LOG.md`.
- Ownership does not gate contributions — anyone may open a PR in any area; it only
  says whose review is expected.
