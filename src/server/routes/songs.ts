/**
 * Song routes: metadata resolution, history, favourites and user lyrics.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap, isRecord, requireString } from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { parseLyricsInput, parsePlayerUrl } from '../../shared';
import { LyricsService } from '../services/lyricsService';
import type { SongRow } from '../services/songService';

const MAX_LYRICS_CHARS = 20_000;

/** Public song shape returned with lyrics responses. */
function songDto(song: SongRow): {
  id: number;
  provider: string;
  title: string;
  artist: string;
  artworkUrl: string;
} {
  return {
    id: song.id,
    provider: song.provider,
    title: song.title,
    artist: song.artist,
    artworkUrl: song.artwork_url,
  };
}

export function songRoutes(ctx: AppContext): Router {
  const router = Router();

  const metadataLimiter = rateLimit({
    bucket: 'metadata',
    windowMs: 60_000,
    max: 30,
  });

  // Discovery may make outbound provider calls — keep anonymous visitors
  // from sweeping the bucket (cache hits below this limit are free).
  const lyricsLimiter = rateLimit({
    bucket: 'lyrics',
    windowMs: 60_000,
    max: 24,
  });

  /** Validate a link and return provider, capabilities, limitations, metadata. */
  router.post(
    '/metadata',
    metadataLimiter,
    wrap(async (req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      const url = requireString(body, 'url', { max: 2048, label: 'Song link' });
      const detection = parsePlayerUrl(url);
      if (!detection.valid || !detection.normalizedUrl) {
        res.status(400).json({ error: detection.reason ?? 'Invalid song link.', detection });
        return;
      }
      const song = ctx.songs.upsert(detection);
      let metadata = {
        title: song.title,
        artist: song.artist,
        artworkUrl: song.artwork_url,
      };
      if (!metadata.title) {
        const fetched = await ctx.songs.fetchMetadata(detection);
        if (fetched.title || fetched.artworkUrl) {
          ctx.songs.upsert(detection, fetched);
          metadata = fetched;
        }
      }
      res.json({ detection, song: { ...song, ...metadata } });
    }),
  );

  /** Detect provider without touching the database (instant UI feedback). */
  router.post(
    '/validate',
    wrap((req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      const url = requireString(body, 'url', { max: 2048, label: 'Song link' });
      res.json({ detection: parsePlayerUrl(url) });
    }),
  );

  router.get(
    '/recent',
    requireAuth,
    wrap((req, res) => {
      res.json({ songs: ctx.songs.recent(authedUserId(req), 12) });
    }),
  );

  router.get(
    '/favourites',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      res.json({ songs: ctx.songs.favourites(userId) });
    }),
  );

  router.post(
    '/favourites',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const url = requireString(body, 'url', { max: 2048, label: 'Song link' });
      const detection = parsePlayerUrl(url);
      if (!detection.valid || !detection.normalizedUrl) {
        res.status(400).json({ error: detection.reason ?? 'Invalid song link.' });
        return;
      }
      const song = ctx.songs.upsert(detection);
      ctx.songs.addFavourite(userId, song.id);
      res.status(201).json({ song, favourite: true });
    }),
  );

  router.delete(
    '/favourites/:songId',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const songId = Number(req.params.songId);
      if (!Number.isInteger(songId)) {
        res.status(400).json({ error: 'Invalid song id.' });
        return;
      }
      ctx.songs.removeFavourite(userId, songId);
      res.json({ songId, favourite: false });
    }),
  );

  /** Save the user's own lyrics (plain or LRC) for a song. */
  router.put(
    '/lyrics',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const body = isRecord(req.body) ? req.body : {};
      const url = requireString(body, 'url', { max: 2048, label: 'Song link' });
      const lyrics = requireString(body, 'lyrics', { min: 0, max: MAX_LYRICS_CHARS, label: 'Lyrics' });

      const detection = parsePlayerUrl(url);
      if (!detection.valid || !detection.normalizedUrl) {
        res.status(400).json({ error: detection.reason ?? 'Invalid song link.' });
        return;
      }
      const song = ctx.songs.upsert(detection);
      const parsed = parseLyricsInput(lyrics);
      ctx.songs.saveLyrics(userId, song.id, lyrics, parsed.timed);
      res.json({ songId: song.id, lineCount: parsed.lines.length, timed: parsed.timed });
    }),
  );

  /**
   * Lyrics for a song: saved (signed-in user) → automatic discovery →
   * friendly null with a reason + hint. Public so the paste-and-play flow
   * never requires signing in; `req.userId` is used only when present.
   */
  router.get(
    '/lyrics',
    lyricsLimiter,
    wrap(async (req, res) => {
      const userId = req.userId;
      const url = String(req.query.url ?? '');
      const detection = parsePlayerUrl(url);
      if (!detection.valid || !detection.normalizedUrl) {
        res.status(400).json({ error: detection.reason ?? 'Invalid song link.' });
        return;
      }

      // Optional duration hint (seconds) from the player — improves provider
      // matching. Ignored when absent or out of range.
      const rawDuration = Number(req.query.duration);
      const durationSec =
        Number.isFinite(rawDuration) && rawDuration >= 1 && rawDuration <= 3600
          ? Math.round(rawDuration)
          : null;

      let song = ctx.songs.byUrl(detection.normalizedUrl);
      if (!song) {
        // First request for this link — create the row so discovery has a
        // stable song id to cache against.
        song = ctx.songs.upsert(detection);
      }

      // Saved lyrics always win — they are the user's own curated copy.
      if (userId !== undefined) {
        const saved = ctx.songs.lyrics(userId, song.id);
        if (saved) {
          res.json({
            lyrics: {
              content: saved.content,
              timed: saved.is_timestamped === 1,
              updatedAt: saved.updated_at,
            },
            source: 'saved',
            provider: null,
            reason: null,
            hint: null,
            song: songDto(song),
          });
          return;
        }
      }

      // Discovery needs a real title to search with — resolve metadata once
      // (oEmbed, same official endpoints as /metadata) before searching.
      if (!song.title.trim() && ctx.lyrics.enabled) {
        const fetched = await ctx.songs.fetchMetadata(detection);
        if (fetched.title || fetched.artworkUrl) {
          song = ctx.songs.upsert(detection, fetched);
        }
      }

      const result = await ctx.lyrics.discover(song, durationSec);
      if (result.lyrics) {
        res.json({
          lyrics: {
            content: result.lyrics.content,
            timed: result.lyrics.timed,
            updatedAt: result.lyrics.fetchedAt,
          },
          source: 'discovered',
          provider: result.lyrics.provider,
          reason: null,
          hint: null,
          match: {
            title: result.lyrics.matchedTitle,
            artist: result.lyrics.matchedArtist,
            score: result.lyrics.matchScore,
          },
          song: songDto(song),
        });
        return;
      }

      res.json({
        lyrics: null,
        source: null,
        provider: null,
        reason: result.reason,
        hint: ctx.lyrics.enabled
          ? LyricsService.hintFor(result.reason)
          : 'Automatic lyrics are disabled on this server — add lyrics manually.',
        song: songDto(song),
      });
    }),
  );

  return router;
}
