/**
 * Lyrics match scoring — decides whether a lyrics record found by a provider
 * actually belongs to the song the user pasted.
 *
 * Pure and dependency-free so server (discovery), client (status display) and
 * tests share one definition of "same song". The golden rule: when in doubt,
 * return no lyrics rather than someone else's.
 */

export interface MatchQuery {
  /** Song title as identified from the provider (may still contain noise). */
  title: string;
  /** Channel/artist hint — may be empty (e.g. Spotify oEmbed gives none). */
  artist?: string | null;
  /** Media duration in seconds when the player reports one. */
  durationSec?: number | null;
}

export interface MatchCandidate {
  trackName: string;
  artistName?: string | null;
  duration?: number | null;
  /** True when the provider offers timestamped (LRC) lyrics. */
  synced?: boolean;
}

/** Tunable gates — all tests go through these, never through magic numbers. */
export const MATCH_THRESHOLDS = {
  /** Minimum title similarity when both sides name an artist. */
  titleMin: 0.6,
  /** Minimum title similarity when no artist can be compared. */
  titleNoArtistMin: 0.72,
  /** Minimum artist similarity (only enforced when both sides have one). */
  artistMin: 0.35,
  /** Title similarity that overrides a weak artist match. */
  titleStrong: 0.8,
  /**
   * Duration gap (seconds) beyond which the recording is considered different.
   * Music videos legitimately differ from album cuts by up to a minute; beyond
   * that it is almost certainly a different track (live, remix, cover…).
   */
  maxDurationGapSec: 60,
} as const;

/**
 * Words that appear in provider titles but not in lyrics catalogues.
 * Applied to BOTH sides of every comparison, so stripping can only help
 * alignment — it can never create a false match on its own.
 */
const NOISE_RE =
  /\bofficial\b|\bofficial video\b|\bofficial audio\b|\blyric video\b|\blyrics video\b|\bmusic video\b|\bvisuali[sz]er\b|\bhd\b|\b4k\b|\b8k\b|\bremaster(ed)?\b|\bm\/v\b|\bexplicit\b|\bclean\b|\baudio\b|\bfull album\b|\bvideo\b|\blyrics\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/gi;

/** Bracketed fragments — "(Official Video)", "[4K]", "(Live at …)" etc. */
const BRACKETS_RE = /[([][^)\]]*[)\]]/g;

function collapse(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics: “Beyoncé” ≈ “Beyonce”
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/['’`´]/g, '') // keep “don't” ≈ “dont”
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a title/artist string for comparison: drop bracketed noise,
 * drop quality/boilerplate words, then casefold and de-punctuate.
 */
export function normalizeForMatch(text: string): string {
  const stripped = text.replace(BRACKETS_RE, ' ').replace(NOISE_RE, ' ');
  return collapse(stripped);
}

/** Bigram Dice coefficient on normalized strings (0..1). */
export function diceSimilarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const gram = s.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const ga = bigrams(na);
  const gb = bigrams(nb);
  let shared = 0;
  for (const [gram, count] of ga) {
    const other = gb.get(gram);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (na.length - 1 + (nb.length - 1));
}

/**
 * Split a provider title into track + artist using the channel/author hint.
 *
 * YouTube titles are typically "Artist - Track (Official Video)" with the
 * channel as artist; Spotify titles are bare track names with no artist.
 * The channel is the most reliable artist signal, so it wins whenever the
 * title's first or last dash segment agrees with it.
 */
export function splitTitleArtist(
  rawTitle: string,
  channel?: string | null,
): { title: string; artist: string } {
  const title = (rawTitle ?? '').trim();
  const artistHint = (channel ?? '').trim();
  if (!artistHint) {
    // No channel — still peel a leading "Artist - " so search gets a bare track.
    const parts = title.split(/\s+[-–—]\s+/);
    if (parts.length >= 2 && parts[0].length > 0 && parts[0].length <= 60) {
      return { title: parts.slice(1).join(' - '), artist: parts[0] };
    }
    return { title, artist: '' };
  }

  const parts = title.split(/\s+[-–—]\s+/).filter(Boolean);
  if (parts.length < 2) return { title, artist: artistHint };

  const first = parts[0];
  const last = parts[parts.length - 1];
  if (diceSimilarity(first, artistHint) >= 0.5) {
    // "Rick Astley - Never Gonna Give You Up"
    return { title: parts.slice(1).join(' - '), artist: artistHint };
  }
  if (diceSimilarity(last, artistHint) >= 0.5) {
    // "Never Gonna Give You Up - Rick Astley"
    return { title: parts.slice(0, -1).join(' - '), artist: artistHint };
  }
  // The channel matches neither dash segment — it is an aggregator or
  // lyrics channel (e.g. "7clouds" on "Imagine Dragons - Believer (Lyrics)"),
  // not the artist. The title's leading segment is then the best artist
  // signal: YouTube's dominant layout is "Artist - Track", which is exactly
  // the layout the title peel above already assumes. Trusting a channel that
  // disagrees with the whole title poisons both the provider search
  // (artist_name=7clouds finds nothing) and the artist verification gate.
  return { title: parts.slice(1).join(' - '), artist: parts[0] };
}

export interface MatchScore {
  titleSim: number;
  /** null when either side lacks an artist to compare. */
  artistSim: number | null;
  /** |duration gap| in seconds, or null when unknown. */
  durationGapSec: number | null;
  /** Single ranking score (higher = better). */
  score: number;
  /** Final verdict — only `acceptable` candidates may be shown to a user. */
  acceptable: boolean;
}

/**
 * Titles are compared post-normalization, but providers keep the artist
 * prefix on some entries ("Imagine Dragons - Believer") while our query
 * title has it peeled ("Believer") — a straight comparison then scores
 * ~0.47 and rejects the right song. Compare against the candidate's bare
 * title as well, but only when the peeled prefix is confirmed to be an
 * artist: it must agree with the query's artist or with the candidate's own
 * artist field. An unconfirmed prefix is never stripped, so another artist's
 * same-named track cannot sneak past verification on title alone.
 */
function bestTitleSimilarity(query: MatchQuery, candidate: MatchCandidate): number {
  const direct = diceSimilarity(query.title, candidate.trackName);
  const dashAt = candidate.trackName.search(/[-–—]/);
  if (dashAt <= 0) return direct;
  const prefix = candidate.trackName.slice(0, dashAt).trim();
  const rest = candidate.trackName.slice(dashAt + 1).trim();
  if (!prefix || !rest) return direct;

  const prefixNorm = normalizeForMatch(prefix);
  const queryArtist = normalizeForMatch(query.artist ?? '');
  const candidateArtist = normalizeForMatch(candidate.artistName ?? '');
  const confirmed =
    (queryArtist !== '' && diceSimilarity(prefixNorm, queryArtist) >= MATCH_THRESHOLDS.artistMin) ||
    (candidateArtist !== '' && diceSimilarity(prefixNorm, candidateArtist) >= MATCH_THRESHOLDS.artistMin);
  if (!confirmed) return direct;
  return Math.max(direct, diceSimilarity(query.title, rest));
}

/**
 * Score one candidate against the identified song.
 *
 * Rules (see MATCH_THRESHOLDS):
 *  - a title match is always required;
 *  - when both sides name an artist, their similarity must clear `artistMin`
 *    unless the title match is `titleStrong`;
 *  - duration, when known on both sides, must not gap by more than a minute.
 */
export function scoreLyricsMatch(query: MatchQuery, candidate: MatchCandidate): MatchScore {
  const titleSim = bestTitleSimilarity(query, candidate);
  const queryArtist = normalizeForMatch(query.artist ?? '');
  const candidateArtist = normalizeForMatch(candidate.artistName ?? '');
  const artistSim =
    queryArtist && candidateArtist ? diceSimilarity(queryArtist, candidateArtist) : null;

  const durA = query.durationSec ?? null;
  const durB = candidate.duration ?? null;
  const durationGapSec =
    durA !== null && durB !== null && durA > 0 && durB > 0
      ? Math.abs(Math.round(durA) - Math.round(durB))
      : null;

  const titleOk =
    artistSim !== null
      ? titleSim >= MATCH_THRESHOLDS.titleMin ||
        (titleSim >= MATCH_THRESHOLDS.titleNoArtistMin && artistSim >= MATCH_THRESHOLDS.artistMin)
      : titleSim >= MATCH_THRESHOLDS.titleNoArtistMin;
  const artistOk =
    artistSim === null || artistSim >= MATCH_THRESHOLDS.artistMin || titleSim >= MATCH_THRESHOLDS.titleStrong;
  const durationOk = durationGapSec === null || durationGapSec <= MATCH_THRESHOLDS.maxDurationGapSec;

  // Ranking: title dominates, artist corroborates, duration breaks ties.
  const score =
    titleSim * 0.65 +
    (artistSim ?? 0.35) * 0.25 +
    (durationGapSec !== null && durationGapSec <= 2 ? 0.1 : durationGapSec !== null ? -0.05 : 0);

  return { titleSim, artistSim, durationGapSec, score, acceptable: titleOk && artistOk && durationOk };
}

/** Best acceptable candidate by score, or null when nothing is safe to show. */
export function pickBestLyricsMatch(
  query: MatchQuery,
  candidates: readonly MatchCandidate[],
): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const result = scoreLyricsMatch(query, candidate);
    if (!result.acceptable) continue;
    if (result.score > bestScore) {
      bestScore = result.score;
      best = candidate;
    }
  }
  return best;
}
