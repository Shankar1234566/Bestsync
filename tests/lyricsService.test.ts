/**
 * Lyrics discovery service — caching, dedupe, cooldown, verification and
 * provider fallbacks. Every provider here is a stub: the suite never calls
 * a live lyrics API (NODE_ENV=test also disables discovery by default).
 */
import { describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import {
  LyricsRateLimitedError,
  LyricsService,
  LrclibProvider,
  type LyricsProvider,
  type ProviderRecord,
} from '../src/server/services/lyricsService';
import type { SongRow } from '../src/server/services/songService';
import type { MatchQuery } from '../src/shared';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

class StubProvider implements LyricsProvider {
  readonly id = 'stub';
  readonly calls: MatchQuery[] = [];

  constructor(
    private readonly handler: (query: MatchQuery) => ProviderRecord[] | Promise<ProviderRecord[]>,
  ) {}

  async lookup(query: MatchQuery): Promise<ProviderRecord[]> {
    this.calls.push(query);
    return this.handler(query);
  }
}

function record(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: 101,
    trackName: 'Believer',
    artistName: 'Imagine Dragons',
    durationSec: 204,
    syncedLyrics: '[00:09.36] First things first\n[00:13.10] Second line here',
    plainLyrics: null,
    instrumental: false,
    ...overrides,
  };
}

let urlSeq = 0;
function insertSong(db: Database, title: string, artist = '7clouds'): SongRow {
  urlSeq += 1;
  const inserted = db.run(
    'INSERT INTO songs (provider, media_id, url, title, artist, artwork_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'youtube',
    `media-${urlSeq}`,
    `https://www.youtube.com/watch?v=media-${urlSeq}`,
    title,
    artist,
    '',
    Date.now(),
  );
  return db.get<SongRow>('SELECT * FROM songs WHERE id = ?', inserted.lastInsertRowid)!;
}

function makeService(
  provider: LyricsProvider,
  overrides: { enabled?: boolean; now?: () => number } = {},
): { service: LyricsService; db: Database } {
  const db = new Database(':memory:');
  const service = new LyricsService(db, [provider], {
    enabled: overrides.enabled ?? true,
    now: overrides.now,
  });
  return { service, db };
}

/* ------------------------------------------------------------------ */
/* Discovery engine                                                    */
/* ------------------------------------------------------------------ */

describe('LyricsService.discover', () => {
  it('verifies and returns lyrics for the identified song', async () => {
    const provider = new StubProvider(() => [record()]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const result = await service.discover(song, 214);

    expect(result.reason).toBeNull();
    expect(result.lyrics).not.toBeNull();
    expect(result.lyrics?.timed).toBe(true);
    expect(result.lyrics?.provider).toBe('stub');
    expect(result.lyrics?.matchedTitle).toBe('Believer');
    expect(result.lyrics?.matchScore).toBeGreaterThan(0.5);
    // The aggregator channel must have been peeled into the real artist.
    expect(provider.calls[0]?.artist).toBe('Imagine Dragons');
    expect(provider.calls[0]?.title).toBe('Believer (Lyrics)');
  });

  it('never returns another song’s lyrics (golden rule)', async () => {
    const provider = new StubProvider(() => [
      record({ trackName: 'Completely Different Song', artistName: 'Someone Else' }),
    ]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const result = await service.discover(song, 214);

    expect(result.lyrics).toBeNull();
    expect(result.reason).toBe('not-found');
  });

  it('caches a successful lookup so the provider is called once', async () => {
    const provider = new StubProvider(() => [record()]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const first = await service.discover(song, 214);
    const second = await service.discover(song, 214);

    expect(provider.calls).toHaveLength(1);
    expect(second.lyrics?.content).toBe(first.lyrics?.content);
    expect(second.lyrics?.fetchedAt).toBe(first.lyrics?.fetchedAt);
  });

  it('shares one round-trip between concurrent calls for the same song', async () => {
    const provider = new StubProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [record()];
    });
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const [a, b] = await Promise.all([service.discover(song, 214), service.discover(song, 214)]);

    expect(provider.calls).toHaveLength(1);
    expect(a.lyrics?.content).toBe(b.lyrics?.content);
  });

  it('reports plain lyrics honestly as untimed', async () => {
    const provider = new StubProvider(() => [
      record({ syncedLyrics: null, plainLyrics: 'First things first\nSecond line here' }),
    ]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const result = await service.discover(song, 214);

    expect(result.lyrics?.timed).toBe(false);
    expect(result.lyrics?.content).toContain('First things first');
  });

  it('stays disabled and never calls the provider when switched off', async () => {
    const provider = new StubProvider(() => [record()]);
    const { service, db } = makeService(provider, { enabled: false });
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const result = await service.discover(song, 214);

    expect(result.reason).toBe('disabled');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses to search when the song has no title', async () => {
    const provider = new StubProvider(() => [record()]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, '   ');

    const result = await service.discover(song, 214);

    expect(result.reason).toBe('unknown-song');
    expect(provider.calls).toHaveLength(0);
  });

  it('back off the whole engine while a rate-limit cooldown is active', async () => {
    let clock = Date.now();
    let attempts = 0;
    // Echo back whatever song was asked for, so only the cooldown decides.
    const provider = new StubProvider((query) => {
      attempts += 1;
      if (attempts === 1) throw new LyricsRateLimitedError(30);
      return [record({ trackName: query.title, artistName: query.artist })];
    });
    const { service, db } = makeService(provider, { now: () => clock });
    const songA = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');
    const songB = insertSong(db, 'Rick Astley - Never Gonna Give You Up', 'Rick Astley');

    const first = await service.discover(songA, 214);
    expect(first.reason).toBe('busy');
    expect(attempts).toBe(1);

    // A different song during the cooldown must not hammer the provider.
    const second = await service.discover(songB, 213);
    expect(second.reason).toBe('busy');
    expect(attempts).toBe(1);

    // Past the Retry-After window (jitter adds up to +30%) the engine recovers.
    clock += 45_000;
    const third = await service.discover(songB, 213);
    expect(third.reason).toBeNull();
    expect(third.lyrics).not.toBeNull();
    expect(attempts).toBe(2);
  });

  it('maps a total provider failure to provider-error, not not-found', async () => {
    const provider = new StubProvider(() => {
      throw new Error('network down');
    });
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Imagine Dragons - Believer (Lyrics)');

    const result = await service.discover(song, 214);

    expect(result.reason).toBe('provider-error');
    expect(result.lyrics).toBeNull();
  });

  it('classifies instrumental tracks distinctly', async () => {
    // Only a *verified* candidate may claim the track is instrumental —
    // an unrelated instrumental record must still read as not-found.
    const provider = new StubProvider(() => [
      record({
        trackName: 'Sunset Drive',
        artistName: '7clouds',
        instrumental: true,
        syncedLyrics: null,
        plainLyrics: null,
      }),
    ]);
    const { service, db } = makeService(provider);
    const song = insertSong(db, 'Sunset Drive');

    const result = await service.discover(song, 214);

    expect(result.reason).toBe('instrumental');
    expect(LyricsService.hintFor(result.reason)).toMatch(/instrumental/i);
  });
});

describe('LyricsService.hintFor', () => {
  it('returns a friendly, actionable message for every reason', () => {
    const reasons = [
      'disabled',
      'unknown-song',
      'not-found',
      'instrumental',
      'busy',
      'provider-error',
    ] as const;
    for (const reason of reasons) {
      const hint = LyricsService.hintFor(reason);
      expect(hint.length).toBeGreaterThan(20);
    }
    expect(LyricsService.hintFor('not-found')).toMatch(/fallback/i);
    expect(LyricsService.hintFor(null)).toMatch(/fallback/i);
  });
});

/* ------------------------------------------------------------------ */
/* LRCLIB provider                                                     */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LrclibProvider', () => {
  it('falls back to a general keyword search when the parameterized one misses', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/api/get')) return new Response(null, { status: 404 });
      if (url.includes('/api/search') && url.includes('track_name=')) return jsonResponse([]);
      if (url.includes('/api/search') && url.includes('q=')) {
        return jsonResponse([
          { id: 9, trackName: 'Believer', artistName: 'Imagine Dragons', duration: 204 },
        ]);
      }
      return jsonResponse([]);
    }) as typeof fetch;

    const provider = new LrclibProvider(fetchImpl, 'BeatSync-Tests');
    const out = await provider.lookup({ title: 'Believer (Lyrics)', artist: '7clouds', durationSec: 214 });

    expect(out).toHaveLength(1);
    expect(out[0]?.trackName).toBe('Believer');
    // get → parameterized search → general q search
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain('/api/search?q=believer');
  });

  it('maps 404 to "no candidates" instead of an error', async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const provider = new LrclibProvider(fetchImpl, 'BeatSync-Tests');

    await expect(provider.lookup({ title: 'Nope', artist: 'Nobody' })).resolves.toEqual([]);
  });

  it('surfaces 429 as a rate-limit error carrying Retry-After', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 429, headers: { 'Retry-After': '7' } })) as typeof fetch;
    const provider = new LrclibProvider(fetchImpl, 'BeatSync-Tests');

    const error = await provider.lookup({ title: 'Believer' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LyricsRateLimitedError);
    expect((error as LyricsRateLimitedError).retryAfterSec).toBe(7);
  });

  it('identifies itself to the provider via the configured client id', async () => {
    const seen: (string | null)[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('User-Agent'));
      return jsonResponse([]);
    }) as typeof fetch;
    const provider = new LrclibProvider(fetchImpl, 'BeatSync-Custom-Client');

    await provider.lookup({ title: 'Believer' });

    expect(seen[0]).toBe('BeatSync-Custom-Client');
  });
});
