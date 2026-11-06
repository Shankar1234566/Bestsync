/**
 * End-to-end API integration tests: the real Express app (with SQLite in a
 * temp directory) on an ephemeral port — auth, validation, score authority,
 * progression, social, battles and the realtime WebSocket transport.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp, type AppInstance } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { resetRateLimits } from '../src/server/middleware/rateLimit';

interface Json {
  [key: string]: unknown;
}

let instance: AppInstance;
let base: string;
let wsBase: string;
let tempDir: string;

let aliceToken = '';
let bobToken = '';
let battleId = 0;
let battleCode = '';

async function call(
  route: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${base}${route}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Buffered WebSocket client that can wait for message predicates. */
class SocketProbe {
  readonly messages: Json[] = [];

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      try {
        this.messages.push(JSON.parse(String(raw)) as Json);
      } catch {
        // Ignore non-JSON frames.
      }
    });
  }

  send(payload: Json): void {
    this.ws.send(JSON.stringify(payload));
  }

  async waitUntil(predicate: (messages: Json[]) => boolean, label: string, timeoutMs = 6_000): Promise<void> {
    const started = Date.now();
    while (!predicate(this.messages)) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for ${label}. Saw: ${JSON.stringify(this.messages)}`);
      }
      await sleep(25);
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

function connect(token: string, battle: number): Promise<SocketProbe> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}&battleId=${battle}`);
    const probe = new SocketProbe(ws);
    ws.once('open', () => resolve(probe));
    ws.once('error', (error) => reject(error));
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatsync-test-'));
  const config: AppConfig = {
    port: 0,
    jwtSecret: 'beatsync-test-secret',
    jwtExpiresIn: '1h',
    dbPath: path.join(tempDir, 'test.db'),
    corsOrigins: [],
    nodeEnv: 'test',
    isProduction: false,
    clientDist: path.join(tempDir, 'no-dist'),
    // Tests never call live lyrics providers — discovery stays off unless a
    // test explicitly constructs a LyricsService with its own stub provider.
    lyricsDiscovery: false,
    lyricsClientId: 'BeatSync-Tests',
  };
  instance = buildApp(config);
  const port = await instance.start(0);
  base = `http://127.0.0.1:${port}/api`;
  wsBase = `ws://127.0.0.1:${port}`;

  const alice = await call('/auth/register', {
    method: 'POST',
    body: { username: 'alice', email: 'alice@beatsync.test', password: 'supersecret1', country: 'IN' },
  });
  expect(alice.status).toBe(201);
  aliceToken = String(alice.body.token);

  const bob = await call('/auth/register', {
    method: 'POST',
    body: { username: 'bob', email: 'bob@beatsync.test', password: 'supersecret1' },
  });
  expect(bob.status).toBe(201);
  bobToken = String(bob.body.token);
});

afterAll(async () => {
  await instance?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimits();
});

describe('health and auth', () => {
  it('reports healthy', async () => {
    const { status, body } = await call('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('beatsync-api');
  });

  it('rejects unauthenticated requests', async () => {
    const { status } = await call('/auth/me');
    expect(status).toBe(401);
    const scores = await call('/scores', { method: 'POST', body: {} });
    expect(scores.status).toBe(401);
  });

  it('rejects duplicate registration', async () => {
    const { status } = await call('/auth/register', {
      method: 'POST',
      body: { username: 'alice', email: 'other@beatsync.test', password: 'supersecret1' },
    });
    expect(status).toBe(409);
  });

  it('rejects wrong passwords', async () => {
    const { status } = await call('/auth/login', {
      method: 'POST',
      body: { identifier: 'alice', password: 'wrong-password' },
    });
    expect(status).toBe(401);
  });

  it('logs in with username or email', async () => {
    const byName = await call('/auth/login', {
      method: 'POST',
      body: { identifier: 'alice', password: 'supersecret1' },
    });
    expect(byName.status).toBe(200);
    expect(byName.body.token).toBeTruthy();

    const byEmail = await call('/auth/login', {
      method: 'POST',
      body: { identifier: 'bob@beatsync.test', password: 'supersecret1' },
    });
    expect(byEmail.status).toBe(200);
  });
});

describe('song validation', () => {
  it('classifies supported links', async () => {
    const { status, body } = await call('/songs/validate', {
      method: 'POST',
      body: { url: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    expect(status).toBe(200);
    const detection = body.detection as Json;
    expect(detection.valid).toBe(true);
    expect(detection.provider).toBe('youtube');
  });

  it('explains unsupported links', async () => {
    const { body } = await call('/songs/validate', {
      method: 'POST',
      body: { url: 'https://example.com/not-a-song' },
    });
    const detection = body.detection as Json;
    expect(detection.valid).toBe(false);
    expect(String(detection.reason).length).toBeGreaterThan(0);
  });
});

describe('score authority', () => {
  const plausibleScore = {
    songUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    mode: 'practice',
    wpm: 30,
    cpm: 150,
    accuracy: 100,
    correctChars: 150,
    incorrectChars: 0,
    totalMistakes: 0,
    keystrokes: 150,
    bestCombo: 40,
    score: 720,
    completion: 100,
    elapsedMs: 60_000,
    linesCompleted: 10,
    linesMissed: 0,
    totalLines: 10,
    tempoRate: 1,
    adaptiveTempo: false,
  };

  it('accepts a plausible score and awards XP, badges and challenges', async () => {
    const { status, body } = await call('/scores', {
      method: 'POST',
      token: aliceToken,
      body: plausibleScore,
    });
    expect(status).toBe(201);
    expect(body.accepted).toBe(true);
    expect(Number(body.xpGained)).toBeGreaterThan(0);
    expect(Number(body.level)).toBeGreaterThanOrEqual(1);

    const badges = body.unlockedBadges as Json[];
    expect(badges.map((b) => b.id)).toContain('first-song');

    const challenges = body.challengesCompleted as Json[];
    expect(challenges.map((c) => c.id)).toContain('daily-song');
  });

  it('rejects implausible scores with 422', async () => {
    const { status, body } = await call('/scores', {
      method: 'POST',
      token: aliceToken,
      body: { ...plausibleScore, songUrl: null, wpm: 400, cpm: 2_000, correctChars: 5_000, keystrokes: 5_000 },
    });
    expect(status).toBe(422);
    expect(String(body.error).length).toBeGreaterThan(0);
  });

  it('rejects score/stat mismatches', async () => {
    const { status } = await call('/scores', {
      method: 'POST',
      token: aliceToken,
      body: { ...plausibleScore, score: 99_999 },
    });
    expect(status).toBe(422);
  });

  it('rejects sessions that are too short', async () => {
    const { status } = await call('/scores', {
      method: 'POST',
      token: aliceToken,
      body: { ...plausibleScore, elapsedMs: 2_000 },
    });
    expect(status).toBe(422);
  });
});

describe('progression', () => {
  it('lists badges with unlock state', async () => {
    const { status, body } = await call('/badges', { token: aliceToken });
    expect(status).toBe(200);
    const badges = body.badges as Json[];
    expect(badges).toHaveLength(9);
    const first = badges.find((b) => b.id === 'first-song');
    expect(first?.unlocked).toBe(true);
    const legendary = badges.find((b) => b.id === 'music-lover');
    expect(legendary?.unlocked).toBe(false);
  });

  it('returns daily and weekly challenge progress', async () => {
    const { status, body } = await call('/challenges', { token: aliceToken });
    expect(status).toBe(200);
    expect((body.daily as Json[]).length).toBe(4);
    expect((body.weekly as Json[]).length).toBe(5);
    const dailySong = (body.daily as Json[]).find((c) => c.id === 'daily-song');
    expect(dailySong?.completed).toBe(true);
  });

  it('exposes the level ladder', async () => {
    const { status, body } = await call('/levels', { token: aliceToken });
    expect(status).toBe(200);
    expect((body.levels as Json[]).length).toBe(10);
  });
});

describe('leaderboard', () => {
  it('ranks scored players', async () => {
    const { status, body } = await call('/leaderboard?scope=global');
    expect(status).toBe(200);
    const entries = body.entries as Json[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].username).toBe('alice');
    expect(Number(entries[0].score)).toBeGreaterThan(0);
  });

  it('supports the friends scope once friends exist', async () => {
    const { status, body } = await call('/leaderboard?scope=friends', { token: aliceToken });
    expect(status).toBe(200);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe('lyrics storage', () => {
  const songUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
  const lrc = ['[ti:Test]', '[00:01.00]Hello', '[00:05.00]World'].join('\n');

  it('saves and returns lyrics for a song', async () => {
    const saved = await call('/songs/lyrics', {
      method: 'PUT',
      token: aliceToken,
      body: { url: songUrl, lyrics: lrc },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.timed).toBe(true);
    expect(saved.body.lineCount).toBe(2);

    const fetched = await call(`/songs/lyrics?url=${encodeURIComponent(songUrl)}`, {
      token: aliceToken,
    });
    expect(fetched.status).toBe(200);
    const lyrics = fetched.body.lyrics as Json;
    expect(lyrics).not.toBeNull();
    expect(lyrics.content).toBe(lrc);
    expect(lyrics.timed).toBe(true);
  });

  it('returns null lyrics for unknown songs', async () => {
    const fetched = await call(
      `/songs/lyrics?url=${encodeURIComponent('https://www.youtube.com/watch?v=aaaaaaaaaaa')}`,
      { token: bobToken },
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.lyrics).toBeNull();
  });
});

describe('friends', () => {
  it('searches players and completes a request/accept flow', async () => {
    const search = await call('/friends/search?q=bo', { token: aliceToken });
    expect(search.status).toBe(200);
    const users = search.body.users as Json[];
    expect(users.some((u) => u.username === 'bob')).toBe(true);

    const request = await call('/friends/request', {
      method: 'POST',
      token: aliceToken,
      body: { username: 'bob' },
    });
    expect(request.status).toBe(201);

    const bobList = await call('/friends', { token: bobToken });
    const incoming = bobList.body.incoming as Json[];
    expect(incoming).toHaveLength(1);

    const accept = await call(`/friends/${incoming[0].id}/respond`, {
      method: 'POST',
      token: bobToken,
      body: { action: 'accept' },
    });
    expect(accept.status).toBe(200);
    expect((accept.body.friends as Json[]).some((f) => f.username === 'alice')).toBe(true);

    const aliceList = await call('/friends', { token: aliceToken });
    expect((aliceList.body.friends as Json[]).some((f) => f.username === 'bob')).toBe(true);
  });

  it('rejects self-friending', async () => {
    const { status } = await call('/friends/request', {
      method: 'POST',
      token: aliceToken,
      body: { username: 'alice' },
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

describe('battles (REST)', () => {
  it('creates a battle with a 6-character join code', async () => {
    const { status, body } = await call('/battles', {
      method: 'POST',
      token: aliceToken,
      body: { songUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mode: 'challenge' },
    });
    expect(status).toBe(201);
    const battle = body.battle as Json;
    expect(String(battle.joinCode)).toHaveLength(6);
    expect(battle.status).toBe('waiting');
    battleId = Number(battle.id);
    battleCode = String(battle.joinCode);
  });

  it('lets a second player join and activates the battle', async () => {
    const { status, body } = await call('/battles/join', {
      method: 'POST',
      token: bobToken,
      body: { code: battleCode },
    });
    expect(status).toBe(200);
    expect((body.battle as Json).status).toBe('active');
  });

  it('refuses double joins', async () => {
    const again = await call('/battles/join', {
      method: 'POST',
      token: bobToken,
      body: { code: battleCode },
    });
    expect(again.status).toBe(409);
  });

  it('refuses joining your own battle', async () => {
    const created = await call('/battles', {
      method: 'POST',
      token: aliceToken,
      body: { songUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mode: 'practice' },
    });
    expect(created.status).toBe(201);
    const ownCode = String((created.body.battle as Json).joinCode);

    const own = await call('/battles/join', {
      method: 'POST',
      token: aliceToken,
      body: { code: ownCode },
    });
    expect(own.status).toBe(400);
  });

  it('reports standings for both players', async () => {
    const { status, body } = await call(`/battles/${battleId}/standings`, { token: aliceToken });
    expect(status).toBe(200);
    const players = body.players as Json[];
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.username).sort()).toEqual(['alice', 'bob']);
  });
});

describe('battles (realtime WebSocket)', () => {
  it('streams live scores and finishes with standings', async () => {
    const alice = await connect(aliceToken, battleId);
    const bob = await connect(bobToken, battleId);

    await alice.waitUntil((m) => m.some((x) => x.type === 'joined'), 'alice joined');
    await bob.waitUntil((m) => m.some((x) => x.type === 'joined'), 'bob joined');

    // Host takes the lead.
    alice.send({ type: 'score', battleId, score: 500 });
    await alice.waitUntil(
      (m) => m.some((x) => x.type === 'scores' && Number(x.hostScore) === 500),
      'alice score broadcast',
    );
    await bob.waitUntil(
      (m) => m.some((x) => x.type === 'scores' && Number(x.hostScore) === 500),
      'alice score reaches bob',
    );

    // Opponent responds.
    bob.send({ type: 'score', battleId, score: 300 });
    await bob.waitUntil(
      (m) => m.some((x) => x.type === 'scores' && Number(x.opponentScore) === 300),
      'bob score broadcast',
    );

    // Bob finishes → server decides the winner by final score.
    bob.send({ type: 'finish', battleId, score: 300 });
    await alice.waitUntil((m) => m.some((x) => x.type === 'finished'), 'alice sees finish');
    await bob.waitUntil((m) => m.some((x) => x.type === 'finished'), 'bob sees finish');

    const finished = alice.messages.find((x) => x.type === 'finished') as Json;
    const standings = finished.standings as Json;
    expect(standings.players).toHaveLength(2);
    const winner = (standings.players as Json[]).find((p) => p.isWinner === true);
    expect(winner?.username).toBe('alice');

    alice.close();
    bob.close();
  }, 20_000);

  it('rejects unauthenticated socket upgrades', async () => {
    await expect(connect('', battleId)).rejects.toThrow();
  });
});

describe('rate limiting', () => {
  it('throttles repeated failed logins', async () => {
    let saw429 = false;
    for (let i = 0; i < 25; i += 1) {
      const { status } = await call('/auth/login', {
        method: 'POST',
        body: { identifier: 'rate-limitee', password: 'wrong-password' },
      });
      if (status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
