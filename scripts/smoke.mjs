/* Quick API smoke script — run with: node scripts/smoke.mjs */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4099';
const results = [];

async function step(name, fn) {
  try {
    const out = await fn();
    results.push(['PASS', name, out ?? '']);
  } catch (error) {
    results.push(['FAIL', name, error.message]);
    throw error;
  }
}

const req = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
};

const expect = (cond, message) => { if (!cond) throw new Error(message); };

await step('health', async () => {
  const { status, body } = await req('/api/health');
  expect(status === 200 && body.status === 'ok', `status ${status}`);
});

let token = '';
await step('register', async () => {
  const { status, body } = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'smoketester', email: 'smoke@beatsync.dev', password: 'supersecret1', country: 'IN' }),
  });
  expect(status === 201 && body.token, `status ${status} ${JSON.stringify(body)}`);
  token = body.token;
});

await step('duplicate register rejected', async () => {
  const { status } = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'smoketester', email: 'other@beatsync.dev', password: 'supersecret1' }),
  });
  expect(status === 409, `status ${status}`);
});

await step('login', async () => {
  const { status, body } = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'smoketester', password: 'supersecret1' }),
  });
  expect(status === 200 && body.token, `status ${status}`);
  token = body.token;
});

const auth = { Authorization: `Bearer ${token}` };

await step('me', async () => {
  const { status, body } = await req('/api/auth/me', { headers: auth });
  expect(status === 200 && body.profile.username === 'smoketester', `status ${status}`);
});

await step('song validate (youtube)', async () => {
  const { status, body } = await req('/api/songs/validate', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
  });
  expect(status === 200 && body.detection.valid && body.detection.provider === 'youtube', `status ${status} ${JSON.stringify(body)}`);
});

await step('song validate (bad link)', async () => {
  const { status, body } = await req('/api/songs/validate', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/not-a-song' }),
  });
  expect(status === 200 && body.detection.valid === false && body.detection.reason, `status ${status}`);
});

// A plausible score: 150 chars in 60s => wpm = 150/5/1 = 30, accuracy 100 (keystrokes 150, mistakes 0)
await step('submit score', async () => {
  const { status, body } = await req('/api/scores', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      songUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mode: 'practice',
      wpm: 30, cpm: 150, accuracy: 100,
      correctChars: 150, incorrectChars: 0, totalMistakes: 0, keystrokes: 150,
      bestCombo: 40, score: 720, completion: 100,
      elapsedMs: 60000, linesCompleted: 10, linesMissed: 0, totalLines: 10,
      tempoRate: 1, adaptiveTempo: false,
    }),
  });
  expect(status === 201 && body.accepted, `status ${status} ${JSON.stringify(body)}`);
  return `xp+${body.xpGained} level=${body.level} badges=${body.unlockedBadges?.length}`;
});

await step('reject implausible score (400 wpm)', async () => {
  const { status, body } = await req('/api/scores', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      songUrl: null, mode: 'practice',
      wpm: 400, cpm: 2000, accuracy: 100,
      correctChars: 5000, incorrectChars: 0, totalMistakes: 0, keystrokes: 5000,
      bestCombo: 900, score: 5000, completion: 100,
      elapsedMs: 60000, linesCompleted: 10, linesMissed: 0, totalLines: 10,
      tempoRate: 1, adaptiveTempo: false,
    }),
  });
  expect(status === 422, `status ${status} ${JSON.stringify(body)}`);
});

await step('challenges progress', async () => {
  const { status, body } = await req('/api/challenges', { headers: auth });
  expect(status === 200 && body.daily.length === 4 && body.weekly.length === 5, `status ${status}`);
  const dailySong = body.daily.find((c) => c.id === 'daily-song');
  expect(dailySong.completed === true, `daily-song not completed: ${JSON.stringify(dailySong)}`);
});

await step('badges', async () => {
  const { status, body } = await req('/api/badges', { headers: auth });
  const first = body.badges.find((b) => b.id === 'first-song');
  expect(status === 200 && first.unlocked === true, `status ${status} ${JSON.stringify(body.badges?.slice(0,2))}`);
});

await step('leaderboard has entry', async () => {
  const { status, body } = await req('/api/leaderboard?scope=global');
  expect(status === 200 && body.entries.length >= 1 && body.entries[0].rank === 1, `status ${status} ${JSON.stringify(body)}`);
});

await step('friend flow', async () => {
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'smokepal', email: 'pal@beatsync.dev', password: 'supersecret1' }),
  });
  const palToken = reg.body.token;
  const r1 = await req('/api/friends/request', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ username: 'smokepal' }),
  });
  expect(r1.status === 201, `request ${r1.status}`);
  const list = await req('/api/friends', { headers: { Authorization: `Bearer ${palToken}` } });
  expect(list.body.incoming.length === 1, `incoming ${JSON.stringify(list.body)}`);
  const accept = await req(`/api/friends/${list.body.incoming[0].id}/respond`, {
    method: 'POST', headers: { Authorization: `Bearer ${palToken}` },
    body: JSON.stringify({ action: 'accept' }),
  });
  expect(accept.status === 200 && accept.body.friends.length === 1, `accept ${accept.status}`);
  const friendsBoard = await req('/api/leaderboard?scope=friends', { headers: auth });
  expect(friendsBoard.status === 200 && friendsBoard.body.entries.length >= 1, `friends board ${friendsBoard.status}`);
});

await step('battle create + join', async () => {
  const created = await req('/api/battles', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ songUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', mode: 'challenge' }),
  });
  expect(created.status === 201 && created.body.battle.joinCode.length === 6, `create ${created.status}`);
  const pal = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'smokepal', password: 'supersecret1' }),
  });
  const joined = await req('/api/battles/join', {
    method: 'POST', headers: { Authorization: `Bearer ${pal.body.token}` },
    body: JSON.stringify({ code: created.body.battle.joinCode }),
  });
  expect(joined.status === 200 && joined.body.battle.status === 'active', `join ${joined.status} ${JSON.stringify(joined.body)}`);
});

await step('rate limit kicks in (auth bucket)', async () => {
  let saw429 = false;
  for (let i = 0; i < 25; i += 1) {
    const { status } = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'nobody', password: 'wrongwrong' }),
    });
    if (status === 429) { saw429 = true; break; }
  }
  expect(saw429, 'no 429 after 25 rapid login attempts');
});

const failed = results.filter(([s]) => s === 'FAIL');
for (const [status, name, info] of results) console.log(`${status}  ${name}  ${info}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
