/**
 * Song records, play history, favourites and user-saved lyrics.
 * Song metadata is fetched via official oEmbed endpoints (YouTube/Spotify)
 * — never by scraping or downloading protected audio.
 */
import type { Database } from '../db/database';
import { HttpError } from '../http/helpers';
import { parsePlayerUrl, type ProviderDetection } from '../../shared';

export interface SongRow {
  id: number;
  provider: string;
  media_id: string | null;
  url: string;
  title: string;
  artist: string;
  artwork_url: string;
  created_at: number;
}

export interface SongMetadata {
  title: string;
  artist: string;
  artworkUrl: string;
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

export class SongService {
  constructor(private readonly db: Database) {}

  /**
   * Find or create a song row for a validated link.
   * Existing metadata wins unless new values are provided.
   */
  upsert(detection: ProviderDetection, meta?: Partial<SongMetadata>): SongRow {
    if (!detection.valid || !detection.normalizedUrl) {
      throw new HttpError(400, detection.reason ?? 'Invalid song link.');
    }
    const url = detection.normalizedUrl;
    const existing = this.db.get<SongRow>('SELECT * FROM songs WHERE url = ?', url);

    if (existing) {
      const title = meta?.title?.trim() || existing.title;
      const artist = meta?.artist?.trim() || existing.artist;
      const artwork = meta?.artworkUrl?.trim() || existing.artwork_url;
      if (title !== existing.title || artist !== existing.artist || artwork !== existing.artwork_url) {
        this.db.run(
          'UPDATE songs SET title = ?, artist = ?, artwork_url = ? WHERE id = ?',
          title,
          artist,
          artwork,
          existing.id,
        );
        return { ...existing, title, artist, artwork_url: artwork };
      }
      return existing;
    }

    const inserted = this.db.run(
      `INSERT INTO songs (provider, media_id, url, title, artist, artwork_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      detection.provider,
      detection.mediaId,
      url,
      meta?.title?.trim() ?? '',
      meta?.artist?.trim() ?? '',
      meta?.artworkUrl?.trim() ?? '',
      Date.now(),
    );
    return this.byId(inserted.lastInsertRowid)!;
  }

  byId(id: number): SongRow | undefined {
    return this.db.get<SongRow>('SELECT * FROM songs WHERE id = ?', id);
  }

  byUrl(url: string): SongRow | undefined {
    return this.db.get<SongRow>('SELECT * FROM songs WHERE url = ?', url);
  }

  recordPlay(userId: number, songId: number): void {
    this.db.run(
      'INSERT INTO song_history (user_id, song_id, played_at) VALUES (?, ?, ?)',
      userId,
      songId,
      Date.now(),
    );
  }

  recent(userId: number, limit = 12): (SongRow & { played_at: number })[] {
    return this.db.all<SongRow & { played_at: number }>(
      `SELECT s.*, MAX(h.played_at) AS played_at
       FROM song_history h
       JOIN songs s ON s.id = h.song_id
       WHERE h.user_id = ?
       GROUP BY h.song_id
       ORDER BY played_at DESC
       LIMIT ?`,
      userId,
      Math.min(Math.max(limit, 1), 50),
    );
  }

  addFavourite(userId: number, songId: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO favourites (user_id, song_id, created_at) VALUES (?, ?, ?)',
      userId,
      songId,
      Date.now(),
    );
  }

  removeFavourite(userId: number, songId: number): void {
    this.db.run('DELETE FROM favourites WHERE user_id = ? AND song_id = ?', userId, songId);
  }

  favourites(userId: number): SongRow[] {
    return this.db.all<SongRow>(
      `SELECT s.* FROM favourites f
       JOIN songs s ON s.id = f.song_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
      userId,
    );
  }

  isFavourite(userId: number, songId: number): boolean {
    const row = this.db.get(
      'SELECT 1 AS x FROM favourites WHERE user_id = ? AND song_id = ?',
      userId,
      songId,
    );
    return row !== undefined;
  }

  saveLyrics(userId: number, songId: number, content: string, timed: boolean): void {
    this.db.run(
      `INSERT INTO lyrics (song_id, user_id, content, is_timestamped, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(song_id, user_id)
       DO UPDATE SET content = excluded.content,
                     is_timestamped = excluded.is_timestamped,
                     updated_at = excluded.updated_at`,
      songId,
      userId,
      content,
      timed ? 1 : 0,
      Date.now(),
    );
  }

  lyrics(
    userId: number,
    songId: number,
  ): { content: string; is_timestamped: number; updated_at: number } | undefined {
    return this.db.get(
      'SELECT content, is_timestamped, updated_at FROM lyrics WHERE song_id = ? AND user_id = ?',
      songId,
      userId,
    );
  }

  /**
   * Fetch title/artist/artwork through the providers' official oEmbed APIs.
   * Network failures are non-fatal — returns empty metadata.
   */
  async fetchMetadata(detection: ProviderDetection): Promise<SongMetadata> {
    const empty: SongMetadata = { title: '', artist: '', artworkUrl: '' };
    if (!detection.valid || !detection.normalizedUrl) return empty;

    if (detection.provider === 'direct-audio') {
      try {
        const name = decodeURIComponent(
          new URL(detection.normalizedUrl).pathname.split('/').pop() ?? '',
        );
        const base = name.replace(/\.[^.]+$/, '');
        return { title: base, artist: 'Direct audio', artworkUrl: '' };
      } catch {
        return empty;
      }
    }

    if (detection.provider === 'youtube' || detection.provider === 'spotify') {
      try {
        const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
          detection.normalizedUrl,
        )}&format=json`;
        const spotifyEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(
          detection.normalizedUrl,
        )}`;
        const url = detection.provider === 'youtube' ? endpoint : spotifyEndpoint;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return empty;
        const data = (await response.json()) as OEmbedResponse;
        return {
          title: data.title ?? '',
          artist: data.author_name ?? '',
          artworkUrl: data.thumbnail_url ?? '',
        };
      } catch {
        return empty;
      }
    }

    return empty;
  }

  /** Convenience: validate + upsert + (optionally) fetch metadata. */
  async resolveSong(rawUrl: string, withMetadata = false): Promise<{ detection: ProviderDetection; song: SongRow }> {
    const detection = parsePlayerUrl(rawUrl);
    if (!detection.valid || !detection.normalizedUrl) {
      throw new HttpError(400, detection.reason ?? 'Invalid song link.', { url: 'invalid' });
    }
    const meta = withMetadata ? await this.fetchMetadata(detection) : undefined;
    const song = this.upsert(detection, meta);
    return { detection, song };
  }
}
