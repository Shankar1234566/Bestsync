/**
 * BeatSync shared constants — game modes, limits and provider metadata.
 * Used by both client and server so both sides always agree on the rules.
 */

export const GAME_MODES = ['practice', 'beat', 'challenge', 'free', 'battle'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  practice: 'Practice Mode',
  beat: 'Beat Mode',
  challenge: 'Challenge Mode',
  free: 'Free Typing Mode',
  battle: 'Multiplayer Battle Mode',
};

/** Multiplier applied to the base score for each mode. */
export const MODE_SCORE_MULTIPLIER: Record<GameMode, number> = {
  practice: 1.0,
  free: 0.8,
  beat: 1.25,
  challenge: 1.5,
  battle: 1.5,
};

/** Human-plausibility caps used by server-side score validation. */
export const SCORE_LIMITS = {
  /** Hard WPM ceiling — anything above is rejected as impossible. */
  maxWpm: 350,
  /** Soft ceiling used for the derived-CMP check. */
  maxCpm: 2100,
  /** Minimum session duration accepted by the API (ms). */
  minSessionMs: 5000,
  /** Maximum session duration accepted by the API (ms) — 3 hours. */
  maxSessionMs: 3 * 60 * 60 * 1000,
  /** Tolerance between submitted WPM and WPM recomputed from chars/duration. */
  wpmTolerance: 0.2,
  /** Tolerance between submitted accuracy and accuracy recomputed from counters. */
  accuracyTolerancePoints: 1.5,
  /** Tolerance between submitted score and score recomputed by the server. */
  scoreTolerance: 0.25,
} as const;

export const API_BASE = '/api';

/** Default song shown on first launch (a royalty-free/demo track URL). */
export const DEFAULT_SONG_URL = 'https://www.youtube.com/watch?v=5qap5aO4i9A';

export const LYRICS_UNAVAILABLE_MESSAGE =
  'Lyrics unavailable. Add your own lyrics to start typing practice.';
