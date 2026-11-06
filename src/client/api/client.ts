/**
 * Typed API client for the BeatSync backend.
 * Attaches the JWT when present, normalises errors and never throws raw
 * network failures at components — callers get `{ ok, status, data | error }`.
 */
import type {
  AuthResponse,
  BadgeDefinition,
  ChallengeProgressView,
  Friend,
  FriendRequest,
  LeaderboardEntry,
  LeaderboardScope,
  ProfileSummary,
  PublicUser,
  ScoreAck,
  ScoreSubmission,
} from '../../shared';

const TOKEN_KEY = 'beatsync.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode / storage disabled — session simply stays in memory.
  }
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, string> | undefined;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const payload = data as { error?: string; details?: Record<string, string> } | null;
      return {
        ok: false,
        status: response.status,
        data: null,
        error: payload?.error ?? `Request failed (${response.status})`,
      };
    }
    return { ok: true, status: response.status, data: data as T, error: null };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/** Like request<T> but throws ApiError on failure (for try/catch flows). */
async function expect<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const result = await request<T>(path, options);
  if (!result.ok || result.data === null) {
    throw new ApiError(result.status, result.error ?? 'Request failed');
  }
  return result.data;
}

/* ------------------------------- auth ---------------------------------- */

export interface MeResponse {
  user: PublicUser;
  profile: ProfileSummary;
}

/** Shape of GET /songs/lyrics — saved, discovered, or friendly-empty. */
export interface LyricsResponse {
  lyrics: { content: string; timed: boolean; updatedAt: number } | null;
  /** 'saved' = user's own copy, 'discovered' = provider lookup. */
  source: 'saved' | 'discovered' | null;
  provider: string | null;
  /** Machine-readable reason when no lyrics were found. */
  reason: string | null;
  /** Human-friendly explanation shown when lyrics are missing. */
  hint: string | null;
  /** Present for discovered lyrics — which record we matched. */
  match?: { title: string; artist: string; score: number };
  /** Identified song metadata (title/artist/artwork) for the UI. */
  song?: { id: number; provider: string; title: string; artist: string; artworkUrl: string };
}

export const api = {
  register(input: { username: string; email: string; password: string; country?: string }) {
    return expect<AuthResponse>('/auth/register', { method: 'POST', body: input, auth: false });
  },
  login(input: { identifier: string; password: string }) {
    return expect<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false });
  },
  me() {
    return expect<MeResponse>('/auth/me');
  },

  /* ----------------------------- profile ------------------------------ */
  profile() {
    return expect<{ profile: ProfileSummary; recentPerformances: SessionRow[] }>('/users/me');
  },
  updateProfile(patch: { username?: string; country?: string; avatar?: string }) {
    return expect<{ profile: ProfileSummary }>('/users/me', { method: 'PATCH', body: patch });
  },
  publicProfile(username: string) {
    return expect<{ profile: ProfileSummary; isSelf: boolean; recentPerformances: SessionRow[] }>(
      `/users/${encodeURIComponent(username)}`,
      { auth: false },
    );
  },

  /* ------------------------------ songs ------------------------------- */
  songMetadata(url: string) {
    return expect<{
      detection: import('../../shared').ProviderDetection;
      song: SongDto;
    }>('/songs/metadata', { method: 'POST', body: { url } });
  },
  validateSong(url: string) {
    return expect<{ detection: import('../../shared').ProviderDetection }>('/songs/validate', {
      method: 'POST',
      body: { url },
    });
  },
  recentSongs() {
    return expect<{ songs: (SongDto & { played_at: number })[] }>('/songs/recent');
  },
  favouriteSongs() {
    return expect<{ songs: SongDto[] }>('/songs/favourites');
  },
  addFavourite(url: string) {
    return expect<{ song: SongDto; favourite: boolean }>('/songs/favourites', {
      method: 'POST',
      body: { url },
    });
  },
  removeFavourite(songId: number) {
    return expect<{ songId: number; favourite: boolean }>(`/songs/favourites/${songId}`, {
      method: 'DELETE',
    });
  },
  saveLyrics(url: string, lyrics: string) {
    return expect<{ songId: number; lineCount: number; timed: boolean }>('/songs/lyrics', {
      method: 'PUT',
      body: { url, lyrics },
    });
  },
  getLyrics(url: string, durationSec?: number | null) {
    const params = new URLSearchParams({ url });
    if (durationSec !== undefined && durationSec !== null && durationSec > 0) {
      params.set('duration', String(Math.round(durationSec)));
    }
    return expect<LyricsResponse>(`/songs/lyrics?${params.toString()}`);
  },

  /* ----------------------------- scores ------------------------------- */
  submitScore(submission: ScoreSubmission) {
    return expect<ScoreAck>('/scores', { method: 'POST', body: submission });
  },

  /* --------------------------- leaderboard ---------------------------- */
  leaderboard(input: {
    scope: LeaderboardScope;
    songId?: number;
    country?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams({ scope: input.scope });
    if (input.songId) params.set('songId', String(input.songId));
    if (input.country) params.set('country', input.country);
    if (input.limit) params.set('limit', String(input.limit));
    return expect<{ scope: string; entries: LeaderboardEntry[] }>(`/leaderboard?${params}`);
  },

  /* --------------------------- progression ---------------------------- */
  badges() {
    return expect<{ badges: (BadgeDefinition & { unlocked: boolean; unlockedAt: number | null })[] }>(
      '/badges',
    );
  },
  challenges() {
    return expect<{ daily: ChallengeProgressView[]; weekly: ChallengeProgressView[] }>(
      '/challenges',
    );
  },
  levels() {
    return expect<{ levels: import('../../shared').LevelDefinition[] }>('/levels');
  },

  /* ----------------------------- friends ------------------------------ */
  friends() {
    return expect<{ friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
      '/friends',
    );
  },
  searchUsers(query: string) {
    return expect<{ users: PublicUser[] }>(`/friends/search?q=${encodeURIComponent(query)}`);
  },
  sendFriendRequest(username: string) {
    return expect<{ request: FriendRequest }>('/friends/request', {
      method: 'POST',
      body: { username },
    });
  },
  respondFriendRequest(id: number, action: 'accept' | 'reject') {
    return expect<{ friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
      `/friends/${id}/respond`,
      { method: 'POST', body: { action } },
    );
  },
  removeFriend(userId: number) {
    return expect<{ friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
      `/friends/${userId}`,
      { method: 'DELETE' },
    );
  },

  /* ----------------------------- battles ------------------------------ */
  activeBattle() {
    return expect<{ battle: BattleDto | null }>('/battles/active');
  },
  createBattle(songUrl: string, mode: string) {
    return expect<{ battle: BattleDto }>('/battles', {
      method: 'POST',
      body: { songUrl, mode },
    });
  },
  joinBattle(code: string) {
    return expect<{ battle: BattleDto }>('/battles/join', { method: 'POST', body: { code } });
  },
  battleStandings(id: number) {
    return expect<{
      battle: BattleDto;
      players: { userId: number; username: string; score: number; isWinner: boolean }[];
    }>(`/battles/${id}/standings`);
  },
  forfeitBattle(id: number) {
    return expect<{ battle: BattleDto | null }>(`/battles/${id}/forfeit`, { method: 'POST' });
  },
};

/* ------------------------------ DTOs ----------------------------------- */

export interface SongDto {
  id: number;
  provider: string;
  media_id: string | null;
  url: string;
  title: string;
  artist: string;
  artwork_url: string;
}

export interface SessionRow {
  id: number;
  song_id: number | null;
  mode: string;
  ended_at: number;
  wpm: number;
  accuracy: number;
  score: number;
  completion: number;
  tempo_rate: number;
}

export interface BattleDto {
  id: number;
  joinCode: string;
  hostId: number;
  opponentId: number | null;
  songUrl: string;
  mode: string;
  status: 'waiting' | 'active' | 'finished' | 'cancelled';
  hostScore: number;
  opponentScore: number;
  winnerId: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}
