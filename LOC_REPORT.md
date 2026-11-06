# BeatSync — LOC Report

**Measured:** 2026-11-05 · **Method:** physical line counts from the working tree
(`Get-Content <file> | Measure-Object -Line` for non-blank; `Get-Content <file>.Count`
for all lines). Counts include comments and blank lines; they exclude
`node_modules/`, `dist/`, `dist-server/` and `package-lock.json`.

**Reproduce:**

```powershell
Get-ChildItem src,tests,scripts -Recurse -File -Include *.ts,*.tsx,*.mjs,*.css,*.html |
  ForEach-Object { $c = Get-Content $_.FullName; $c.Count } | Measure-Object -Sum   # total
```

## Headline numbers

| Metric | Value |
|--------|-------|
| Source files (code + tests + scripts) | **84** |
| Configuration files counted | 6 |
| **Total physical lines** | **13,853** |
| **Non-blank lines** | **12,398** |
| Test files / test cases | 10 / **138** |
| Production build | passes (`npm run build`) |

## By area

| Area | Files | Total lines | Non-blank |
|------|------:|------------:|----------:|
| `src/client` (React SPA) | 32 | 6,895 | 6,155 |
| `src/server` (Express API + WS) | 28 | 3,502 | 3,164 |
| `src/shared` (pure logic) | 12 | 1,548 | 1,384 |
| `tests` (Vitest) | 10 | 1,519 | 1,335 |
| `scripts` (dev launcher + smoke) | 2 | 246 | 220 |
| Root config (`index.html`, `vite/vitest/tsconfig`, `package.json`) | 6 | 143 | 140 |
| **Total** | **90** | **13,853** | **12,398** |

### `src/client` breakdown (non-blank)

| Folder | Files | Lines | Purpose |
|--------|------:|------:|---------|
| `styles/` | 3 | 1,737 | tokens, components, page layouts |
| `pages/` | 6 | 1,349 | Home, Game, Leaderboard, Profile, Friends, Auth |
| `music/` | 3 | 897 | HTMLAudio/YouTube/Spotify adapters + `usePlayer` |
| `game/` | 4 | 693 | `useTypingGame`, TypingArea, StatsHud, ResultsScreen |
| `battle/` | 2 | 300 | `useBattleSocket`, BattlePanel |
| `api/` | 1 | 289 | typed REST client |
| `state/` | 3 | 166 | Auth / Theme / Toast contexts |
| `player/` | 1 | 161 | PlayerControls |
| `tempo/` | 1 | 137 | `useTempo` |
| `lyrics/` | 2 | 147 | LyricsPanel, LyricsEditor |
| `teddy/` | 1 | 114 | mascot component |
| `components/` | 3 | 113 | Layout, Equalizer, MusicNotes |
| root | 2 | 52 | `App.tsx`, `main.tsx` |
| **Total** | **32** | **6,155** | |

### `src/server` breakdown (non-blank)

| Folder | Files | Lines | Purpose |
|--------|------:|------:|---------|
| `services/` | 8 | 1,526 | auth, profile, songs, scores, challenges, leaderboard, social, battles |
| `routes/` | 9 | 640 | HTTP layer for all 9 route groups |
| `ws/` | 1 | 223 | battle rooms + protocol |
| root | 4 | 231 | `app.ts`, `config.ts`, `context.ts`, `index.ts` |
| `db/` | 2 | 267 | SQLite wrapper + migrations |
| `http/` | 2 | 155 | error handling + validation helpers |
| `middleware/` | 2 | 122 | JWT auth, rate limiting |
| **Total** | **28** | **3,164** | |

### `src/shared` per file (non-blank)

| File | Lines | | File | Lines |
|------|------:|-|------|------:|
| `urlValidator.ts` | 246 | | `tempo.ts` | 117 |
| `types.ts` | 226 | | `badges.ts` | 105 |
| `typing.ts` | 171 | | `scoring.ts` | 88 |
| `lrc.ts` | 134 | | `xp.ts` | 68 |
| `challenges.ts` | 132 | | `constants.ts` | 43 |
| | | | `leaderboard.ts` | 39 |
| | | | `index.ts` | 15 |
| **Total** | | | | **1,384** |

## Tests (non-blank)

| File | Lines | Test cases |
|------|------:|-----------:|
| `tests/api.test.ts` | 460 | 28 |
| `tests/urlValidator.test.ts` | 138 | 20 |
| `tests/lrc.test.ts` | 111 | 15 |
| `tests/typing.test.ts` | 147 | 13 |
| `tests/tempo.test.ts` | 92 | 13 |
| `tests/scoring.test.ts` | 92 | 12 |
| `tests/challenges.test.ts` | 83 | 11 |
| `tests/badges.test.ts` | 95 | 9 |
| `tests/leaderboard.test.ts` | 60 | 9 |
| `tests/xp.test.ts` | 57 | 8 |
| **Total** | **1,335** | **138** |

## Notes

- **No fabricated counts.** Every number above comes from measuring the working
  tree at the time of writing; regenerate with the command at the top after large
  changes and update `DEVELOPMENT_LOG.md`.
- **Generated output excluded** (`dist/`, `dist-server/`, sourcemaps) — those are
  build artifacts, not authored code.
- **Ratio check:** tests are ~10% of authored lines (1,335 / 12,398) with 138 test
  cases covering all nine shared modules plus full HTTP/WS integration.
