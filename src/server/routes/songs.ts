/**
 * Song routes: metadata resolution, history, favourites and user lyrics.
 */
import { Router } from 'express';
import type { AppContext } from '../context';
import { wrap, isRecord, requireString } from '../http/helpers';
import { authedUserId, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { parseLyricsInput, parsePlayerUrl } from '../../shared';

const MAX_LYRICS_CHARS = 20_000;

export function songRoutes(ctx: AppContext): Router {
  const router = Router();

  const metadataLimiter = rateLimit({
    bucket: 'metadata',
    windowMs: 60_000,
    max: 30,
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

  router.get(
    '/lyrics',
    requireAuth,
    wrap((req, res) => {
      const userId = authedUserId(req);
      const url = String(req.query.url ?? '');
      const detection = parsePlayerUrl(url);
      if (!detection.valid || !detection.normalizedUrl) {
        res.status(400).json({ error: detection.reason ?? 'Invalid song link.' });
        return;
      }
      const song = ctx.songs.byUrl(detection.normalizedUrl);
      if (!song) {
        res.json({ lyrics: null });
        return;
      }
      const saved = ctx.songs.lyrics(userId, song.id);
      res.json({
        lyrics: saved
          ? { content: saved.content, timed: saved.is_timestamped === 1, updatedAt: saved.updated_at }
          : null,
      });
    }),
  );

  return router;
}
