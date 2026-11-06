# BeatSync — Architecture

This document describes how the running system is put together: process topology,
module boundaries, and the data flow of a single game session.

## 1. Topology

One npm package, three logical layers:

```
┌────────────────────────────  browser  ───────────────────────────┐
│  React 19 SPA (Vite build → dist/)                              │
│  pages/ → hooks (usePlayer, useTempo, useTypingGame,            │
│          useBattleSocket) → src/shared (pure logic)             │
└───────────────┬─────────────────────────────┬────────────────────┘
                │ HTTP  /api/*               │ WebSocket  /ws
                │ (JWT Bearer)                │ (JWT in query string)
┌───────────────▼─────────────────────────────▼────────────────────┐
│  Express 5 API + ws battle rooms (Node 22, TypeScript CJS)       │
│  routes → services → node:sqlite (WAL)  ·  dist-server/         │
└──────────────────────────────────────────────────────────────────┘
```

- **Dev:** `npm run dev` starts the API with `tsx watch` on `PORT` (default 4000) and
  the Vite dev server on 5173; Vite proxies `/api` and `/ws` to the API, so the
  browser only ever talks to one origin.
- **Prod:** `npm run build` produces `dist/` (client) and `dist-server/` (API).
  `npm start` runs the API, which serves `dist/` as static files with an SPA
  fallback — a single process, single port.

## 2. Code layout

```
src/
├── shared/     Pure, dependency-free logic used by client, server and tests.
│               urlValidator · lrc · typing · scoring · xp · badges ·
│               tempo · challenges · leaderboard · types · constants · index
├── server/
│   ├── config.ts        env parsing; production refuses to boot without JWT_SECRET
│   ├── context.ts       composition root — builds db + all services once
│   ├── app.ts           Express factory + http server + WS attach + start/close
│   ├── db/              Database (node:sqlite wrapper) + ordered migrations
│   ├── http/            error handling, validation helpers (wrap, require*)
│   ├── middleware/       auth (JWT verify → req.userId), rate limiting
│   ├── routes/          thin HTTP layer: parse input → call service → respond
│   ├── services/        business rules (auth, profile, songs, scores, challenges,
│   │                    leaderboard, social, battles)
│   └── ws/battles.ts    battle rooms, score broadcast, finish standings
├── client/
│   ├── pages/           route components (Home, Game, Leaderboard, Profile,
│   │                    Friends, Auth)
│   ├── music/           provider adapters (HTMLAudio/YouTube/Spotify) + usePlayer
│   ├── tempo/           useTempo (presets, custom, adaptive + smoothing)
│   ├── game/            useTypingGame, TypingArea, StatsHud, ResultsScreen
│   ├── lyrics/          LyricsPanel, LyricsEditor
│   ├── player/          PlayerControls (transport, volume, rate, progress)
│   ├── battle/          useBattleSocket, BattlePanel
│   ├── teddy/           Teddy mascot component (state machine)
│   ├── state/           AuthContext, ThemeContext, ToastContext
│   ├── api/client.ts    typed fetch wrapper for every REST endpoint
│   └── styles/          tokens.css → app.css → pages.css (design tokens first)
tests/                   vitest: unit (shared) + integration (HTTP) + realtime (WS)
scripts/                 dev.mjs (dual-process launcher), smoke.mjs (API smoke)
```

### Dependency rule

`src/shared` imports nothing from `src/server` or `src/client`.
`src/server` and `src/client` may both import `src/shared`.
Routes never contain business rules; services never touch `req`/`res`.
Client hooks never compute authoritative results — they send a submission and the
server re-validates it (see §5).

## 3. Music engine

`createAdapter(source, container)` picks an implementation from the classified link:

| Provider | Adapter | Controls exposed |
|----------|---------|------------------|
| `direct-audio` (mp3/wav/ogg/m4a/aac/flac/opus) | `HtmlAudioAdapter` | play/pause, seek, volume, rate 0.5–1.5 |
| `youtube` | `YouTubeAdapter` (IFrame API) | play/pause, seek, volume, rate quantized to {0.25,0.5,0.75,1,1.25,1.5,1.75,2} |
| `spotify` | `SpotifyAdapter` (IFrame API) | play/pause only — no seek, no volume, no rate |
| staged `File` upload | `HtmlAudioAdapter` over `URL.createObjectURL` | full controls; the file never leaves the browser |

Every adapter reports `PlayerCapabilities`; the UI greys out unsupported controls and
shows the provider's limitation text. `parsePlayerUrl` (shared) is the single source
of truth for classification on both client and server.

**No protected media is downloaded.** YouTube/Spotify links only produce an official
embed URL; the audio stream is never requested, stored or proxied by BeatSync.

## 4. A game session, end to end

1. **Load** — the player pastes a link on Home/Game → `parsePlayerUrl` classifies it →
   `createAdapter` embeds the provider player → `POST /api/songs/metadata` records the
   song (provider, media id, title) for history/leaderboards.
2. **Lyrics** — `GET /api/songs/lyrics?url=…` returns the user's saved lyrics if any;
   otherwise the editor is opened. Pasted text is parsed by `parseLyricsInput`
   (LRC when ≥30% of lines are stamped, else plain lines).
3. **Tempo** — `useTempo` maps preset/custom/adaptive to a *target* rate;
   `smoothRate` approaches it at ≤0.35 steps/s; the adapter quantizes per provider.
   Adaptive decisions come from the shared `adaptiveDecision(accuracy)` bands.
4. **Type** — `useTypingGame` owns phase (`idle → playing → paused → finished`),
   line index and keystroke counters. Modes split into two families:
   - *practice / free*: typing advances lines sequentially (the typist is the clock);
   - *beat / challenge / battle*: the playback clock is the source of truth — a poll
     sync loop advances the active line, lines not finished by their time are finalized
     as **passed** (counted in `linesMissed`, never dropped silently).
5. **Stats** — `computeStats` derives WPM = (correctChars/5)/minutes, accuracy from
   cumulative mistakes, completion from processed lines; `computeScore` applies mode,
   accuracy² and tempo factors.
6. **Result** — `POST /api/scores` with the full submission. The server:
   - checks plausibility (`validateScorePlausibility`: WPM ≤ 350, ≥ 5 s sessions,
     accuracy ↔ keystroke consistency, WPM ↔ duration ±20%),
   - recomputes the score with the shared formula (±10%, floor 5 points),
   - awards XP (`computeXp`), evaluates badges (`evaluateBadges`), advances daily/weekly
     challenges, updates the profile and returns `{ accepted, xpGained, level,
     unlockedBadges, challengesCompleted }`.
   Client numbers are never trusted at face value.
7. **Leaderboard** — `GET /api/leaderboard?scope=…` ranks server-side with
   score → accuracy → WPM tie-breaks.

## 5. Multiplayer battles

- REST creates a battle (`join_code`, 6 chars) and joins by code; status moves
  `waiting → active → finished | cancelled`.
- `/ws?token=<JWT>&battleId=<id>` upgrades only for participants (401/403 otherwise).
- Client→server: `score` (throttled ≥900 ms persistence, 4 KB cap) and `finish`.
  Server→client: `joined`, `presence`, `scores`, `finished`, `error`.
- The winner is decided by the server from recorded final scores. Battle scores are
  **not** XP — XP still requires a validated REST score submission.

## 6. Cross-cutting concerns

- **Auth** — `POST /api/auth/{register,login}` → JWT (7 d, issuer `beatsync`),
  bcryptjs cost 10. `attachUser` decodes on every request; `requireAuth` gates routes.
  Dev/test may fall back to a clearly labelled secret; production throws at boot.
- **Rate limiting** — sliding windows in memory: global 600/min per IP, plus tight
  buckets for auth (20/min per IP+identity), score submit (30/min), metadata (30/min),
  friend requests (15/min), battle create (10/min).
- **Validation** — every route uses `requireString/requireNumber/requireEnum/...`
  helpers; errors are 400/401/404/409/422 JSON with a `message`-style `error` field.
- **Configuration** — `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `DB_PATH`, `CORS_ORIGIN`,
  `CLIENT_DIST`, `TRUST_PROXY` (see `.env.example`).
- **Known single-instance limits** (documented, deliberate): rate-limit counters and
  battle rooms live in process memory; moving to multiple instances requires a shared
  store (e.g. Redis) for both.

## 7. UI shell

`Layout` provides nav + theme toggle + toasts; routes are `/`, `/game`,
`/leaderboard`, `/profile`, `/friends`, `/auth`. The game page composes
`PlayerControls`, `StatsHud`, `TypingArea`, `LyricsPanel`, `Teddy`, `BattlePanel`
and the `ResultsScreen` modal. Styling is token-first (`tokens.css` custom
properties → `app.css` components → `pages.css` page layouts); dark/light is a
single `[data-theme]` switch. The teddy is pure CSS/SVG with a `state` prop
(`idle | dancing | happy | excited | confused | relaxed | victory`) driven by game
phase, combo and per-keystroke feedback.

## 8. Testing architecture

- `vitest` runs `tests/**/*.test.ts` in a Node environment (fork pool).
- Unit tests exercise `src/shared` directly — no mocks needed (pure functions).
- Integration tests call `buildApp(config)` with a temp SQLite file and an ephemeral
  port, then hit real HTTP; the realtime test opens real WebSockets through `ws`.
- `scripts/smoke.mjs` is a 15-step black-box check against a running server.
