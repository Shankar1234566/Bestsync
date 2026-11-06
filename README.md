# BeatSync — Type to the Beat 🎵⌨️

A music-powered typing game: paste a song link (YouTube, Spotify or a direct audio
file), type the lyrics in time with the track, and climb the leaderboard while
**Teddy** dances along. Earn XP, unlock badges, complete daily challenges and battle
friends in real time.

> BeatSync only embeds each provider's official player. It never downloads or
> scrapes audio from YouTube/Spotify, and lyrics only ever come from you.

## Features

- **Multi-provider playback** — YouTube, Spotify and direct audio links (plus local
  file upload). Unsupported controls (e.g. Spotify tempo) are disabled with a visible
  explanation instead of being faked.
- **Real lyric sync** — paste LRC or plain lyrics; timed lines follow the player's
  own clock, and missed lines are counted, never silently skipped.
- **Tempo control** — 0.75x / 1.0x / 1.25x presets, custom 0.5–1.5x, and **Adaptive
  Tempo** that eases the speed up or down based on your accuracy.
- **Typing engine** — character-perfect feedback, combos, accuracy, WPM
  (5-character convention), pause/resume, practice → beat → challenge → battle modes.
- **Progression** — XP, 10 levels, 9 badges, 4 daily + 5 weekly challenges; every
  score is re-validated server-side before it counts.
- **Leaderboards** — global, weekly, monthly, country, friends and per-song scopes
  with proper tie-breaking.
- **Multiplayer battles** — 6-character join codes, live score streaming over
  WebSocket, server-decided standings.
- **Teddy** — an animated mascot that reacts to your combo, mistakes and victories.

## Quick start

Requires **Node ≥ 22.5** (for the built-in `node:sqlite`).

```bash
npm install
npm run dev          # API on :4000, Vite on :5173 (auto-proxied)
```

Open <http://localhost:5173>, register an account, paste a song link, add lyrics
and press **Start run**.

```bash
npm test             # 138 vitest tests (unit + HTTP integration + WebSocket)
npm run build        # typecheck + client bundle + server compile
npm start            # run the production build (serves dist/ on PORT, default 4000)
node scripts/smoke.mjs   # 15-step API smoke test against a running server
```

## Configuration

Copy `.env.example` to `.env` and adjust. The only required production variable is
`JWT_SECRET` — the server refuses to boot without it when `NODE_ENV=production`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | API port (Vite dev proxy target) |
| `JWT_SECRET` | dev-only fallback | token signing key (**required in production**) |
| `DB_PATH` | `beatsync-data/beatsync.db` | SQLite file location |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:4000` | comma-separated allowed origins for cross-origin use |
| `TRUST_PROXY` | `unset` | set `1` behind a reverse proxy so rate limits see real IPs |

## Project structure

```
src/shared    pure game logic shared by client, server and tests
src/server    Express 5 API + WebSocket battles + SQLite (node:sqlite)
src/client    React 19 SPA (Vite)
tests         vitest: unit, HTTP integration, realtime WebSocket
scripts       dev launcher + 15-step API smoke test
```

## Documentation

| Document | Contents |
|----------|----------|
| [`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md) | phases, status, scope decisions |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | runtime topology, data flow, boundaries |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | tables, indexes, migration policy |
| [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) | REST + WebSocket reference |
| [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md) | chronological work log |
| [`TESTING_REPORT.md`](TESTING_REPORT.md) | test inventory and results |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | branching, commits, PR gate |
| [`TEAM_ALLOCATION.md`](TEAM_ALLOCATION.md) | logical ownership map |
| [`LOC_REPORT.md`](LOC_REPORT.md) | measured line counts |

## License

MIT
