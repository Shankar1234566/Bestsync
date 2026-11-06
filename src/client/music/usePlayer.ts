/**
 * React binding for the music engine: owns the adapter lifecycle, mirrors
 * its events into component state, and fetches metadata through the API.
 * The player's own clock is the single source of truth for lyric sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parsePlayerUrl,
  quantizeRateForProvider,
  type PlayerCapabilities,
  type ProviderDetection,
} from '../../shared';
import { api } from '../api/client';
import {
  createAdapter,
  createFileAdapter,
  type MusicPlayerAdapter,
  type PlayerMeta,
  type PlayerStatus,
  type TimePayload,
} from './adapters';

export interface PlayerViewState {
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  /** Tempo requested by the UI (0.5–1.5). */
  rate: number;
  /** Tempo actually applied after provider quantization (YouTube snaps). */
  appliedRate: number;
  error: string | null;
  meta: PlayerMeta;
  loading: boolean;
}

const INITIAL: PlayerViewState = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 0.9,
  rate: 1,
  appliedRate: 1,
  error: null,
  meta: { title: '', artist: '', artwork: '' },
  loading: false,
};

export interface LoadResult {
  detection: ProviderDetection | null;
  error: string | null;
}

export function usePlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MusicPlayerAdapter | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<PlayerViewState>(INITIAL);
  const [detection, setDetection] = useState<ProviderDetection | null>(null);

  const detach = useCallback(() => {
    adapterRef.current?.destroy();
    adapterRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const mount = useCallback(
    async (nextAdapter: MusicPlayerAdapter, nextDetection: ProviderDetection): Promise<string | null> => {
      detach();
      adapterRef.current = nextAdapter;
      setDetection(nextDetection);
      setState((prev) => ({ ...prev, loading: true, error: null, currentTime: 0, duration: 0 }));

      const offs = [
        nextAdapter.on('time', (payload) => {
          const time = payload as TimePayload;
          setState((prev) => ({
            ...prev,
            currentTime: time.currentTime,
            duration: time.duration || prev.duration,
          }));
        }),
        nextAdapter.on('status', (payload) => {
          const status = payload as PlayerStatus;
          setState((prev) => ({
            ...prev,
            status,
            loading: status === 'loading',
            error: status === 'error' ? prev.error : null,
          }));
        }),
        nextAdapter.on('meta', (payload) => {
          const meta = payload as PlayerMeta;
          setState((prev) => ({ ...prev, meta: { ...prev.meta, ...meta } }));
        }),
        nextAdapter.on('error', (payload) => {
          setState((prev) => ({ ...prev, error: String(payload ?? 'Playback error.'), loading: false }));
        }),
        nextAdapter.on('ended', () => {
          setState((prev) => ({ ...prev, status: 'ended' }));
        }),
      ];

      try {
        await nextAdapter.load();
        if (adapterRef.current !== nextAdapter) return null; // superseded mid-load
        setState((prev) => ({ ...prev, loading: false }));
        return null;
      } catch (error) {
        // A StrictMode remount or a newer load replaces this adapter while it
        // is still initialising — its rejection is stale and must not paint an
        // error over the adapter that is now active.
        if (adapterRef.current !== nextAdapter) return null;
        const message = error instanceof Error ? error.message : 'Could not load this song.';
        setState((prev) => ({ ...prev, loading: false, error: message, status: 'error' }));
        return message;
      } finally {
        // Subscriptions stay alive for the adapter's lifetime; they are
        // cleaned up implicitly when listeners are destroyed with it.
        void offs;
      }
    },
    [detach],
  );

  /** Validate + load a pasted link and (best effort) fetch its metadata. */
  const load = useCallback(
    async (rawUrl: string): Promise<LoadResult> => {
      const parsed = parsePlayerUrl(rawUrl);
      if (!parsed.valid || !parsed.normalizedUrl) {
        setState((prev) => ({ ...prev, error: parsed.reason ?? 'Invalid song link.' }));
        setDetection(parsed);
        return { detection: parsed, error: parsed.reason ?? 'Invalid song link.' };
      }
      if (!containerRef.current) {
        return { detection: parsed, error: 'Player surface is not mounted yet.' };
      }

      const adapter = createAdapter({ detection: parsed }, containerRef.current);
      const error = await mount(adapter, parsed);
      if (error) return { detection: parsed, error };

      // Metadata is a nice-to-have — failures never block playback.
      try {
        const result = await api.songMetadata(rawUrl);
        setState((prev) => ({
          ...prev,
          meta: {
            title: result.song.title || prev.meta.title,
            artist: result.song.artist || prev.meta.artist,
            artwork: result.song.artwork_url || prev.meta.artwork,
          },
        }));
      } catch {
        // Offline / rate-limited — keep whatever the adapter reported.
      }
      return { detection: parsed, error: null };
    },
    [mount],
  );

  /** Load a user-uploaded audio file as a local blob (never sent anywhere). */
  const loadFile = useCallback(
    async (file: File): Promise<LoadResult> => {
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(file.name)) {
        const message = 'That file does not look like an audio track.';
        setState((prev) => ({ ...prev, error: message }));
        return { detection: null, error: message };
      }
      const { adapter, objectUrl } = createFileAdapter(file);
      objectUrlRef.current = objectUrl;
      const fakeDetection: ProviderDetection = {
        provider: 'direct-audio',
        valid: true,
        normalizedUrl: objectUrl,
        mediaId: null,
        capabilities: {
          playPause: true,
          seek: true,
          volume: true,
          playbackRate: true,
          currentTime: true,
          duration: true,
          metadata: true,
        },
        limitations: ['Uploaded files stay in your browser session and are never sent to the server.'],
      };
      const error = await mount(adapter, fakeDetection);
      setState((prev) => ({
        ...prev,
        meta: { title: file.name.replace(/\.[^.]+$/, ''), artist: 'Local upload', artwork: '' },
      }));
      return { detection: fakeDetection, error };
    },
    [mount],
  );

  const play = useCallback(async () => {
    try {
      await adapterRef.current?.play();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Playback was blocked by the browser.',
      }));
    }
  }, []);

  const pause = useCallback(() => {
    adapterRef.current?.pause();
  }, []);

  const toggle = useCallback(async () => {
    if (state.status === 'playing') pause();
    else await play();
  }, [state.status, pause, play]);

  const seek = useCallback((seconds: number) => {
    adapterRef.current?.seek(seconds);
  }, []);

  const setVolume = useCallback((volume: number) => {
    const clamped = Math.min(1, Math.max(0, volume));
    adapterRef.current?.setVolume(clamped);
    setState((prev) => ({ ...prev, volume: clamped }));
  }, []);

  const setRate = useCallback((rate: number) => {
    const provider = adapterRef.current?.provider ?? 'direct-audio';
    const { rate: applied, snapped } = quantizeRateForProvider(rate, provider);
    adapterRef.current?.setRate(applied);
    setState((prev) => ({
      ...prev,
      rate: Math.min(1.5, Math.max(0.5, rate)),
      appliedRate: applied,
      error: snapped && provider === 'spotify' ? 'Spotify embeds do not allow tempo changes.' : prev.error,
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  useEffect(() => () => detach(), [detach]);

  const capabilities: PlayerCapabilities = detection?.capabilities ?? {
    playPause: false,
    seek: false,
    volume: false,
    playbackRate: false,
    currentTime: false,
    duration: false,
    metadata: false,
  };

  return {
    containerRef,
    state,
    detection,
    capabilities,
    hasSong: detection !== null && detection.valid,
    load,
    loadFile,
    play,
    pause,
    toggle,
    seek,
    setVolume,
    setRate,
    clearError,
    /** Current playback clock (source of truth for lyrics). */
    now: () => adapterRef.current?.getCurrentTime() ?? 0,
    duration: () => adapterRef.current?.getDuration() ?? 0,
  };
}

export type UsePlayer = ReturnType<typeof usePlayer>;
