# BeatSync — Testing Report

**Date:** 2026-11-05 · **Environment:** Node v22.18.0, npm 10.9.3, Windows,
Vitest 5.1.0 · **Result: all green — 138/138 unit+integration tests,
15/15 backend smoke steps, typecheck and production build clean.**

Commands used (nothing below is claimed without running it):

```bash
npx tsc -p tsconfig.json --noEmit   # typecheck → clean, 0 errors
npm run build                       # typecheck + vite build + server tsc → exit 0
npx vitest run                      # 10 files, 138 tests passed
node scripts/smoke.mjs              # 15 steps (against a running API)
```

## 1. Test inventory

| File | Tests | Covers |
|------|-------|--------|
| `tests/urlValidator.test.ts` | 20 | YouTube/Spotify/direct-audio classification, playlist/channel/short-link rejection with reasons, capability flags, rate quantization, embed URL builders |
| `tests/lrc.test.ts` | 15 | LRC parsing (fractional precision, multi-timestamp lines, `[offset:]`), metadata tags, plain lyrics, auto-detection heuristic, `activeLineIndex`, `toLrc` round-trip |
| `tests/typing.test.ts` | 13 | keystroke accept/reject, combo/mistake accounting, backspace semantics (mistakes never decrease), line finalize (completed vs passed), WPM/accuracy/completion stats |
| `tests/scoring.test.ts` | 12 | `computeScore` reference example (720), mode multipliers, accuracy², tempo factor, clamping; `validateScorePlausibility` rule-by-rule rejections |
| `tests/xp.test.ts` | 8 | 10-level ladder, XP → level mapping, XP-to-next, progress %, XP bonuses (completion/accuracy/combo/streak cap at 7) |
| `tests/badges.test.ts` | 9 | 9-badge catalogue integrity, every unlock rule incl. AND conditions and top-100 rank gate |
| `tests/tempo.test.ts` | 13 | preset/custom clamping, adaptive decision bands (<60 / 60–80 / 80–95 / >95), min/max guards, `smoothRate` step limit |
| `tests/challenges.test.ts` | 11 | 4 daily + 5 weekly definitions, high-water vs cumulative metrics, clamping/completion, `periodKey` day + ISO-week keys |
| `tests/leaderboard.test.ts` | 9 | tie-break ordering (score → accuracy → WPM), rank stamping without mutation, scope time windows |
| `tests/api.test.ts` | 28 | full HTTP integration + realtime WebSocket (see below) |

**Total: 138 tests in 10 files.**

## 2. Integration coverage (`tests/api.test.ts`)

Runs the real `buildApp(config)` with a temp SQLite file and an ephemeral port —
no mocks, no fixtures pretending to be the server:

- **health & auth** — healthy payload, 401 on protected routes, duplicate register
  409, wrong password 401, login by username *and* email.
- **song validation** — supported links classify correctly; unsupported links return
  an explanatory reason.
- **score authority** — a plausible submission is accepted (201, XP > 0,
  `first-song` badge, `daily-song` challenge completed); four rejection cases return
  422 (400 WPM, score mismatch, session too short, inconsistent stats).
- **progression** — 9 badges with unlock state, 4 daily + 5 weekly challenge views,
  10-level ladder.
- **leaderboard** — ranked entries with `rank: 1` on top, friends scope works.
- **lyrics storage** — save → fetch round-trip (`timed: true`), null for unknown songs.
- **friends** — search → request → accept → both lists updated; self-friending rejected.
- **battles REST** — create (6-char code), join activates, double join 409, own
  battle join 400, standings list both players.
- **battles realtime** — two real WebSocket clients: join/presence, host score 500
  broadcast to both, opponent score reply, `finish` → server-decided winner in
  `finished.standings`; unauthenticated upgrade rejected.
- **rate limiting** — repeated failed logins trip `429`.

## 3. Backend smoke (`scripts/smoke.mjs`)

15 black-box steps against a running server (`npm run dev`, then
`node scripts/smoke.mjs`):

| # | Step | # | Step |
|---|------|---|------|
| 1 | health | 9 | reject implausible score (400 wpm) |
| 2 | register | 10 | challenges progress |
| 3 | duplicate register rejected | 11 | badges |
| 4 | login | 12 | leaderboard has entry |
| 5 | me | 13 | friend flow |
| 6 | song validate (youtube) | 14 | battle create + join |
| 7 | song validate (bad link) | 15 | rate limit kicks in (auth bucket) |
| 8 | submit score | | |

Result when last run: **15 PASS / 0 FAIL**.

## 4. Static checks

| Check | Command | Result |
|-------|---------|--------|
| TypeScript (client + server + tests) | `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| Server-only compile (CommonJS) | `tsc -p tsconfig.server.json` (via `npm run build`) | 0 errors |
| Production client bundle | `vite build` | 64 modules, `index.js` 350.98 kB (107.79 kB gzip), `index.css` 30.12 kB (6.87 kB gzip) |

`noUnusedLocals` / `noUnusedParameters` are enabled, so unused imports fail the build.

## 5. Known limitations of the suite

- **No browser/E2E automation.** React pages are verified by typecheck, production
  build and manual browser walkthrough (recorded in `DEVELOPMENT_LOG.md`); there is no
  Playwright/Cypress harness yet.
- **Provider players are not tested headlessly.** The YouTube/Spotify adapters need
  their official iframes; tests cover the shared classification/capability logic that
  drives them, not the embeds themselves.
- **Rate limiter state is in-process**, so tests call `resetRateLimits()` in
  `beforeEach`; parallel test files run in separate forks (`pool: 'forks'`) to keep
  ports and databases isolated.
- **`node:sqlite` prints an ExperimentalWarning** on Node 22 — suppressed in the
  `start` script with `--no-warnings=ExperimentalWarning`, otherwise harmless.

## 6. Re-running everything

```bash
npm install
npx tsc -p tsconfig.json --noEmit   # typecheck
npm test                            # vitest: 138 tests
npm run build                       # full production build
npm run dev &                       # API :4000 + Vite :5173
node scripts/smoke.mjs              # 15-step smoke (server must be running)
```

Any change to `src/server` or `src/shared` should end with `npm test` at minimum;
score/XP/badge changes must also re-run `scripts/smoke.mjs`.
