/**
 * Lyrics match scoring — normalization, artist/title splitting, candidate
 * verification and best-pick selection.
 *
 * The golden rule under test: when in doubt, return no lyrics rather than
 * someone else's. Every rejection path is locked here so a future tweak to
 * a threshold cannot quietly start showing the wrong song.
 */
import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLDS,
  diceSimilarity,
  normalizeForMatch,
  pickBestLyricsMatch,
  scoreLyricsMatch,
  splitTitleArtist,
} from '../src/shared';

describe('normalizeForMatch', () => {
  it('strips bracketed fragments and provider noise words', () => {
    expect(normalizeForMatch('Never Gonna Give You Up (Official Video) (4K Remaster)')).toBe(
      'never gonna give you up',
    );
    expect(normalizeForMatch('Believer (Lyrics)')).toBe('believer');
    expect(normalizeForMatch('PSY - GANGNAM STYLE(강남스타일) M/V')).toBe('psy gangnam style');
    expect(normalizeForMatch('Song (feat. Someone)')).toBe('song');
  });

  it('casefolds, drops punctuation and strips diacritics', () => {
    expect(normalizeForMatch('Beyoncé — Déjà Vu!')).toBe('beyonce deja vu');
    expect(normalizeForMatch("Don't Stop Me Now")).toBe('dont stop me now');
  });
});

describe('diceSimilarity', () => {
  it('scores identical normalized strings as 1', () => {
    expect(diceSimilarity('Believer (Lyrics)', 'believer')).toBe(1);
  });

  it('scores disjoint strings as 0', () => {
    expect(diceSimilarity('hello', 'world')).toBe(0);
  });

  it('scores a bare title against an artist-prefixed title below titleMin', () => {
    // The exact shape that used to reject the right song: query title has
    // the artist peeled, the candidate keeps it.
    expect(diceSimilarity('Believer', 'Imagine Dragons - Believer')).toBeCloseTo(0.4667, 3);
    expect(diceSimilarity('Believer', 'Imagine Dragons - Believer')).toBeLessThan(
      MATCH_THRESHOLDS.titleMin,
    );
  });
});

describe('splitTitleArtist', () => {
  it('keeps the channel as artist when it agrees with the leading segment', () => {
    expect(
      splitTitleArtist('Rick Astley - Never Gonna Give You Up (Official Video)', 'Rick Astley'),
    ).toEqual({
      title: 'Never Gonna Give You Up (Official Video)',
      artist: 'Rick Astley',
    });
  });

  it('peels a trailing artist segment when it agrees with the channel', () => {
    expect(splitTitleArtist('Never Gonna Give You Up - Rick Astley', 'Rick Astley')).toEqual({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
    });
  });

  it('falls back to the title artist when the channel is an aggregator', () => {
    // Regression: "7clouds" is a lyrics channel, not the artist. Trusting it
    // poisoned both the provider search (artist_name=7clouds → nothing) and
    // the artist verification gate, so a real song reported "not found".
    expect(splitTitleArtist('Imagine Dragons - Believer (Lyrics)', '7clouds')).toEqual({
      title: 'Believer (Lyrics)',
      artist: 'Imagine Dragons',
    });
  });

  it('keeps the channel when the title has no artist segment', () => {
    expect(splitTitleArtist('Believer', '7clouds')).toEqual({
      title: 'Believer',
      artist: '7clouds',
    });
  });

  it('still peels a leading artist when no channel hint exists', () => {
    expect(splitTitleArtist('Rick Astley - Never Gonna Give You Up', '')).toEqual({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
    });
  });
});

describe('scoreLyricsMatch', () => {
  const believerQuery = {
    title: 'Believer',
    artist: 'Imagine Dragons',
    durationSec: 214,
  };

  it('accepts an exact title + artist + duration match with a perfect score', () => {
    const result = scoreLyricsMatch(
      { title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationSec: 213 },
      {
        trackName: 'Never Gonna Give You Up',
        artistName: 'Rick Astley',
        duration: 213,
        synced: true,
      },
    );
    expect(result.acceptable).toBe(true);
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.durationGapSec).toBe(0);
  });

  it('rejects a candidate whose title is a different song', () => {
    const result = scoreLyricsMatch(believerQuery, {
      trackName: 'Rolling in the Deep',
      artistName: 'Adele',
      duration: 214,
    });
    expect(result.acceptable).toBe(false);
  });

  it('rejects when the artist disagrees and the title is not strong enough', () => {
    const result = scoreLyricsMatch(
      { title: 'Believer Live', artist: 'Imagine Dragons', durationSec: 214 },
      { trackName: 'Believer', artistName: 'Some Cover Band', duration: 214 },
    );
    expect(result.titleSim).toBeGreaterThanOrEqual(MATCH_THRESHOLDS.titleMin);
    expect(result.acceptable).toBe(false);
  });

  it('rejects a duration gap beyond the music-video tolerance', () => {
    const result = scoreLyricsMatch(believerQuery, {
      trackName: 'Believer',
      artistName: 'Imagine Dragons',
      duration: 300, // 86s off — a different recording
    });
    expect(result.durationGapSec).toBe(86);
    expect(result.acceptable).toBe(false);
  });

  it('accepts a small duration gap (the real Believer shape: 214s vs 204s)', () => {
    const result = scoreLyricsMatch(believerQuery, {
      trackName: 'Believer',
      artistName: 'Imagine Dragons',
      duration: 204,
    });
    expect(result.durationGapSec).toBe(10);
    expect(result.acceptable).toBe(true);
  });

  it('lets a perfect title override a weak artist (titleStrong)', () => {
    const result = scoreLyricsMatch(believerQuery, {
      trackName: 'Believer',
      artistName: '7clouds',
      duration: 204,
    });
    expect(result.artistSim).toBe(0);
    expect(result.acceptable).toBe(true);
  });

  it('accepts a prefixed candidate once the prefix is confirmed as the artist', () => {
    // Query title is peeled ("Believer (Lyrics)"), candidate keeps the artist
    // prefix ("Imagine Dragons - …") — the strip must kick in here.
    const result = scoreLyricsMatch(
      { title: 'Believer (Lyrics)', artist: 'Imagine Dragons', durationSec: 214 },
      {
        trackName: 'Imagine Dragons - Believer (Lyrics)',
        artistName: 'Imagine Dragons',
        duration: 204,
        synced: true,
      },
    );
    expect(result.titleSim).toBe(1);
    expect(result.acceptable).toBe(true);
  });

  it('never strips an unconfirmed prefix (another artist keeps its own title)', () => {
    // "Mystery Act" matches neither our artist nor the candidate's own
    // artist field — stripping it would turn a near-miss into a false match.
    const result = scoreLyricsMatch(believerQuery, {
      trackName: 'Mystery Act - Believer',
      artistName: 'Other Person',
      duration: 204,
    });
    expect(result.titleSim).toBeLessThan(MATCH_THRESHOLDS.titleMin);
    expect(result.acceptable).toBe(false);
  });
});

describe('pickBestLyricsMatch', () => {
  const query = { title: 'Believer', artist: 'Imagine Dragons', durationSec: 214 };

  it('returns the best acceptable candidate', () => {
    const best = pickBestLyricsMatch(query, [
      { trackName: 'Believer', artistName: 'No Resolve', duration: 206 },
      { trackName: 'Believer', artistName: 'Imagine Dragons', duration: 204, synced: true },
      { trackName: 'Thunder', artistName: 'Imagine Dragons', duration: 214 },
    ]);
    expect(best).not.toBeNull();
    expect(best?.artistName).toBe('Imagine Dragons');
  });

  it('returns null when every candidate is a different song', () => {
    expect(
      pickBestLyricsMatch(query, [
        { trackName: 'Rolling in the Deep', artistName: 'Adele', duration: 214 },
        { trackName: 'Hello', artistName: 'Adele', duration: 215 },
      ]),
    ).toBeNull();
  });

  it('returns null when the only match is too far off in duration', () => {
    expect(
      pickBestLyricsMatch(query, [
        { trackName: 'Believer', artistName: 'Marla Glen', duration: 306 },
      ]),
    ).toBeNull();
  });
});
