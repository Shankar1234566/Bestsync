/**
 * Leaderboard ordering rules shared by server (authoritative ranking) and
 * client (optimistic rendering of already-ranked API responses).
 */
export interface RComparable {
  score: number;
  accuracy: number;
  wpm: number;
}

/** Higher score first; ties broken by accuracy, then WPM. */
export function compareEntries(a: RComparable, b: RComparable): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  return b.wpm - a.wpm;
}

/** Sort in place and stamp 1-based ranks. */
export function rankEntries<T extends RComparable>(entries: T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort(compareEntries);
  return sorted.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

export type LeaderboardScope = 'global' | 'weekly' | 'monthly' | 'country' | 'friends' | 'song';

export const LEADERBOARD_SCOPES: LeaderboardScope[] = [
  'global',
  'weekly',
  'monthly',
  'country',
  'friends',
  'song',
];

/** Timestamp window for a scope (null window = all time). */
export function scopeWindow(
  scope: LeaderboardScope,
  now: number,
): { from: number; to: number } | null {
  const day = 86_400_000;
  if (scope === 'weekly') return { from: now - 7 * day, to: now };
  if (scope === 'monthly') return { from: now - 30 * day, to: now };
  return null;
}
