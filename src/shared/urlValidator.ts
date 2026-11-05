/**
 * Music URL validation and provider detection.
 *
 * Pure, dependency-free module shared by client (load button, player factory)
 * and server (song records, score validation). Never downloads or extracts
 * protected audio — it only classifies links and builds embed URLs.
 */
import type { MusicProvider, PlayerCapabilities, ProviderDetection } from './types';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'www.open.spotify.com', 'play.spotify.com']);

const SPOTIFY_SHORT_HOSTS = new Set(['spotify.link', 'spoti.fi', 'www.spotify.link']);

const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);

/** Browser-playable direct audio formats. */
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

const FULL_CAPABILITIES: PlayerCapabilities = {
  playPause: true,
  seek: true,
  volume: true,
  playbackRate: true,
  currentTime: true,
  duration: true,
  metadata: true,
};

const YOUTUBE_CAPABILITIES: PlayerCapabilities = {
  playPause: true,
  seek: true,
  volume: true,
  playbackRate: true,
  currentTime: true,
  duration: true,
  metadata: true,
};

const SPOTIFY_CAPABILITIES: PlayerCapabilities = {
  playPause: true,
  seek: false,
  volume: false,
  playbackRate: false,
  currentTime: true,
  duration: true,
  metadata: true,
};

function invalid(reason: string, provider: MusicProvider = 'direct-audio'): ProviderDetection {
  return {
    provider,
    valid: false,
    normalizedUrl: null,
    mediaId: null,
    reason,
    capabilities: { ...FULL_CAPABILITIES, playbackRate: false },
    limitations: [],
  };
}

function parseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  // Accept "youtu.be/xyz" style input without scheme.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function pathExtension(pathname: string): string {
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
}

function detectYouTube(url: URL): ProviderDetection | null {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const pathname = url.pathname;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = pathname.split('/').filter(Boolean)[0] ?? '';
    if (!YT_VIDEO_ID.test(id)) {
      return invalid('That YouTube short link does not contain a valid video id.', 'youtube');
    }
    return youtubeResult(id);
  }

  if (pathname === '/watch') {
    if (url.searchParams.has('list')) {
      const id = url.searchParams.get('v');
      // A playlist with a specific video still points at one playable video.
      if (id && YT_VIDEO_ID.test(id)) return youtubeResult(id);
      return invalid('YouTube playlists are not supported — paste a single video link.', 'youtube');
    }
    const id = url.searchParams.get('v');
    if (!id || !YT_VIDEO_ID.test(id)) {
      return invalid('That YouTube link does not contain a valid video id.', 'youtube');
    }
    return youtubeResult(id);
  }

  const nested = pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (nested) return youtubeResult(nested[1]);

  if (pathname === '/playlist') {
    return invalid('YouTube playlists are not supported — paste a single video link.', 'youtube');
  }
  if (pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/user/')) {
    return invalid('That is a YouTube channel link — paste a single video link.', 'youtube');
  }
  return invalid('Unsupported YouTube link format.', 'youtube');
}

function youtubeResult(videoId: string): ProviderDetection {
  return {
    provider: 'youtube',
    valid: true,
    normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
    mediaId: videoId,
    capabilities: YOUTUBE_CAPABILITIES,
    limitations: [
      'YouTube playback speed only supports discrete steps (0.25x–2x); custom speeds snap to the nearest step.',
      'Track title comes from YouTube; artist and artwork may be unavailable.',
    ],
  };
}

function detectSpotify(url: URL): ProviderDetection | null {
  const host = url.hostname.toLowerCase();
  if (SPOTIFY_SHORT_HOSTS.has(host)) {
    return invalid(
      'That is a shortened Spotify link. Open it in Spotify. or the web player and copy the full link.',
      'spotify',
    );
  }
  if (!SPOTIFY_HOSTS.has(host)) return null;

  // /intl-de/track/<id> or /track/<id>
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('intl-')) parts.shift();
  const [kind, id] = parts;

  if (!kind || !id) return invalid('Unsupported Spotify link format.', 'spotify');
  if (!SPOTIFY_KINDS.has(kind)) {
    return invalid(`Unsupported Spotify link type "${kind}".`, 'spotify');
  }
  if (!SPOTIFY_ID.test(id)) {
    return invalid('That Spotify link does not contain a valid id.', 'spotify');
  }

  const limitations = [
    'Spotify embeds do not allow playback-speed (tempo) changes — tempo controls are disabled for Spotify.',
    'Spotify embeds do not allow seeking or volume control from the page.',
  ];
  if (kind !== 'track') {
    limitations.push(
      `${kind[0].toUpperCase()}${kind.slice(1)}s contain several songs — lyrics sync to the first track unless you paste its own link.`,
    );
  }

  return {
    provider: 'spotify',
    valid: true,
    normalizedUrl: `https://open.spotify.com/${kind}/${id}`,
    mediaId: id,
    spotifyKind: kind as ProviderDetection['spotifyKind'],
    capabilities: SPOTIFY_CAPABILITIES,
    limitations,
  };
}

function detectDirectAudio(url: URL): ProviderDetection | null {
  const ext = pathExtension(url.pathname);
  if (!AUDIO_EXTENSIONS.has(ext)) return null;
  return {
    provider: 'direct-audio',
    valid: true,
    normalizedUrl: url.toString(),
    mediaId: null,
    capabilities: { ...FULL_CAPABILITIES },
    limitations: [
      'Pitch-preserving speed control depends on browser support (Chrome, Firefox and Safari support preservesPitch).',
    ],
  };
}

/**
 * Classify a pasted link. Never throws — always returns a detection result
 * explaining why a link was rejected when it is invalid.
 */
export function parsePlayerUrl(raw: string): ProviderDetection {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return invalid('Paste a song link first.');
  }
  if (raw.trim().length > 2048) {
    return invalid('That link is too long to be a song URL.');
  }
  const url = parseHttpUrl(raw);
  if (!url) {
    return invalid('That does not look like a valid http(s) link.');
  }

  return (
    detectYouTube(url) ??
    detectSpotify(url) ??
    detectDirectAudio(url) ??
    invalid(
      'Unsupported link. Paste a YouTube, Spotify or direct audio file link (mp3, wav, ogg, m4a, flac, opus).',
    )
  );
}

/** True when the pasted value is a playable song link. */
export function isValidSongUrl(raw: string): boolean {
  return parsePlayerUrl(raw).valid;
}

/** Build the YouTube IFrame embed URL for a video id. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1`;
}

/** Build the Spotify embed URL for a normalized Spotify link. */
export function spotifyEmbedUrl(normalizedUrl: string): string {
  const sep = normalizedUrl.includes('?') ? '&' : '?';
  return `${normalizedUrl}/embed${sep}utm_source=generator&theme=0`;
}

/**
 * Playback-rate values a provider actually supports. Used to quantize tempo
 * requests so lyric sync never depends on an unsupported speed.
 */
export const YOUTUBE_RATE_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function quantizeRateForProvider(
  rate: number,
  provider: MusicProvider,
): { rate: number; snapped: boolean } {
  if (provider === 'direct-audio') return { rate, snapped: false };
  if (provider === 'youtube') {
    let best: number = YOUTUBE_RATE_STEPS[0];
    let bestDelta = Math.abs(rate - best);
    for (const step of YOUTUBE_RATE_STEPS) {
      const delta = Math.abs(rate - step);
      if (delta < bestDelta) {
        best = step;
        bestDelta = delta;
      }
    }
    return { rate: best, snapped: Math.abs(best - rate) > 1e-9 };
  }
  // Spotify embeds cannot change speed at all.
  return { rate: 1, snapped: Math.abs(rate - 1) > 1e-9 };
}
