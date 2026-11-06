/**
 * Music engine — provider adapters behind one interface.
 *
 * - HtmlAudioAdapter : direct mp3/wav/ogg/m4a/flac/opus URLs (+ uploads)
 * - YouTubeAdapter   : official YouTube IFrame Player API
 * - SpotifyAdapter   : official Spotify embed (IFrame API) — no tempo/seek
 *
 * Rules honoured here: no downloading, no scraping, no provider bypass.
 * Capabilities always reflect what the provider actually allows so the UI
 * can disable controls honestly instead of pretending.
 */
import {
  spotifyEmbedUrl,
  youtubeEmbedUrl,
  type MusicProvider,
  type PlayerCapabilities,
  type ProviderDetection,
} from '../../shared';

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export interface PlayerMeta {
  title: string;
  artist: string;
  artwork: string;
}

export type AdapterEvent = 'time' | 'status' | 'meta' | 'ended' | 'error';

export interface TimePayload {
  currentTime: number;
  duration: number;
}

type Listener = (payload?: unknown) => void;

/** Every adapter implements this contract; usePlayer drives any of them. */
export interface MusicPlayerAdapter {
  readonly provider: MusicProvider;
  load(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getStatus(): PlayerStatus;
  getCapabilities(): PlayerCapabilities;
  on(event: AdapterEvent, listener: Listener): () => void;
}

abstract class BaseAdapter implements MusicPlayerAdapter {
  abstract readonly provider: MusicProvider;
  protected readonly listeners = new Map<AdapterEvent, Set<Listener>>();
  protected status: PlayerStatus = 'idle';
  protected meta: PlayerMeta = { title: '', artist: '', artwork: '' };
  protected error: string | null = null;

  on(event: AdapterEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  protected emit(event: AdapterEvent, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (listenerError) {
        console.error('[beatsync] player listener failed:', listenerError);
      }
    }
  }

  protected setStatus(status: PlayerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  abstract load(): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): void;
  abstract seek(seconds: number): void;
  abstract setVolume(volume: number): void;
  abstract setRate(rate: number): void;
  abstract destroy(): void;
  abstract getCurrentTime(): number;
  abstract getDuration(): number;
  abstract getCapabilities(): PlayerCapabilities;

  getStatus(): PlayerStatus {
    return this.status;
  }
}

/* ======================================================================== */
/* Direct audio (HTMLAudioElement)                                          */
/* ======================================================================== */

export class HtmlAudioAdapter extends BaseAdapter {
  readonly provider: MusicProvider = 'direct-audio';
  private readonly element: HTMLAudioElement;
  private readonly cleanups: (() => void)[] = [];
  private timeTimer: number | null = null;

  constructor(private readonly sourceUrl: string, sourceTitle = '') {
    super();
    this.element = new Audio();
    this.element.preload = 'auto';
    this.element.preservesPitch = true;
    this.meta = { title: sourceTitle, artist: 'Direct audio', artwork: '' };

    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K,
      handler: (event: HTMLMediaElementEventMap[K]) => void,
    ) => {
      this.element.addEventListener(type, handler);
      this.cleanups.push(() => this.element.removeEventListener(type, handler));
    };

    on('loadedmetadata', () => {
      this.setStatus('ready');
      this.emitTime();
    });
    on('play', () => this.setStatus('playing'));
    on('pause', () => {
      if (this.status !== 'ended') this.setStatus('paused');
      this.emitTime();
    });
    on('ended', () => {
      this.setStatus('ended');
      this.emitTime();
      this.emit('ended');
    });
    on('waiting', () => this.setStatus('buffering'));
    on('playing', () => this.setStatus('playing'));
    on('error', () => {
      this.error = 'This audio file could not be played. Check that the URL points to a real audio file.';
      this.setStatus('error');
      this.emit('error', this.error);
    });
  }

  private emitTime(): void {
    this.emit('time', {
      currentTime: this.element.currentTime || 0,
      duration: Number.isFinite(this.element.duration) ? this.element.duration : 0,
    } satisfies TimePayload);
  }

  async load(): Promise<void> {
    this.setStatus('loading');
    this.element.src = this.sourceUrl;
    // Start the periodic tick so the UI clock stays smooth between
    // native timeupdate events (which fire only ~4x per second).
    this.timeTimer = window.setInterval(() => {
      if (!this.element.paused && !this.element.seeking) this.emitTime();
    }, 250);
    this.cleanups.push(() => {
      if (this.timeTimer !== null) window.clearInterval(this.timeTimer);
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.element.removeEventListener('loadedmetadata', onMeta);
        this.element.removeEventListener('error', onErr);
      };
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('Could not load audio from that URL.'));
      };
      this.element.addEventListener('loadedmetadata', onMeta, { once: true });
      this.element.addEventListener('error', onErr, { once: true });
      this.element.load();
    });
  }

  async play(): Promise<void> {
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  seek(seconds: number): void {
    if (Number.isFinite(seconds)) this.element.currentTime = Math.max(0, seconds);
    this.emitTime();
  }

  setVolume(volume: number): void {
    this.element.volume = Math.min(1, Math.max(0, volume));
  }

  setRate(rate: number): void {
    this.element.playbackRate = rate;
    this.element.preservesPitch = true; // pitch-preserving speed where supported
  }

  destroy(): void {
    if (this.timeTimer !== null) window.clearInterval(this.timeTimer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
  }

  getCurrentTime(): number {
    return this.element.currentTime || 0;
  }

  getDuration(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0;
  }

  getCapabilities(): PlayerCapabilities {
    return {
      playPause: true,
      seek: true,
      volume: true,
      playbackRate: true,
      currentTime: true,
      duration: true,
      metadata: true,
    };
  }
}

/* ======================================================================== */
/* YouTube (official IFrame Player API)                                     */
/* ======================================================================== */

interface YouTubePlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  getDuration(): number;
  getCurrentTime(): number;
  getVideoData(): { title?: string; author?: string };
  destroy(): void;
}

interface YouTubePlayerStateMap {
  ENDED: number;
  PLAYING: number;
  PAUSED: number;
  BUFFERING: number;
  CUED: number;
}

interface YouTubeCtor {
  new (container: HTMLElement, options: Record<string, unknown>): YouTubePlayerLike;
  /** Present on some builds only — the canonical home is `window.YT.PlayerState`. */
  PlayerState?: YouTubePlayerStateMap;
}

declare global {
  interface Window {
    YT?: { Player: YouTubeCtor; PlayerState?: YouTubePlayerStateMap };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Documented IFrame API state constants. Used only when the loaded API omits
 * `PlayerState` — a missing lookup here would otherwise throw inside
 * YouTube's callback and surface as an uncaught console error.
 */
const YT_FALLBACK_STATE: YouTubePlayerStateMap = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

let youtubeApiPromise: Promise<YouTubeCtor> | null = null;

function loadYouTubeApi(): Promise<YouTubeCtor> {
  if (window.YT?.Player) return Promise.resolve(window.YT.Player);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeCtor>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT.Player);
      else reject(new Error('YouTube player API failed to initialise.'));
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-yt-iframe-api]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.dataset.ytIframeApi = 'true';
      tag.async = true;
      tag.onerror = () => reject(new Error('Could not load the YouTube player script.'));
      document.head.appendChild(tag);
    }

    window.setTimeout(() => reject(new Error('YouTube player script timed out.')), 15_000);
  }).catch((error) => {
    youtubeApiPromise = null; // allow retry on next load
    throw error;
  });

  return youtubeApiPromise;
}

export class YouTubeAdapter extends BaseAdapter {
  readonly provider: MusicProvider = 'youtube';
  private player: YouTubePlayerLike | null = null;
  private timeTimer: number | null = null;
  private destroyed = false;

  constructor(
    private readonly videoId: string,
    private readonly container: HTMLElement,
  ) {
    super();
  }

  async load(): Promise<void> {
    this.setStatus('loading');
    const PlayerCtor = await loadYouTubeApi();
    if (this.destroyed) throw new Error('Player was destroyed while loading.');

    this.container.dataset.beatsyncPlayer = 'youtube';
    // The IFrame API *replaces* the element it is handed. Mount into a
    // disposable inner node so the React-managed surface (and its ref)
    // survives intact — otherwise the embed steals the ref's element and the
    // next load targets a detached node.
    const mountPoint = document.createElement('div');
    mountPoint.style.width = '100%';
    mountPoint.style.height = '100%';
    this.container.appendChild(mountPoint);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      try {
        this.player = new PlayerCtor(mountPoint, {
          videoId: this.videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (settled) return;
              settled = true;
              this.setStatus('ready');
              this.emit('meta', this.meta);
              this.startTick();
              resolve();
            },
            onStateChange: (event: { data: number }) => {
              const state = event.data;
              // The real API exposes PlayerState on the YT namespace; the
              // constructor copy is not guaranteed, so check both then fall back.
              const PlayerState = window.YT?.PlayerState ?? PlayerCtor.PlayerState ?? YT_FALLBACK_STATE;
              if (state === PlayerState.PLAYING) {
                this.setStatus('playing');
                this.emitTime();
              } else if (state === PlayerState.PAUSED) {
                this.setStatus('paused');
                this.emitTime();
              } else if (state === PlayerState.BUFFERING) {
                this.setStatus('buffering');
              } else if (state === PlayerState.ENDED) {
                this.setStatus('ended');
                this.emitTime();
                this.emit('ended');
              }
              const data = this.api()?.getVideoData();
              if (data?.title && data.title !== this.meta.title) {
                this.meta = {
                  title: data.title,
                  artist: data.author ?? this.meta.artist,
                  artwork: this.meta.artwork || `https://i.ytimg.com/vi/${this.videoId}/hqdefault.jpg`,
                };
                this.emit('meta', this.meta);
              }
            },
            onError: () => {
              if (settled) return;
              settled = true;
              reject(new Error('YouTube refused to play this video (it may be private or blocked).'));
            },
          },
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error('YouTube player failed to start.'));
        }
      }
      window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('YouTube player took too long to become ready.'));
        }
      }, 20_000);
    });
  }

  /**
   * The IFrame API hands back a placeholder instance whose methods are only
   * attached once `onReady` fires. Calling them earlier throws — and since
   * PlayerControls reads the clock during render, that would unmount the whole
   * React tree. Everything therefore goes through this guard until ready.
   */
  private api(): YouTubePlayerLike | null {
    const player = this.player;
    return player && typeof player.getDuration === 'function' ? player : null;
  }

  private startTick(): void {
    if (this.timeTimer !== null) return;
    this.timeTimer = window.setInterval(() => this.emitTime(), 250);
  }

  private emitTime(): void {
    const api = this.api();
    if (!api) return;
    this.emit('time', {
      currentTime: api.getCurrentTime() || 0,
      duration: api.getDuration() || 0,
    } satisfies TimePayload);
  }

  async play(): Promise<void> {
    const api = this.api();
    if (!api) throw new Error('Player is not ready yet.');
    api.playVideo();
    this.setStatus('playing');
  }

  pause(): void {
    const api = this.api();
    if (!api) return;
    api.pauseVideo();
    this.setStatus('paused');
    this.emitTime();
  }

  seek(seconds: number): void {
    const api = this.api();
    if (!api || !Number.isFinite(seconds)) return;
    api.seekTo(Math.max(0, seconds), true);
    this.emitTime();
  }

  setVolume(volume: number): void {
    this.api()?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }

  setRate(rate: number): void {
    // YouTube accepts discrete steps only — the factory quantizes beforehand.
    this.api()?.setPlaybackRate(rate);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timeTimer !== null) window.clearInterval(this.timeTimer);
    this.timeTimer = null;
    try {
      this.player?.destroy();
    } catch {
      // Player may already be torn down by the API.
    }
    this.player = null;
    this.container.innerHTML = '';
  }

  getCurrentTime(): number {
    return this.api()?.getCurrentTime() || 0;
  }

  getDuration(): number {
    return this.api()?.getDuration() || 0;
  }

  getCapabilities(): PlayerCapabilities {
    return {
      playPause: true,
      seek: true,
      volume: true,
      playbackRate: true,
      currentTime: true,
      duration: true,
      metadata: true,
    };
  }
}

/* ======================================================================== */
/* Spotify (official embed IFrame API)                                      */
/* ======================================================================== */

interface SpotifyController {
  addEventListener(event: string, handler: (event: { data?: Record<string, unknown> }) => void): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  destroy(): void;
}

interface SpotifyIFrameAPI {
  createController(
    container: HTMLElement,
    options: { uri: string },
    callback: (controller: SpotifyController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
  }
}

let spotifyApiPromise: Promise<SpotifyIFrameAPI> | null = null;

function loadSpotifyApi(): Promise<SpotifyIFrameAPI> {
  if (spotifyApiPromise) return spotifyApiPromise;
  spotifyApiPromise = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    const previous = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      previous?.(api);
      resolve(api);
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-spotify-embed-api]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://open.spotify.com/embed/iframe-api/v1';
      tag.dataset.spotifyEmbedApi = 'true';
      tag.async = true;
      tag.onerror = () =>
        reject(new Error('Could not load the Spotify embed player script.'));
      document.head.appendChild(tag);
    }
    window.setTimeout(() => reject(new Error('Spotify embed script timed out.')), 15_000);
  }).catch((error) => {
    spotifyApiPromise = null;
    throw error;
  });
  return spotifyApiPromise;
}

export class SpotifyAdapter extends BaseAdapter {
  readonly provider: MusicProvider = 'spotify';
  private controller: SpotifyController | null = null;
  private timeTimer: number | null = null;
  private current = 0;
  private duration = 0;
  private destroyed = false;

  constructor(
    private readonly normalizedUrl: string,
    private readonly container: HTMLElement,
  ) {
    super();
  }

  async load(): Promise<void> {
    this.setStatus('loading');
    this.container.dataset.beatsyncPlayer = 'spotify';
    // Same contract as the YouTube adapter: the embed API may replace the
    // element it is given, so it gets a disposable inner node.
    const mountPoint = document.createElement('div');
    mountPoint.style.width = '100%';
    mountPoint.style.height = '100%';
    this.container.appendChild(mountPoint);
    const api = await loadSpotifyApi();
    if (this.destroyed) throw new Error('Player was destroyed while loading.');

    await new Promise<void>((resolve, reject) => {
      api.createController(mountPoint, { uri: this.normalizedUrl }, (controller) => {
        if (this.destroyed) {
          controller.destroy();
          return;
        }
        this.controller = controller;

        controller.addEventListener('ready', () => {
          this.setStatus('ready');
          resolve();
        });
        controller.addEventListener('playback_update', (event) => {
          const data = event.data ?? {};
          if (typeof data.position === 'number') this.current = data.position;
          if (typeof data.duration === 'number') this.duration = data.duration;
          if (data.track && typeof data.track === 'object') {
            const track = data.track as { name?: string; artists?: { name?: string }[]; images?: { url?: string }[] };
            this.meta = {
              title: track.name ?? this.meta.title,
              artist: track.artists?.[0]?.name ?? this.meta.artist,
              artwork: track.images?.[0]?.url ?? this.meta.artwork,
            };
            this.emit('meta', this.meta);
          }
          const paused = data.is_paused ?? data.paused;
          if (paused === true) this.setStatus('paused');
          else if (paused === false) this.setStatus('playing');
          this.emit('time', {
            currentTime: this.current / 1000,
            duration: this.duration / 1000,
          } satisfies TimePayload);
        });
        controller.addEventListener('playback_error', () => {
          this.error = 'Spotify could not play this track (it may be unavailable in your region).';
          this.setStatus('error');
          this.emit('error', this.error);
        });

        this.timeTimer = window.setInterval(() => {
          this.emit('time', {
            currentTime: this.current / 1000,
            duration: this.duration / 1000,
          } satisfies TimePayload);
        }, 500);

        resolve();
      });

      window.setTimeout(() => {
        if (!this.controller && !this.destroyed) {
          reject(new Error('Spotify embed player took too long to become ready.'));
        }
      }, 20_000);
    });
  }

  async play(): Promise<void> {
    if (!this.controller) throw new Error('Player is not ready yet.');
    this.controller.play();
    this.setStatus('playing');
  }

  pause(): void {
    this.controller?.pause();
    this.setStatus('paused');
  }

  seek(seconds: number): void {
    // Spotify embeds expose no public seek — capabilities already report false.
    void seconds;
  }

  setVolume(volume: number): void {
    void volume; // Not supported by the Spotify embed API.
  }

  setRate(rate: number): void {
    void rate; // Tempo control is not permitted for Spotify embeds.
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timeTimer !== null) window.clearInterval(this.timeTimer);
    this.timeTimer = null;
    try {
      this.controller?.destroy();
    } catch {
      // Already gone.
    }
    this.controller = null;
    this.container.innerHTML = '';
  }

  getCurrentTime(): number {
    return this.current / 1000;
  }

  getDuration(): number {
    return this.duration / 1000;
  }

  getCapabilities(): PlayerCapabilities {
    return {
      playPause: this.controller !== null,
      seek: false,
      volume: false,
      playbackRate: false,
      currentTime: true,
      duration: true,
      metadata: true,
    };
  }
}

/* ======================================================================== */
/* Factory                                                                  */
/* ======================================================================== */

export interface PlayerSource {
  detection: ProviderDetection;
  /** Optional title used until real metadata arrives (direct audio). */
  title?: string;
}

/**
 * Build the right adapter for a validated link. The container is where
 * iframe-based providers mount their player.
 */
export function createAdapter(source: PlayerSource, container: HTMLElement): MusicPlayerAdapter {
  const { detection } = source;
  if (!detection.valid || !detection.normalizedUrl) {
    throw new Error(detection.reason ?? 'Invalid song link.');
  }
  switch (detection.provider) {
    case 'direct-audio':
      return new HtmlAudioAdapter(detection.normalizedUrl, source.title ?? '');
    case 'youtube':
      return new YouTubeAdapter(detection.mediaId ?? '', container);
    case 'spotify':
      return new SpotifyAdapter(detection.normalizedUrl, container);
    default:
      throw new Error('Unsupported music source.');
  }
}

/** Adapter for a user-uploaded audio file (local blob URL, never uploaded). */
export function createFileAdapter(file: File): { adapter: MusicPlayerAdapter; objectUrl: string } {
  const objectUrl = URL.createObjectURL(file);
  return { adapter: new HtmlAudioAdapter(objectUrl, file.name.replace(/\.[^.]+$/, '')), objectUrl };
}

export function embedUrlFor(detection: ProviderDetection): string | null {
  if (!detection.valid || !detection.normalizedUrl) return null;
  if (detection.provider === 'youtube' && detection.mediaId) return youtubeEmbedUrl(detection.mediaId);
  if (detection.provider === 'spotify') return spotifyEmbedUrl(detection.normalizedUrl);
  return null;
}
