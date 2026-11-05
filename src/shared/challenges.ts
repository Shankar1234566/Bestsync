/**
 * Daily and weekly challenge definitions plus progress math.
 * Definitions live in shared code so the server can award XP authoritatively
 * and the client can render identical targets.
 */
import type { ChallengeDefinition, ChallengeMetric } from './types';

export const DAILY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: 'daily-chars',
    kind: 'daily',
    title: 'Finger Warm-up',
    description: 'Type 500 characters across any songs.',
    metric: 'charsTyped',
    target: 500,
    xpReward: 60,
  },
  {
    id: 'daily-song',
    kind: 'daily',
    title: 'Finish Something',
    description: 'Complete 1 song end to end.',
    metric: 'songsCompleted',
    target: 1,
    xpReward: 80,
  },
  {
    id: 'daily-accuracy',
    kind: 'daily',
    title: 'Sharp Shooter',
    description: 'Finish a song with at least 80% accuracy.',
    metric: 'accuracySessions',
    target: 1,
    xpReward: 70,
    threshold: 80,
  },
  {
    id: 'daily-combo',
    kind: 'daily',
    title: 'Combo Starter',
    description: 'Reach a 20-character combo in a single run.',
    metric: 'bestCombo',
    target: 20,
    xpReward: 50,
  },
];

export const WEEKLY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: 'weekly-chars',
    kind: 'weekly',
    title: 'Word Storm',
    description: 'Type 5,000 characters this week.',
    metric: 'charsTyped',
    target: 5_000,
    xpReward: 250,
  },
  {
    id: 'weekly-songs',
    kind: 'weekly',
    title: 'Album Runner',
    description: 'Complete 10 songs this week.',
    metric: 'songsCompleted',
    target: 10,
    xpReward: 300,
  },
  {
    id: 'weekly-days',
    kind: 'weekly',
    title: 'Show Up',
    description: 'Play on 5 different days this week.',
    metric: 'daysActive',
    target: 5,
    xpReward: 200,
  },
  {
    id: 'weekly-speed',
    kind: 'weekly',
    title: 'Speed Chase',
    description: 'Reach 120 WPM in any run this week.',
    metric: 'bestWpm',
    target: 120,
    xpReward: 350,
  },
  {
    id: 'weekly-accuracy',
    kind: 'weekly',
    title: 'Precision Week',
    description: 'Finish 3 songs with at least 90% accuracy.',
    metric: 'accuracySessions',
    target: 3,
    xpReward: 300,
    threshold: 90,
  },
];

export const ALL_CHALLENGES: ChallengeDefinition[] = [...DAILY_CHALLENGES, ...WEEKLY_CHALLENGES];

export function challengeById(id: string): ChallengeDefinition | undefined {
  return ALL_CHALLENGES.find((c) => c.id === id);
}

/** High-water metrics grow with a single value; cumulative metrics add deltas. */
const HIGH_WATER_METRICS: ReadonlySet<ChallengeMetric> = new Set([
  'bestCombo',
  'bestWpm',
  'daysActive',
]);

export function isHighWaterMetric(metric: ChallengeMetric): boolean {
  return HIGH_WATER_METRICS.has(metric);
}

/** Combine previous progress with a fresh observation for a metric. */
export function nextProgress(previous: number, metric: ChallengeMetric, value: number): number {
  if (isHighWaterMetric(metric)) return Math.max(previous, value);
  return previous + Math.max(0, value);
}

export function clampProgress(progress: number, target: number): number {
  return Math.min(progress, target);
}

export function isChallengeCompleted(progress: number, target: number): boolean {
  return progress >= target;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO-ish week key: `w:2026-W45`. Day key: `d:2026-11-05`. */
export function periodKey(kind: 'daily' | 'weekly', date: Date): string {
  if (kind === 'daily') {
    return `d:${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `w:${utc.getUTCFullYear()}-W${pad(week)}`;
}
