/**
 * Badge definitions and unlock evaluation.
 * Evaluation is pure — the server runs it authoritatively after validating a
 * score; the client re-renders unlocked badges from the API response.
 */
import type { BadgeDefinition } from './types';

export const BADGES: BadgeDefinition[] = [
  {
    id: 'first-song',
    name: 'First Song',
    description: 'Complete your first song.',
    icon: '🎵',
  },
  {
    id: 'perfect-typist',
    name: 'Perfect Typist',
    description: 'Finish a song with at least 99% accuracy.',
    icon: '✨',
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    description: 'Reach 100 WPM or higher.',
    icon: '⚡',
  },
  {
    id: 'combo-master',
    name: 'Combo Master',
    description: 'Build a combo of 50 in a single run.',
    icon: '🔥',
  },
  {
    id: 'flawless',
    name: 'Flawless',
    description: 'Finish a song with zero mistakes and 100% accuracy.',
    icon: '💎',
  },
  {
    id: 'music-lover',
    name: 'Music Lover',
    description: 'Complete 25 songs.',
    icon: '💖',
  },
  {
    id: 'daily-hero',
    name: 'Daily Hero',
    description: 'Keep a 7-day play streak alive.',
    icon: '📅',
  },
  {
    id: 'global-star',
    name: 'Global Star',
    description: 'Reach the top 100 of the global leaderboard.',
    icon: '🌟',
  },
  {
    id: 'teddy-favourite',
    name: "Teddy's Favourite",
    description: 'Finish 10 songs with at least 90% accuracy.',
    icon: '🧸',
  },
];

export const BADGE_IDS: string[] = BADGES.map((b) => b.id);

export function badgeById(id: string): BadgeDefinition | undefined {
  return BADGES.find((b) => b.id === id);
}

export interface BadgeContext {
  session: {
    accuracy: number;
    completion: number;
    bestCombo: number;
    wpm: number;
    totalMistakes: number;
    songsCompleted: number;
  };
  profile: {
    totalSongsCompleted: number;
    bestWpm: number;
    /** Runs finished with >= 90% accuracy and 100% completion. */
    cleanRuns: number;
    streak: number;
  };
  /** Global rank achieved with this run, if it placed. */
  rank: number | null;
}

/**
 * Return the ids of every badge the context qualifies for.
 * The caller subtracts badges already owned to detect unlocks.
 */
export function evaluateBadges(ctx: BadgeContext): string[] {
  const unlocked: string[] = [];
  const { session, profile } = ctx;

  if (profile.totalSongsCompleted >= 1) unlocked.push('first-song');
  if (session.accuracy >= 99 && session.completion >= 100) unlocked.push('perfect-typist');
  if (profile.bestWpm >= 100 || session.wpm >= 100) unlocked.push('speed-demon');
  if (session.bestCombo >= 50) unlocked.push('combo-master');
  if (session.accuracy >= 100 && session.completion >= 100 && session.totalMistakes === 0) {
    unlocked.push('flawless');
  }
  if (profile.totalSongsCompleted >= 25) unlocked.push('music-lover');
  if (profile.streak >= 7) unlocked.push('daily-hero');
  if (ctx.rank !== null && ctx.rank <= 100) unlocked.push('global-star');
  if (profile.cleanRuns >= 10) unlocked.push('teddy-favourite');

  return unlocked;
}
