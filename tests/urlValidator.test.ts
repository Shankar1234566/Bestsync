import { describe, expect, it } from 'vitest';
import {
  isValidSongUrl,
  parsePlayerUrl,
  quantizeRateForProvider,
  spotifyEmbedUrl,
  youtubeEmbedUrl,
} from '../src/shared';

describe('parsePlayerUrl — YouTube', () => {
  it('accepts a standard watch URL and extracts the video id', () => {
    const result = parsePlayerUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('youtube');
    expect(result.mediaId).toBe('dQw4w9WgXcQ');
    expect(result.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.capabilities.playbackRate).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it('accepts scheme-less youtu.be links', () => {
    const result = parsePlayerUrl('youtu.be/dQw4w9WgXcQ');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('youtube');
    expect(result.mediaId).toBe('dQw4w9WgXcQ');
  });

  it('accepts shorts, embed and live URL shapes', () => {
    for (const url of [
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ]) {
      const result = parsePlayerUrl(url);
      expect(result.valid, url).toBe(true);
      expect(result.mediaId).toBe('dQw4w9WgXcQ');
    }
  });

  it('rejects playlists and channels with an explanation', () => {
    const playlist = parsePlayerUrl('https://www.youtube.com/playlist?list=PL1234567890');
    expect(playlist.valid).toBe(false);
    expect(playlist.reason).toMatch(/playlist/i);

    const channel = parsePlayerUrl('https://www.youtube.com/@somechannel');
    expect(channel.valid).toBe(false);
    expect(channel.reason).toMatch(/channel/i);
  });

  it('rejects links without a valid 11-character video id', () => {
    const result = parsePlayerUrl('https://www.youtube.com/watch?v=short');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/video id/i);
  });
});

describe('parsePlayerUrl — Spotify', () => {
  const trackId = '4cOdK2wGLETKBW3PvgPWqT';

  it('accepts a track link and disables seek/volume/tempo', () => {
    const result = parsePlayerUrl(`https://open.spotify.com/track/${trackId}`);
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('spotify');
    expect(result.mediaId).toBe(trackId);
    expect(result.normalizedUrl).toBe(`https://open.spotify.com/track/${trackId}`);
    expect(result.capabilities.playbackRate).toBe(false);
    expect(result.capabilities.seek).toBe(false);
    expect(result.capabilities.volume).toBe(false);
    expect(result.limitations.join(' ')).toMatch(/tempo/i);
  });

  it('handles intl-prefixed paths', () => {
    const result = parsePlayerUrl(`https://open.spotify.com/intl-de/track/${trackId}`);
    expect(result.valid).toBe(true);
    expect(result.normalizedUrl).toBe(`https://open.spotify.com/track/${trackId}`);
  });

  it('flags playlists as multi-song with an extra limitation', () => {
    const result = parsePlayerUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(result.valid).toBe(true);
    expect(result.spotifyKind).toBe('playlist');
    expect(result.limitations.some((l) => /several songs/i.test(l))).toBe(true);
  });

  it('rejects shortened links', () => {
    const result = parsePlayerUrl('https://spotify.link/abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/shortened/i);
  });

  it('rejects malformed ids', () => {
    const result = parsePlayerUrl('https://open.spotify.com/track/not-an-id');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/valid id/i);
  });
});

describe('parsePlayerUrl — direct audio and rejections', () => {
  it('accepts direct audio files with full capabilities', () => {
    const result = parsePlayerUrl('https://cdn.example.com/music/song.mp3');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('direct-audio');
    expect(result.capabilities.playbackRate).toBe(true);
    expect(result.capabilities.seek).toBe(true);
  });

  it('accepts common audio extensions', () => {
    for (const ext of ['wav', 'ogg', 'm4a', 'flac', 'opus', 'aac']) {
      expect(isValidSongUrl(`https://x.example/track.${ext}`), ext).toBe(true);
    }
  });

  it('rejects unsupported pages, garbage and empty input', () => {
    expect(parsePlayerUrl('https://example.com/page').valid).toBe(false);
    expect(parsePlayerUrl('not a url at all').valid).toBe(false);
    expect(parsePlayerUrl('').valid).toBe(false);
    expect(parsePlayerUrl('').reason).toMatch(/paste a song link/i);
    expect(parsePlayerUrl('   ').valid).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(parsePlayerUrl('ftp://files.example/song.mp3').valid).toBe(false);
    expect(parsePlayerUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('rejects absurdly long inputs', () => {
    expect(parsePlayerUrl(`https://example.com/${'a'.repeat(2100)}`).valid).toBe(false);
  });
});

describe('quantizeRateForProvider', () => {
  it('leaves direct-audio rates untouched', () => {
    expect(quantizeRateForProvider(1.1, 'direct-audio')).toEqual({ rate: 1.1, snapped: false });
  });

  it('snaps YouTube rates to the nearest supported step', () => {
    expect(quantizeRateForProvider(1.1, 'youtube')).toEqual({ rate: 1, snapped: true });
    expect(quantizeRateForProvider(1.2, 'youtube')).toEqual({ rate: 1.25, snapped: true });
    expect(quantizeRateForProvider(1, 'youtube')).toEqual({ rate: 1, snapped: false });
    expect(quantizeRateForProvider(1.9, 'youtube')).toEqual({ rate: 2, snapped: true });
  });

  it('forces Spotify to 1x and reports the snap', () => {
    expect(quantizeRateForProvider(1.25, 'spotify')).toEqual({ rate: 1, snapped: true });
    expect(quantizeRateForProvider(1, 'spotify')).toEqual({ rate: 1, snapped: false });
  });
});

describe('embed URL builders', () => {
  it('builds a YouTube embed with API enabled', () => {
    const url = youtubeEmbedUrl('dQw4w9WgXcQ');
    expect(url).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(url).toContain('enablejsapi=1');
  });

  it('builds a Spotify embed from the normalized link', () => {
    const url = spotifyEmbedUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    expect(url).toBe('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT/embed?utm_source=generator&theme=0');
  });
});
