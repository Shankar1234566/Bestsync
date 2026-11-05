/**
 * Shared DTOs and domain types used across client, server and tests.
 */
import type { GameMode } from './constants';

/* ------------------------------------------------------------------ */
/* Music providers                                                     */
/* ------------------------------------------------------------------ */

export type MusicProvider = 'youtube' | 'spotify' | 'direct-audio';

/** Which transport features a provider supports — drives UI enable/disable. */
export interface PlayerCapabilities {
  playPause: boolean;
  seek: boolean;
  volume: boolean;
  /** Playback-speed (tempo) control. False when the provider forbids it. */
  playbackRate: boolean;
  currentTime: boolean;
  duration: boolean;
  /** Title / artist / artwork availability. */
  metadata: boolean;
}

export interface ProviderDetection {
  provider: MusicProvider;
  valid: boolean;
  /** Canonical URL for embedding (null when invalid). */
  normalizedUrl: string | null;
  /** YouTube video id / Spotify entity id (null when not applicable). */
  mediaId: string | null;
  /** Spotify entity type (track/album/playlist/...). */
  spotifyKind?: 'track' | 'album' | 'playlist' | 'episode' | 'show' | 'artist';
  /** Human readable rejection reason when valid === false. */
  reason?: string;
  capabilities: PlayerCapabilities;
  /** Human readable limitation notes for the UI (e.g. no tempo control). */
  limitations: string[];
}

/* ------------------------------------------------------------------ */
/* Lyrics                                                              */
/* ------------------------------------------------------------------ */

export interface LyricLine {
  /** Start time in ms (0 for untimed lines). */
  timeMs: number;
  text: string;
  /** 1-based index for stable keys. */
  index: number;
}

export interface LyricDocument {
  lines: LyricLine[];
  /** True when at least one line carries a timestamp (LRC style). */
  timed: boolean;
  metadata: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Typing + game stats                                                 */
/* ------------------------------------------------------------------ */

export interface LiveStats {
  /** Standard five-character word convention. */
  wpm: number;
  cpm: number;
  accuracy: number;
  correctChars: number;
  /** Wrong characters currently standing in the active line. */
  incorrectChars: number;
  /** Cumulative wrong keystrokes — never decreases. */
  totalMistakes: number;
  combo: number;
  bestCombo: number;
  score: number;
  /** 0..100 */
  completion: number;
  elapsedMs: number;
  linesCompleted: number;
  totalLines: number;
}

export interface SessionResult extends LiveStats {
  mode: GameMode;
  tempoRate: number;
  adaptiveTempo: boolean;
  songUrl: string | null;
  songTitle: string | null;
}

/* ------------------------------------------------------------------ */
/* Gamification                                                        */
/* ------------------------------------------------------------------ */

export interface LevelDefinition {
  level: number;
  name: string;
  /** Cumulative XP required to reach this level. */
  minXp: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface ChallengeDefinition {
  id: string;
  kind: 'daily' | 'weekly';
  title: string;
  description: string;
  metric: ChallengeMetric;
  target: number;
  xpReward: number;
  /** Minimum accuracy (%) a session needs to count for accuracy-based metrics. */
  threshold?: number;
}

export type ChallengeMetric =
  | 'charsTyped'
  | 'songsCompleted'
  | 'accuracySessions'
  | 'bestCombo'
  | 'daysActive'
  | 'bestWpm';

/* ------------------------------------------------------------------ */
/* Users / auth / social                                               */
/* ------------------------------------------------------------------ */

export interface PublicUser {
  id: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  xp: number;
}

export interface ProfileSummary {
  id: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  levelName: string;
  xp: number;
  xpToNextLevel: number;
  totalSongsCompleted: number;
  averageAccuracy: number;
  bestWpm: number;
  highestScore: number;
  currentStreak: number;
  longestStreak: number;
  totalChars: number;
  badges: string[];
  globalRank: number | null;
  createdAt: number;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  score: number;
  accuracy: number;
  wpm: number;
  badges: string[];
  songId: number | null;
}

export type FriendStatus = 'pending' | 'accepted' | 'blocked';

export interface FriendRequest {
  id: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  status: FriendStatus;
  direction: 'incoming' | 'outgoing';
}

export interface Friend {
  id: number;
  username: string;
  country: string;
  avatar: string;
  level: number;
  bestWpm: number;
  highestScore: number;
}

/* ------------------------------------------------------------------ */
/* Scores                                                              */
/* ------------------------------------------------------------------ */

export interface ScoreSubmission {
  songUrl: string | null;
  mode: GameMode;
  wpm: number;
  cpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  totalMistakes: number;
  /** Total character keystrokes — lets the server re-derive accuracy. */
  keystrokes: number;
  bestCombo: number;
  score: number;
  completion: number;
  elapsedMs: number;
  linesCompleted: number;
  linesMissed: number;
  totalLines: number;
  tempoRate: number;
  adaptiveTempo: boolean;
}

export interface ScoreAck {
  accepted: boolean;
  reason?: string;
  sessionId: number | null;
  xpGained: number;
  level: number;
  levelName: string;
  leveledUp: boolean;
  unlockedBadges: BadgeDefinition[];
  challengesCompleted: ChallengeDefinition[];
  rank: number | null;
}

export interface ChallengeProgressView extends ChallengeDefinition {
  progress: number;
  completed: boolean;
  completedAt: number | null;
  periodKey: string;
}
