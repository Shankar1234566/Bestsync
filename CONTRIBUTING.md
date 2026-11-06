# BeatSync — Contributing

## Ground rules

1. **Real work only.** Never commit placeholder code presented as complete, never
   claim tests pass without running them, never inflate line counts or invent
   commit history.
2. **No secrets in the repo.** Configuration comes from environment variables —
   see `.env.example`. `.env` is git-ignored; production refuses to start without
   `JWT_SECRET`.
3. **No protected media.** Do not add code that downloads or scrapes audio from
   YouTube/Spotify or lyrics from third-party sites. Provider limitations must be
   surfaced to the user, not worked around silently.
4. **One source of truth for rules.** Gameplay math (scoring, XP, badges, tempo,
   LRC parsing, URL classification) lives in `src/shared` and must stay usable by
   client, server and tests without any import from `src/server` or `src/client`.

## Getting set up

```bash
npm install
npm run dev        # API :4000 + Vite :5173 (proxied)
npm test           # vitest — 138 tests
npm run build      # typecheck + client bundle + server compile
node scripts/smoke.mjs   # 15-step API smoke (server must be running)
```

Requires Node ≥ 22.5 (for `node:sqlite`). `node:sqlite` is experimental on Node 22
and prints a warning; the `start` script suppresses it.

## Branching & commits

- Work on feature branches: `feat/<area>-<summary>`, `fix/<area>-<summary>`,
  `docs/<topic>`, `test/<area>`, `chore/<thing>`.
- **Do not push directly to `main`.** Open a branch, verify, then request a merge.
- Ask before any destructive or irreversible git operation (force push, history
  rewrite, branch/file deletion someone else may be using).
- Conventional Commits, one logical change per commit:

  ```
  feat(shared): add adaptive tempo smoothing
  fix(client): clamp playback line index before first lyric line
  test(api): cover websocket battle finish standings
  docs: database schema for battles and challenge progress
  ```

  Scope is optional but encouraged: `shared`, `server`, `client`, `tests`, `docs`.

## Before you open a PR

Run the full gate — all must pass:

```bash
npx tsc -p tsconfig.json --noEmit   # 0 errors (noUnusedLocals is on)
npm test                            # 138+ tests green
npm run build                       # production build succeeds
```

If you touched `src/server` or score/XP/badge logic, also:

```bash
npm run dev &                       # then, in another shell:
node scripts/smoke.mjs              # 15/15 PASS
```

Manual UI checks when touching `src/client`: load the app, start a run, finish a
run, open the leaderboard — **no console errors**.

## Code conventions

- **TypeScript strict**; no `any` unless interfacing with third-party types and
  then narrow immediately.
- **Comments explain *why*, not *what*.** Every non-obvious rule gets a comment
  pointing at its rationale (e.g. why mistakes never decrease on backspace).
- **Files** start with a short doc comment describing their responsibility.
- **UI:** reuse the existing CSS classes in `src/client/styles`
  (`.typing-card`, `.lyric-line.active`, `.hud .stat`, `.btn-primary`, …) and add
  new tokens to `tokens.css` rather than hard-coded colors.
- **Validation:** server routes use the `requireString/requireNumber/requireEnum`
  helpers and return `{ error }` with an appropriate status; no ad-hoc parsing.
- **Tests** live in `tests/**/*.test.ts` (matched by `vitest.config.ts`). Name
  tests after the behaviour, not the implementation. When a test fails, first
  decide whether the product or the expectation is wrong — fix whichever is
  actually incorrect and say which in the commit message.

## Where things go

| Change | Location |
|--------|----------|
| Gameplay rule / formula / parser | `src/shared/` (+ unit test) |
| HTTP endpoint | `src/server/routes/` thin → `src/server/services/` for logic |
| Schema change | append a new migration in `src/server/db/migrations.ts` (never edit a shipped one) |
| New page / component | `src/client/pages/` / nearest feature folder |
| API surface change | update `API_DOCUMENTATION.md` in the same PR |
| Behaviour worth noting | append to `DEVELOPMENT_LOG.md` |

## Review expectations

- PR description: what changed, why, how it was verified (commands + results).
- Screenshots for visible UI changes.
- Tests accompany behaviour changes; bug fixes include a regression test when the
  layer is testable.
- `TEAM_ALLOCATION.md` maps areas to logical owners — route review requests to the
  owner of the affected area.
