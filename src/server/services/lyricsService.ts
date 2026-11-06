/**
 * Automatic lyrics discovery.
 *
 * A provider-independent engine: given an identified song (title/artist from
 * the provider's official oEmbed metadata), it asks each configured
 * `LyricsProvider` for candidates, verifies with the shared match scorer that
 * the lyrics really belong to this song, and caches the result per song.
 *
 * Golden rule: when no candidate passes verification we return *no lyrics*
 * with a friendly reason — we never show another song's words.
 *
 * Current providers: LRCLIB (free, open, no key required — https://lrclib.net).
 * Musixmatch-style providers can be added by implementing `LyricsProvider`
 * and registering them in `context.ts`; no other code needs to change.
 */
import {
  normalizeForMatch,
  parseLyricsInput,
  scoreLyricsMatch,
  splitTitleArtist,
  type MatchQuery,
} from '../../shared';
import type { Database } from '../db/database';
import type { SongRow } from './songService';

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface ProviderRecord {
  id: number;
  trackName: string;
  artistName: string | null;
  durationSec: number | null;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

export interface LyricsProvider {
  /** Stable identifier stored in the cache (e.g. `lrclib`). */
  readonly id: string;
  /**
   * Return candidate records for a query. Implementations should return an
   * empty array for "not found" and only throw for transport failures.
   */
  lookup(query: MatchQuery): Promise<ProviderRecord[]>;
}

/** Raised when a provider tells us to back off (HTTP 429/503). */
export class LyricsRateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super(`Lyrics provider rate limited — retry after ${retryAfterSec}s`);
    this.name = 'LyricsRateLimitedError';
  }
}

/* ------------------------------------------------------------------ */
/* LRCLIB provider                                                     */
/* ------------------------------------------------------------------ */

interface LrclibRecord {
  id: number;
  /** `name` is LRCLIB's legacy alias of `trackName`. */
  name?: string;
  trackName?: string;
  artistName?: string | null;
  duration?: number | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

function toProviderRecord(raw: LrclibRecord): ProviderRecord {
  return {
    id: Number(raw.id) || 0,
    trackName: String(raw.trackName ?? raw.name ?? ''),
    artistName: raw.artistName ? String(raw.artistName) : null,
    durationSec: typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : null,
    syncedLyrics: typeof raw.syncedLyrics === 'string' && raw.syncedLyrics.trim() ? raw.syncedLyrics : null,
    plainLyrics: typeof raw.plainLyrics === 'string' && raw.plainLyrics.trim() ? raw.plainLyrics : null,
    instrumental: raw.instrumental === true,
  };
}

export class LrclibProvider implements LyricsProvider {
  readonly id = 'lrclib';

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    /**
     * LRCLIB asks clients to identify themselves (name + version + link or
     * email). Overridable via LYRICS_CLIENT_ID for your deployment.
     */
    private readonly clientIdentity = 'BeatSync v0.1.0 (https://github.com/ElevateIQ/Bestsync)',
  ) {}

  private headers(): Record<string, string> {
    return { Accept: 'application/json', 'User-Agent': this.clientIdentity };
  }

  private static retryAfterSec(res: Response): number {
    const raw = Number(res.headers.get('Retry-After'));
    return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 5;
  }

  private async getJson(url: string): Promise<unknown | null> {
    const res = await this.fetchImpl(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(6_000),
    });
    if (res.status === 404) return null; // TrackNotFound — a legitimate answer
    if (res.status === 429 || res.status === 503) {
      throw new LyricsRateLimitedError(LrclibProvider.retryAfterSec(res));
    }
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  }

  /**
   * 1) signature lookup (`/api/get`) when title+artist are known — LRCLIB
   *    matches on the track signature and duration;
   * 2) keyword search (`/api/search`) as a fallback / for artist-less titles.
   * Both flows return unverified candidates — verification happens in the
   * service via `scoreLyricsMatch`.
   */
  async lookup(query: MatchQuery): Promise<ProviderRecord[]> {
    const seen = new Set<string>();
    const out: ProviderRecord[] = [];
    const push = (raw: unknown): void => {
      if (!raw || typeof raw !== 'object') return;
      const rec = toProviderRecord(raw as LrclibRecord);
      if (!rec.trackName || seen.has(`${rec.id}`)) return;
      seen.add(`${rec.id}`);
      out.push(rec);
    };

    const title = query.title.trim();
    const artist = (query.artist ?? '').trim();
    if (!title) return [];

    if (artist) {
      const params = new URLSearchParams({ track_name: title, artist_name: artist });
      const duration = query.durationSec;
      if (duration !== null && duration !== undefined && duration >= 1 && duration <= 3600) {
        params.set('duration', String(Math.round(duration)));
      }
      push(await this.getJson(`https://lrclib.net/api/get?${params.toString()}`));
    }

    const search = new URLSearchParams(
      artist ? { track_name: title, artist_name: artist } : { q: title },
    );
    const list = await this.getJson(`https://lrclib.net/api/search?${search.toString()}`);
    if (Array.isArray(list)) list.forEach(push);

    // Recall safety net: the parameterized search misses when the title
    // still carries provider noise ("(Lyrics)") or the artist hint is an
    // aggregator channel. One general keyword search with the normalized
    // title runs only when nothing was found — verification still decides
    // what may be shown, so this can add candidates, never bypass a gate.
    if (out.length === 0) {
      const general = new URLSearchParams({ q: normalizeForMatch(title) || title });
      const retry = await this.getJson(`https://lrclib.net/api/search?${general.toString()}`);
      if (Array.isArray(retry)) retry.forEach(push);
    }

    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Discovery service                                                   */
/* ------------------------------------------------------------------ */

export interface DiscoveredLyrics {
  content: string;
  timed: boolean;
  provider: string;
  providerTrackId: number | null;
  matchedTitle: string;
  matchedArtist: string;
  matchScore: number;
  fetchedAt: number;
}

/** Why discovery returned nothing — mapped to a friendly client message. */
export type DiscoveryReason =
  | 'disabled'
  | 'unknown-song'
  | 'not-found'
  | 'instrumental'
  | 'busy'
  | 'provider-error';

export interface DiscoveryResult {
  lyrics: DiscoveredLyrics | null;
  reason: DiscoveryReason | null;
}

interface CacheRow {
  provider: string;
  provider_track_id: number | null;
  matched_title: string;
  matched_artist: string;
  match_score: number;
  content: string;
  is_timestamped: number;
  fetched_at: number;
  expires_at: number;
}

export interface LyricsServiceOptions {
  enabled: boolean;
  /** Cache lifetime for a successful lookup (default 7 days). */
  cacheTtlMs?: number;
  now?: () => number;
}

export class LyricsService {
  private readonly inflight = new Map<number, Promise<DiscoveryResult>>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private providerCooldownUntil = 0;

  constructor(
    private readonly db: Database,
    private readonly providers: LyricsProvider[],
    private readonly options: LyricsServiceOptions,
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  private readCache(songId: number): DiscoveredLyrics | null {
    const row = this.db.get<CacheRow>(
      'SELECT * FROM discovered_lyrics WHERE song_id = ? AND expires_at > ?',
      songId,
      this.now(),
    );
    if (!row) return null;
    return {
      content: row.content,
      timed: row.is_timestamped === 1,
      provider: row.provider,
      providerTrackId: row.provider_track_id,
      matchedTitle: row.matched_title,
      matchedArtist: row.matched_artist,
      matchScore: row.match_score,
      fetchedAt: row.fetched_at,
    };
  }

  private writeCache(songId: number, lyrics: DiscoveredLyrics): void {
    this.db.run(
      `INSERT INTO discovered_lyrics
         (song_id, provider, provider_track_id, matched_title, matched_artist,
          match_score, content, is_timestamped, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(song_id) DO UPDATE SET
         provider = excluded.provider,
         provider_track_id = excluded.provider_track_id,
         matched_title = excluded.matched_title,
         matched_artist = excluded.matched_artist,
         match_score = excluded.match_score,
         content = excluded.content,
         is_timestamped = excluded.is_timestamped,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`,
      songId,
      lyrics.provider,
      lyrics.providerTrackId,
      lyrics.matchedTitle,
      lyrics.matchedArtist,
      lyrics.matchScore,
      lyrics.content,
      lyrics.timed ? 1 : 0,
      lyrics.fetchedAt,
      lyrics.fetchedAt + this.cacheTtlMs,
    );
  }

  /**
   * Find lyrics for an identified song. Safe to call concurrently — parallel
   * calls for the same song share one provider round-trip, and provider
   * rate limits back the whole engine off instead of hammering.
   */
  async discover(song: SongRow, durationSec?: number | null): Promise<DiscoveryResult> {
    if (!this.options.enabled || this.providers.length === 0) {
      return { lyrics: null, reason: 'disabled' };
    }
    const cached = this.readCache(song.id);
    if (cached) return { lyrics: cached, reason: null };

    const pending = this.inflight.get(song.id);
    if (pending) return pending;

    const run = this.runDiscovery(song, durationSec ?? null);
    this.inflight.set(song.id, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(song.id);
    }
  }

  private async runDiscovery(song: SongRow, durationSec: number | null): Promise<DiscoveryResult> {
    if (this.now() < this.providerCooldownUntil) return { lyrics: null, reason: 'busy' };
    if (!song.title.trim()) return { lyrics: null, reason: 'unknown-song' };

    // Peel provider noise: "Rick Astley - Never Gonna Give You Up (Official…)"
    // becomes track="Never Gonna Give You Up", artist="Rick Astley".
    const parts = splitTitleArtist(song.title, song.artist);
    const query: MatchQuery = { title: parts.title, artist: parts.artist, durationSec };
    if (!query.title) return { lyrics: null, reason: 'unknown-song' };

    let transportFailures = 0;
    let sawInstrumental = false;

    for (const provider of this.providers) {
      let records: ProviderRecord[];
      try {
        records = await provider.lookup(query);
      } catch (error) {
        if (error instanceof LyricsRateLimitedError) {
          // Honor Retry-After with a little jitter so retries don't sync up.
          const waitSec = error.retryAfterSec * (1 + Math.random() * 0.3);
          this.providerCooldownUntil = this.now() + waitSec * 1000;
          return { lyrics: null, reason: 'busy' };
        }
        transportFailures += 1;
        continue;
      }
      if (records.length === 0) continue;

      const scored = records
        .map((record) => ({ record, match: scoreLyricsMatch(query, record) }))
        .filter((entry) => entry.match.acceptable)
        .sort((a, b) => b.match.score - a.match.score);

      if (scored.length === 0) continue;

      // Prefer timestamped lyrics unless another verified candidate scores
      // essentially the same — sync quality beats a hair of similarity.
      const top = scored[0];
      const synced =
        scored.find((entry) => entry.record.syncedLyrics !== null && entry.match.score >= top.match.score - 0.08) ??
        top;

      const content = (synced.record.syncedLyrics ?? synced.record.plainLyrics ?? '').trim();
      if (!content) {
        if (synced.record.instrumental) sawInstrumental = true;
        continue;
      }

      const parsed = parseLyricsInput(content);
      if (parsed.lines.length === 0) continue;

      const lyrics: DiscoveredLyrics = {
        content,
        // parseLyricsInput decides: LRC with ≥30% stamped lines = timed.
        // Plain lyrics are honestly reported as untimed (typing-paced play).
        timed: parsed.timed,
        provider: provider.id,
        providerTrackId: synced.record.id || null,
        matchedTitle: synced.record.trackName,
        matchedArtist: synced.record.artistName ?? '',
        matchScore: Number(synced.match.score.toFixed(4)),
        fetchedAt: this.now(),
      };
      this.writeCache(song.id, lyrics);
      return { lyrics, reason: null };
    }

    if (sawInstrumental) return { lyrics: null, reason: 'instrumental' };
    if (transportFailures === this.providers.length) return { lyrics: null, reason: 'provider-error' };
    return { lyrics: null, reason: 'not-found' };
  }

  /** Friendly hint for the UI when discovery found nothing. */
  static hintFor(reason: DiscoveryReason | null): string {
    switch (reason) {
      case 'instrumental':
        return 'This track looks instrumental — no lyrics to type. You can still free-type your own text.';
      case 'unknown-song':
        return 'Could not identify this song from its link, so lyrics were not searched.';
      case 'busy':
        return 'The lyrics service is busy right now — we will try again shortly.';
      case 'provider-error':
        return 'The lyrics service could not be reached. You can add lyrics manually in the meantime.';
      case 'disabled':
      case 'not-found':
      default:
        return 'No matching lyrics found for this song — you can add your own as a fallback.';
    }
  }
}
